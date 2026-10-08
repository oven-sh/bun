//! Every occurrence of a name that refers to something: ESLint's `Reference`s.
//!
//! The binder has resolved the identifiers that are expressions. What is derived here: whether
//! each is read or written, the scope it is in, the names in types and what they resolve to, and
//! all of it grouped by variable and by scope.

use super::scopes::{self, NONE, ScopeTree};
use super::variables::{TYPE, VALUE, Variables};
use super::{ReferenceFlags, ScopeKind};
use crate::ast::File;
use crate::options::Json;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Parent, PatParent};
use bun_sema::hir::{self, ExprId, ExprKind, PatKind, PropKind, StmtKind, TypeNodeKind, UnOp};
use smallvec::SmallVec;
use std::cell::OnceCell;

/// Where a reference is written.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReferenceSite {
    /// An identifier that is an expression.
    Expr(ExprId),
    /// The name of a declaration that gives it a value.
    Pat(hir::PatId),
    /// The first name of the entity name of a type reference.
    TypeName(hir::TypeNodeId),
    /// The `x` of `x is T`.
    Predicate(hir::TypeNodeId),
    /// The `a` of `import x = a.b`.
    ImportEquals(hir::ImportEqualsId),
    /// The `a` of `export { a }`.
    ExportSpec(hir::ExportSpecId),
    /// The `N` of `export as namespace N`.
    ExportAsNamespace(hir::StmtId),
    /// The tag `A-b`, or a part of the tag `a:b`, which the HIR stores as a string.
    JsxName(ExprId),
    /// The name of the first declaration of the variable at this index, for the use that JSX makes
    /// of `React`.
    Declaration(u32),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct RawReference {
    pub(crate) site: ReferenceSite,
    pub(crate) pos: u32,
    pub(crate) name: Atom,
    /// An index into `Variables::list`.
    pub(crate) variable: u32,
    /// ESLint's `reference.from`.
    pub(crate) from: u32,
    /// ESLint's `reference.writeExpr`.
    pub(crate) write: ExprId,
    pub(crate) flags: ReferenceFlags,
}

pub(crate) struct References {
    /// In source order.
    pub(crate) all: Vec<RawReference>,
    /// Indices into `all`, variable by variable, in source order. After the last variable: what
    /// resolves to nothing.
    by_variable: Vec<u32>,
    /// For each variable, where its references start in `by_variable`. Two more than there are
    /// variables.
    variable_starts: Vec<u32>,
    /// Indices into `all`, scope by scope, in source order.
    by_scope: Vec<u32>,
    scope_starts: Vec<u32>,
    /// What resolves to nothing, by name and then in source order. Computed on demand.
    unresolved_by_name: OnceCell<Vec<u32>>,
}

const READ: ReferenceFlags = ReferenceFlags::READ.union(ReferenceFlags::VALUE);
const WRITE: ReferenceFlags = ReferenceFlags::WRITE.union(ReferenceFlags::VALUE);

/// How an identifier that is an expression is used.
enum Access {
    Read,
    /// `a += value`, `a++`
    ReadWrite(ExprId),
    /// The values that are assigned to it are listed, in the order of ESLint's references.
    Write,
}

struct Collector<'f, 'a> {
    file: &'f File<'a>,
    is_javascript: bool,
    found: Vec<RawReference>,
}

impl Collector<'_, '_> {
    fn push(&mut self, site: ReferenceSite, pos: u32, name: Atom, flags: ReferenceFlags, write: ExprId) {
        self.found.push(RawReference {
            site,
            pos,
            name,
            variable: NONE,
            from: NONE,
            write: self.without_casts(write),
            flags,
        });
    }

    /// `/** @type {T} */ (e)` in JavaScript is `e` in parentheses to ESLint.
    fn without_casts(&self, mut e: ExprId) -> ExprId {
        while self.is_javascript
            && let Some(ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. }) =
                self.file.hir.exprs.get(e.idx()).map(|it| it.kind)
        {
            e = expr;
        }
        e
    }

    /// The right side, if the expression statement `s` is the left side of a `for`-`in` or a
    /// `for`-`of`.
    fn iterated_by(&self, s: hir::StmtId) -> Option<ExprId> {
        let Some(&Parent::Stmt(owner)) = self.file.bound.stmt_parent.get(s.idx()) else {
            return None;
        };
        match self.file.hir.stmts.get(owner.idx())?.kind {
            StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. } if left == s => Some(expr),
            _ => None,
        }
    }

    /// `Referencer.AssignmentExpression`, `UpdateExpression`, `visitForIn` and `PatternVisitor`,
    /// seen from the identifier `e`.
    fn access(&self, e: ExprId, values: &mut SmallVec<[ExprId; 4]>) -> Access {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        values.clear();
        let mut at = e;
        // `a!`, `a as T`, `<T>a` and `a satisfies T` since the last part of a pattern.
        let (mut wrappers, mut has_satisfies) = (0, false);
        // A bit for each of `values`: the assignment can be one of its own. Any can be a default
        // in a pattern.
        let mut is_assignment = 0u32;
        let mut iterated = None;
        loop {
            match bound.expr_parent.get(at.idx()) {
                Some(&Parent::Expr(parent)) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                    Some(ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    }) if target == at => {
                        // `visitExpressionTarget` looks through one.
                        if wrappers <= 1 && !has_satisfies && values.len() < 32 {
                            is_assignment |= 1 << values.len();
                        }
                        values.push(value);
                        (at, wrappers, has_satisfies) = (parent, 0, false);
                    }
                    Some(ExprKind::Assign {
                        op: Some(_),
                        target,
                        value,
                    }) if target == at && values.is_empty() && self.is_identifier(at, e) => {
                        return Access::ReadWrite(value);
                    }
                    Some(ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    }) if values.is_empty() && self.is_identifier(at, e) => {
                        return Access::ReadWrite(ExprId::NONE);
                    }
                    Some(ExprKind::Array(_) | ExprKind::Spread(_)) => (at, wrappers, has_satisfies) = (parent, 0, false),
                    Some(ExprKind::As { .. } | ExprKind::Satisfies { .. }) if self.is_javascript => at = parent,
                    Some(ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_)) if !self.is_javascript => {
                        (at, wrappers) = (parent, wrappers + 1);
                    }
                    Some(ExprKind::Satisfies { .. }) if !self.is_javascript => {
                        (at, wrappers, has_satisfies) = (parent, wrappers + 1, true);
                    }
                    _ => break,
                },
                Some(&Parent::Prop(p)) => {
                    let owner = bound.prop_owner.get(p.idx()).copied().unwrap_or(ExprId::NONE);
                    let is_part_of_pattern = matches!(
                        hir.props.get(p.idx()).map(|it| it.kind),
                        Some(PropKind::Init | PropKind::Shorthand | PropKind::Spread)
                    ) && matches!(
                        hir.exprs.get(owner.idx()).map(|it| it.kind),
                        Some(ExprKind::Object(_))
                    );
                    if !is_part_of_pattern {
                        break;
                    }
                    (at, wrappers, has_satisfies) = (owner, 0, false);
                }
                Some(&Parent::Stmt(s)) => {
                    iterated = self.iterated_by(s);
                    break;
                }
                _ => break,
            }
        }
        while iterated.is_none()
            && let Some(last) = values.len().checked_sub(1)
            && (last >= 32 || is_assignment & (1 << last) == 0)
        {
            values.pop();
        }
        // The values so far are innermost first. All but the outermost are defaults, which ESLint
        // lists outermost first, before the value itself.
        match (iterated, values.len()) {
            (Some(iterated), _) => {
                values.reverse();
                values.push(iterated);
            }
            (None, 0) => return Access::Read,
            (None, len) => {
                values[..len - 1].reverse();
            }
        }
        Access::Write
    }

    /// Whether `at` is `e`, or `e` in what `visitExpressionTarget` looks through.
    fn is_identifier(&self, at: ExprId, e: ExprId) -> bool {
        at == e
            || matches!(
                self.file.hir.exprs.get(at.idx()).map(|it| it.kind),
                Some(ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr)) if expr == e
            )
    }

    fn expressions(&mut self) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        // `eslint-scope` does not visit closing elements.
        let mut skipped: Vec<ExprId> = Vec::new();
        if self.is_javascript {
            for jsx in hir.jsx {
                let mut at = jsx.close_tag;
                while let Some(ExprKind::Dot { obj, .. }) = hir.exprs.get(at.idx()).map(|it| it.kind) {
                    at = obj;
                }
                skipped.push(at);
            }
            skipped.sort_unstable();
        }
        let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
        for (i, e) in hir.exprs.iter().enumerate() {
            let ExprKind::Ident(name) = e.kind else {
                continue;
            };
            let id = ExprId(i as u32);
            let mut flags = READ;
            let access = match bound.expr_parent.get(i) {
                None | Some(Parent::None) => continue,
                Some(&Parent::Expr(parent)) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                    Some(
                        ExprKind::Assign { .. }
                        | ExprKind::Unary {
                            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                            ..
                        }
                        | ExprKind::Array(_)
                        | ExprKind::Spread(_)
                        | ExprKind::As { .. }
                        | ExprKind::AsConst(_)
                        | ExprKind::NonNull(_)
                        | ExprKind::Satisfies { .. },
                    ) => self.access(id, &mut values),
                    Some(ExprKind::Jsx(jsx)) => {
                        let is_tag = hir.jsx.get(jsx.idx()).is_some_and(|it| it.tag == id || it.close_tag == id);
                        if is_tag && !is_component_name(file.atoms.bytes(name)) {
                            continue;
                        }
                        Access::Read
                    }
                    _ => Access::Read,
                },
                Some(Parent::Prop(_)) => self.access(id, &mut values),
                Some(&Parent::Stmt(s)) => match hir.stmts.get(s.idx()).map(|it| it.kind) {
                    // "this could be a type or a variable"
                    Some(StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)) if !self.is_javascript => {
                        flags |= ReferenceFlags::TYPE;
                        Access::Read
                    }
                    Some(StmtKind::Expr(_)) => self.access(id, &mut values),
                    _ => Access::Read,
                },
                _ => Access::Read,
            };
            if name == known::empty
                || (!skipped.is_empty() && skipped.binary_search(&id).is_ok())
                || (file.has_synthetic_nodes() && file.is_in_jsdoc(e.pos))
            {
                continue;
            }
            let site = ReferenceSite::Expr(id);
            match access {
                Access::Read => self.push(site, e.pos, name, flags, ExprId::NONE),
                Access::ReadWrite(value) => self.push(site, e.pos, name, READ | WRITE, value),
                Access::Write => {
                    for &value in &values {
                        self.push(site, e.pos, name, WRITE, value);
                    }
                }
            }
        }
    }

    /// `Referencer.VariableDeclaration`, `visitFunction`, `CatchClause`: a declaration writes the
    /// values that it gives to its names.
    fn patterns(&mut self, tree: &ScopeTree) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
        for (i, pat) in hir.pats.iter().enumerate() {
            let PatKind::Ident(name) = pat.kind else {
                continue;
            };
            values.clear();
            // Innermost first.
            let mut at = hir::PatId(i as u32);
            let root = loop {
                let (outer, default) = match bound.pat_parent.get(at.idx()) {
                    Some(&PatParent::Prop(outer, p)) => (outer, hir.pat_props.get(p.idx()).map(|it| it.default)),
                    Some(&PatParent::Elem(outer, e)) => (outer, hir.pat_elems.get(e.idx()).map(|it| it.default)),
                    Some(&root) => break root,
                    None => break PatParent::None,
                };
                values.extend(default.filter(|it| it.is_some()));
                at = outer;
            };
            let mut last = ExprId::NONE;
            match root {
                PatParent::Var(d) => {
                    let Some(declaration) = hir.var_decls.get(d.idx()) else {
                        continue;
                    };
                    values.reverse();
                    values.extend(declaration.init.some());
                    if let Some(&statement) = bound.var_stmt.get(d.idx())
                        && !matches!(bound.stmt_parent.get(statement.idx()), Some(Parent::FnBody(_) | Parent::File))
                    {
                        last = self.iterated_by(statement).unwrap_or(ExprId::NONE);
                    }
                }
                PatParent::Param(p) => {
                    let function = bound.param_fn.get(p.idx()).copied().unwrap_or(hir::FnId::NONE);
                    let scope = tree.of_fn.get(function.idx()).and_then(|&it| tree.scopes.get(it as usize));
                    if scope.is_none_or(|it| it.kind != ScopeKind::Function) {
                        continue;
                    }
                    values.extend(hir.params.get(p.idx()).and_then(|it| it.default.some()));
                    values.reverse();
                }
                _ => continue,
            }
            values.extend(last.some());
            if values.is_empty() || (file.has_synthetic_nodes() && file.is_in_jsdoc(pat.pos)) {
                continue;
            }
            for &value in &values {
                let site = ReferenceSite::Pat(hir::PatId(i as u32));
                self.push(site, pat.pos, name, WRITE | ReferenceFlags::INIT, value);
            }
        }
    }

    /// `TypeVisitor`
    fn types(&mut self, top_level: impl Iterator<Item = hir::StmtId>) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let start = self.found.len();
        for (i, ty) in hir.types.iter().enumerate() {
            let id = hir::TypeNodeId(i as u32);
            match ty.kind {
                TypeNodeKind::Ref { name, .. } if bound.type_scope.get(i).is_some_and(|it| it.is_some()) => {
                    if let Some(first) = hir.names.get(name.start as usize).filter(|_| !name.is_empty()) {
                        let flags = ReferenceFlags::READ | ReferenceFlags::TYPE;
                        self.push(ReferenceSite::TypeName(id), first.pos(), first.text, flags, ExprId::NONE);
                    }
                }
                TypeNodeKind::Predicate { param, asserts, .. }
                    if param != known::this && bound.type_scope.get(i).is_some_and(|it| it.is_some()) =>
                {
                    let pos = match asserts {
                        true => crate::tokens::skip_trivia(hir.text, ty.pos + "asserts".len() as u32),
                        false => ty.pos,
                    };
                    self.push(ReferenceSite::Predicate(id), pos, param, READ, ExprId::NONE);
                }
                _ => {}
            }
        }
        // A type is stored after its parts.
        self.found[start..].sort_unstable_by_key(|it| it.pos);
        for id in top_level {
            if let Some(stmt) = hir.stmts.get(id.idx())
                && let StmtKind::ExportAsNamespace(name) = stmt.kind
            {
                let mut pos = stmt.start;
                for keyword in ["export", "as", "namespace"] {
                    pos = crate::tokens::skip_trivia(hir.text, pos + keyword.len() as u32);
                }
                self.push(ReferenceSite::ExportAsNamespace(id), pos, name, READ, ExprId::NONE);
            }
        }
        for (i, import) in hir.import_equals.iter().enumerate() {
            if let hir::ImportEqualsTarget::Entity(names) = import.target
                && let Some(first) = hir.names.get(names.start as usize).filter(|_| !names.is_empty())
            {
                let site = ReferenceSite::ImportEquals(hir::ImportEqualsId(i as u32));
                self.push(site, first.pos(), first.text, READ, ExprId::NONE);
            }
        }
    }

    /// `visitJSXElement`, for the tags that are not expressions outside JSX.
    fn jsx_names(&mut self) {
        let file = self.file;
        let start = self.found.len();
        for jsx in file.hir.jsx {
            // `eslint-scope` does not visit closing elements.
            let tags = [Some(jsx.tag), (!self.is_javascript).then_some(jsx.close_tag)];
            for tag in tags.into_iter().flatten() {
                let Some(hir::Expr {
                    kind: ExprKind::String(name),
                    pos,
                    ..
                }) = file.hir.exprs.get(tag.idx())
                else {
                    continue;
                };
                let text = file.atoms.bytes(*name);
                match bun_core::strings::index_of_char_usize(text, b':') {
                    // `eslint-scope` takes a name with a namespace for no component.
                    Some(_) if self.is_javascript => {}
                    Some(colon) => {
                        let parts = [(0, &text[..colon]), (colon + 1, &text[colon + 1..])];
                        for (offset, part) in parts {
                            let part = file.atoms.intern(part);
                            self.push(ReferenceSite::JsxName(tag), pos + offset as u32, part, READ, ExprId::NONE);
                        }
                    }
                    None if is_component_name(text) => {
                        self.push(ReferenceSite::JsxName(tag), *pos, *name, READ, ExprId::NONE);
                    }
                    None => {}
                }
            }
        }
        self.found[start..].sort_unstable_by_key(|it| it.pos);
    }

    /// `ExportVisitor`
    fn export_specifiers(&mut self) {
        let hir = &self.file.hir;
        for (i, spec) in hir.export_specs.iter().enumerate() {
            let Some(export) = hir.exports.get(spec.export.idx()) else {
                continue;
            };
            let is_bound = matches!(
                self.file.bound.stmt_parent.get(export.stmt.idx()),
                Some(parent) if *parent != Parent::None
            );
            // The name can be a string only before `from`.
            if export.has_module_specifier || !is_bound || spec.local.is_none() {
                continue;
            }
            let flags = match (self.is_javascript, export.type_only || spec.type_only) {
                (true, _) => READ,
                (false, true) => ReferenceFlags::READ | ReferenceFlags::TYPE,
                (false, false) => READ | ReferenceFlags::TYPE,
            };
            let site = ReferenceSite::ExportSpec(hir::ExportSpecId(i as u32));
            self.push(site, spec.local_pos, spec.local, flags, ExprId::NONE);
        }
    }

    /// `Referencer.referenceJsxPragma`, `referenceJsxFragment`: "Searches for a variable named
    /// "name" in the upper scopes and adds a pseudo-reference from itself to itself".
    fn jsx_pragmas(&mut self, tree: &ScopeTree, variables: &Variables) {
        let file = self.file;
        let option = |key: &[u8], default: Option<Atom>| match file.language().parser_options.get(key) {
            Some(Json::String(name)) => Some(file.atoms.intern(name)),
            Some(Json::Null) => None,
            _ => default,
        };
        let names = [
            (option(b"jsxPragma", Some(known::React)), false),
            (option(b"jsxFragmentName", None), true),
        ];
        for (name, only_fragments) in names {
            let Some(name) = name else {
                continue;
            };
            let mut elements: Vec<u32> = (file.hir.exprs.iter().enumerate())
                .filter(|(i, e)| {
                    matches!(e.kind, ExprKind::Jsx(jsx)
                        if !only_fragments || file.hir.jsx.get(jsx.idx()).is_some_and(|it| it.tag.is_none()))
                        && !matches!(file.bound.expr_parent.get(*i), None | Some(Parent::None))
                })
                .map(|(_, e)| e.pos)
                .collect();
            elements.sort_unstable();
            let found = elements.iter().find_map(|&pos| {
                let mut scope = tree.region_at(pos).from;
                while let Some(data) = tree.scopes.get(scope as usize) {
                    if let Some(index) = variables.get(scope, name) {
                        return Some(index);
                    }
                    scope = data.parent;
                }
                None
            });
            if let Some(index) = found {
                let pos = variables.list[index as usize].first_pos;
                self.push(ReferenceSite::Declaration(index), pos, name, READ, ExprId::NONE);
            }
        }
    }
}

/// `name[0].toUpperCase() === name[0]`
fn is_component_name(name: &[u8]) -> bool {
    match name.first() {
        Some(first) if first.is_ascii() => !first.is_ascii_lowercase(),
        _ => match bstr::ByteSlice::chars(name).next() {
            Some(first) => first.to_uppercase().eq([first]),
            None => false,
        },
    }
}

/// The groups of `all` by `key`, which is less than `count`: the indices group by group, and where
/// each group starts.
fn group_by(all: &[RawReference], count: usize, key: impl Fn(&RawReference) -> usize) -> (Vec<u32>, Vec<u32>) {
    let mut starts = vec![0u32; count + 1];
    for it in all {
        starts[key(it) + 1] += 1;
    }
    for i in 0..count {
        starts[i + 1] += starts[i];
    }
    let mut next = starts.clone();
    let mut indices = vec![0u32; all.len()];
    for (i, it) in all.iter().enumerate() {
        let slot = &mut next[key(it)];
        indices[*slot as usize] = i as u32;
        *slot += 1;
    }
    (indices, starts)
}

impl References {
    pub(crate) fn new<'a>(file: &'a File<'a>, tree: &ScopeTree, variables: &Variables) -> References {
        let (hir, bound) = (&file.hir, &file.bound);
        let is_javascript = scopes::is_javascript_mode(file);
        let mut collector = Collector {
            file,
            is_javascript,
            found: Vec::with_capacity(hir.exprs.len() / 3),
        };
        collector.expressions();
        collector.patterns(tree);
        collector.export_specifiers();
        if !hir.jsx.is_empty() {
            collector.jsx_names();
        }
        if !is_javascript {
            collector.types(file.body().iter().map(|it| it.id()));
            if !hir.jsx.is_empty() {
                collector.jsx_pragmas(tree, variables);
            }
        }
        let mut all = collector.found;
        // Each part is nearly in order already. References at the same place keep their order.
        all.sort_by_key(|it| it.pos);

        let hazards = &variables.hazards;
        let mut cursor = tree.cursor();
        for it in &mut all {
            it.from = cursor.seek(it.pos).from;
            let wants = u8::from(it.flags.contains(ReferenceFlags::VALUE)) * VALUE
                + u8::from(it.flags.contains(ReferenceFlags::TYPE)) * TYPE;
            let bound_to = match it.site {
                ReferenceSite::Expr(e) if wants == VALUE => bound.expr_symbol.get(e.idx()).copied(),
                ReferenceSite::Pat(p) => bound.pat_symbol.get(p.idx()).copied(),
                ReferenceSite::Declaration(index) => {
                    it.from = variables.list[index as usize].scope;
                    None
                }
                _ => None,
            };
            let is_hazard = !hazards.is_empty() && hazards.binary_search_by_key(&it.name.0, |it| it.0).is_ok();
            let trusted = match bound_to.filter(|_| !is_hazard) {
                Some(symbol) if symbol.is_some() => {
                    // What the binder found is what ESLint finds if it is declared around the
                    // reference, and not in the body of a function whose parameters refer to it.
                    variables.of_symbol(tree, symbol).filter(|&index| {
                        let scope = variables.list[index as usize].scope;
                        tree.contains(scope, it.from)
                            && it.pos >= tree.scopes[scope as usize].body_start
                            // `catch (e) { var e = 1 }` writes the parameter.
                            && (!matches!(it.site, ReferenceSite::Pat(_)) || scope == it.from)
                    })
                }
                // Nothing in the file declares it, or it is the `arguments` of a function.
                Some(_) if it.name != known::arguments => {
                    continue;
                }
                _ => None,
            };
            it.variable = match trusted {
                Some(index) => index,
                None => variables.resolve(tree, it.from, it.name, it.pos, wants).unwrap_or(NONE),
            };
        }

        let unresolved = variables.list.len();
        let (by_variable, variable_starts) = group_by(&all, unresolved + 1, |it| (it.variable as usize).min(unresolved));
        let (by_scope, scope_starts) = group_by(&all, tree.scopes.len(), |it| it.from as usize);
        References {
            all,
            by_variable,
            variable_starts,
            by_scope,
            scope_starts,
            unresolved_by_name: OnceCell::new(),
        }
    }

    fn group<'t>(indices: &'t [u32], starts: &[u32], from: usize, to: usize) -> &'t [u32] {
        match (starts.get(from), starts.get(to + 1)) {
            (Some(&start), Some(&end)) => indices.get(start as usize..end as usize).unwrap_or_default(),
            _ => &[],
        }
    }

    /// The references to the variable at `index` of `Variables::list`.
    #[inline]
    pub(crate) fn of_variable(&self, index: u32) -> &[u32] {
        Self::group(&self.by_variable, &self.variable_starts, index as usize, index as usize)
    }

    #[inline]
    pub(crate) fn unresolved(&self) -> &[u32] {
        let last = self.variable_starts.len().saturating_sub(2);
        Self::group(&self.by_variable, &self.variable_starts, last, last)
    }

    /// The references to `name` that resolve to nothing.
    pub(crate) fn unresolved_named(&self, name: Atom) -> &[u32] {
        let sorted = self.unresolved_by_name.get_or_init(|| {
            let mut sorted = self.unresolved().to_vec();
            sorted.sort_by_key(|&it| self.all[it as usize].name.0);
            sorted
        });
        let start = sorted.partition_point(|&it| self.all[it as usize].name.0 < name.0);
        let len = sorted[start..].partition_point(|&it| self.all[it as usize].name == name);
        &sorted[start..start + len]
    }

    /// The references that are written in the scopes `first..=last`.
    #[inline]
    pub(crate) fn in_scopes(&self, first: u32, last: u32) -> &[u32] {
        Self::group(&self.by_scope, &self.scope_starts, first as usize, last as usize)
    }

    /// The first reference that is written at `pos`.
    pub(crate) fn at(&self, pos: u32) -> Option<u32> {
        let index = self.all.partition_point(|it| it.pos < pos);
        (self.all.get(index)?.pos == pos).then_some(index as u32)
    }
}
