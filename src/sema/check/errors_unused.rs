//! Unused declarations: 6133 6138 6192 6196 6198 6199 6205, under `noUnusedLocals` and
//! `noUnusedParameters`.
//!
//! Follows `checkUnusedIdentifiers` and its callees in TypeScript 7.0.2's checker.go. They record
//! references during checking. Here one pass over the file collects them.

use super::errors_enums_names::Location;
use super::*;
use crate::bind::{
    Bound, ClassOwner, Decl, Flow, FlowId, FnOwner, MemberOwner, Parent, PatParent, ScopeId,
    ScopeKind, SymbolId,
};
use crate::program::SymbolTable;

/// The meanings a name was resolved with.
const VALUE: u8 = 1;
const TYPE: u8 = 2;
const NAMESPACE: u8 = 4;
const ALL: u8 = 7;
const ALIAS: u8 = 8;

/// Whether `getTypeAtFlowNode`, for a property or element access at `flow`, reaches a node where it
/// calls `isMatchingReference` or `getFlowReferenceKey`. For such a reference it does not go past
/// the start of the function.
fn compares_references(bound: &Bound, mut flow: FlowId, depth: u32) -> bool {
    loop {
        flow = match bound.flow[flow.idx()] {
            Flow::Unreachable | Flow::Start { .. } => return false,
            Flow::Assign { .. } | Flow::Cond { .. } | Flow::Switch { .. } | Flow::Loop { .. } => {
                return true;
            }
            Flow::Label { start, len } => {
                let edges = &bound.flow_edges[start as usize..(start + len) as usize];
                return depth < 64
                    && (edges.iter()).any(|&edge| compares_references(bound, edge, depth + 1));
            }
            Flow::StartInvoked { outer: before, .. }
            | Flow::Call { before, .. }
            | Flow::Reduce { before, .. }
            | Flow::ArrayMutation { before, .. } => before,
        };
    }
}

struct Unused<'a, 's> {
    files: &'a Files<'s>,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    atoms: crate::atom::Atoms<'a, 's>,
    /// Indexed by symbol: the meanings it was referenced with.
    referenced: Vec<u8>,
    /// `symbolReferenceLinks` for the private members of classes and the private parameter
    /// properties.
    referenced_members: crate::util::FxHashSet<Sym>,
    /// A read used a key that could not be resolved, so it may have read any member.
    reads_unknown_members: bool,
    /// Indexed by scope: the symbol of the function, class, interface, enum, alias or namespace
    /// declaration that owns the scope.
    owner_of_scope: Vec<SymbolId>,
    /// The file has a `return` whose expression is never checked: see `is_in_unchecked_return`.
    has_unchecked_returns: bool,
    /// `Checker::never_checked` after `check_source_file`.
    never_checked: Vec<(u32, u32)>,
    /// The starts of the parser's and the scanner's errors. Sorted. Empty for a file that parses.
    syntax_errors: Vec<u32>,
    locals: bool,
    parameters: bool,
}

impl Checker<'_, '_> {
    pub(super) fn check_unused(&mut self, file: FileId) {
        let options = &self.p.files.options;
        let (locals, parameters) = (options.no_unused_locals, options.no_unused_parameters);
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !(locals || parameters) || hir.kind == FileKind::Declaration {
            return;
        }
        let parse_errors = hir
            .diagnostics
            .iter()
            .filter(|d| d.kind == DiagnosticKind::Parse);
        let mut syntax_errors: Vec<u32> = parse_errors.map(|d| d.start).collect();
        syntax_errors.sort_unstable();
        let mut u = Unused {
            files: &self.p.files,
            file,
            hir,
            bound,
            atoms: self.atoms(),
            referenced: vec![0; bound.symbols.len()],
            referenced_members: Default::default(),
            reads_unknown_members: false,
            owner_of_scope: vec![SymbolId::NONE; bound.scopes.len()],
            has_unchecked_returns: false,
            never_checked: self.never_checked.borrow().clone(),
            syntax_errors,
            locals,
            parameters,
        };
        for (i, s) in bound.scopes.iter().enumerate() {
            u.owner_of_scope[i] = match s.kind {
                ScopeKind::Fn(f) if hir[f].kind == FnKind::Decl => bound.fn_symbol[f.idx()],
                ScopeKind::Class(c)
                    if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)) =>
                {
                    bound.class_symbol[c.idx()]
                }
                ScopeKind::Interface(id) => bound.interface_symbol[id.idx()],
                ScopeKind::Enum(e) => bound.enum_symbol[e.idx()],
                ScopeKind::Module(m) => bound.module_symbol[m.idx()],
                _ => SymbolId::NONE,
            };
        }
        for (a, &scope) in bound.alias_scope.iter().enumerate() {
            if scope.is_some() {
                u.owner_of_scope[scope.idx()] = bound.alias_symbol[a];
            }
        }
        u.has_unchecked_returns = hir.stmts.iter().any(
            |s| matches!(s.kind, StmtKind::Return(e) if e.is_some() && u.is_in_unchecked_return(e)),
        );
        let index = self.exprs_by_kind(file);
        u.note_references(&index);
        let links = &self.p.symbol_reference_links;
        for (i, kinds) in u.referenced.iter_mut().enumerate() {
            let id = SymbolId(i as u32);
            if links.get(&self.task, &Sym { file, id }).is_some() {
                *kinds |= ALIAS;
            }
        }
        // `Resolve` records the reference before `OnPropertyWithInvalidInitializer` makes it return
        // nil, and the binder has no symbol for the name.
        if !self.p.files.options.emit_standard_class_fields {
            for &(e, scope) in &bound.free_idents {
                if let ExprKind::Ident(name) = hir[e].kind
                    && let Err((2301 | 2844, _)) =
                        self.files()
                            .resolve(file, scope, name, SymFlags::VALUE, true)
                    && !bound.is_unchecked(e.idx())
                    && !u.is_unchecked(e)
                    && !u.is_write_only(e)
                {
                    u.note_name(scope, name, SymFlags::VALUE, VALUE);
                }
            }
        }
        self.note_entity_name_expressions(file, &index, &mut u);
        self.note_jsdoc_links(file, &mut u);
        if !hir.jsx.is_empty() {
            self.note_jsx_factories(file, &index, &mut u);
        }
        if self.emits_first() {
            self.note_names_resolved_by_emit(file, &index, &mut u);
        }
        if locals {
            self.note_private_reads(file, &mut u);
        }
        self.check_unused_identifiers(&u);
    }

    /// `RuntimeSyntaxTransformer` writes `x || (x = {})` for an enum or a namespace `x`. In a file
    /// that is emitted as CommonJS, `visitAssignmentExpression` asks for the exports of the target
    /// (`getExports`, `GetReferencedImportDeclaration`). Its original is the name of the
    /// declaration, which has no resolved symbol, so `getReferencedValueOrAliasSymbol` resolves it
    /// with `isUse`. From that name `Resolve` passes over the declaration, which is then no
    /// `lastSelfReferenceLocation`.
    fn note_names_resolved_by_emit(&self, file: FileId, index: &ExprsByKind, u: &mut Unused) {
        use crate::resolve::{JsxEmit, ModuleKind};
        let (hir, bound, options) = (self.hir(file), self.bound(file), &self.p.files.options);
        // `getScriptTransformers`: otherwise `referenceResolver` is the binder's own.
        let transforms_jsx = hir.kind == FileKind::Tsx
            && matches!(
                options.jsx,
                JsxEmit::React | JsxEmit::ReactJsx | JsxEmit::ReactJsxDev
            );
        let asks_the_checker =
            !options.verbatim_module_syntax || transforms_jsx || options.emit_decorator_metadata;
        // `getModuleTransformer`, `ImpliedModuleTransformer`, `CommonJSModuleTransformer.visitSourceFile`
        let is_commonjs = options.module != ModuleKind::Preserve
            && self.emit_module_format_of_file(file) < ModuleKind::Es2015
            && (self.is_effective_external_module(file)
                || !index.of(ExprTag::ImportCall).is_empty());
        if !self.emits_js_file(file) || !asks_the_checker || !is_commonjs {
            return;
        }
        // `ShouldPreserveConstEnums`
        let preserves_const_enums = options.preserve_const_enums || options.isolated_modules;
        // `shouldEmitEnumDeclaration`, `shouldEmitModuleDeclaration`
        let enums = hir.enums.iter().enumerate().filter_map(|(i, it)| {
            let is_emitted = !it.flags.contains(Flags::CONST) || preserves_const_enums;
            is_emitted.then_some((it.stmt, it.name, it.flags, bound.enum_scope[i]))
        });
        let namespaces = (hir.modules.iter().enumerate()).filter_map(|(i, it)| match it.name {
            ModuleName::Ident(name)
                if bound.is_instantiated_module(ModuleId(i as u32), preserves_const_enums) =>
            {
                Some((it.stmt, name, it.flags, bound.module_scope[i]))
            }
            _ => None,
        });
        let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE | SymFlags::ALIAS;
        for (stmt, name, flags, created) in enums.chain(namespaces) {
            // `isExportOfNamespace`: `N.x || (N.x = {})`
            let is_export_of_namespace = flags.contains(Flags::EXPORT)
                && matches!(bound.stmt_parent[stmt.idx()], Parent::Module(_));
            if !is_export_of_namespace && created.is_some() && !hir.is_ambient(hir.node(stmt)) {
                u.note_name(bound.scopes[created.idx()].parent, name, meaning, VALUE);
            }
        }
    }

    /// The expressions that tsgo resolves with `resolveEntityName` besides checking them. In `a.b`
    /// that resolves `a` as a namespace: see `note_namespace`.
    fn note_entity_name_expressions(&mut self, file: FileId, index: &ExprsByKind, u: &mut Unused) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_checked = |u: &Unused, e: ExprId| !bound.is_unchecked(e.idx()) && !u.is_unchecked(e);
        // `isValidConstAssertionArgument(e)` resolves the object of a property or element access.
        for &e in index
            .of(ExprTag::Dot)
            .iter()
            .chain(index.of(ExprTag::Index))
        {
            let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[e].kind else {
                continue;
            };
            if !is_property_access_entity_name_expression(hir, obj) || !is_checked(u, e) {
                continue;
            }
            let has_inferred_return_type = |f: FnId| hir[f].ret.is_none();
            let is_in_such_a_function =
                || (self.get_containing_function(file, e)).is_some_and(has_inferred_return_type);
            // `isConstContext(e)`
            let is_tested = match bound.expr_parent[e.idx()] {
                // `checkExpressionForMutableLocation`, `checkAssertion`,
                // `checkAndAggregateYieldOperandTypes`
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Array(_) | ExprKind::AsConst(_) => true,
                    ExprKind::Yield { .. } => is_in_such_a_function(),
                    _ => false,
                },
                Parent::Prop(prop) => matches!(hir[prop].kind, PropKind::Init),
                // `getReturnTypeFromBody`
                Parent::FnBody(f) => has_inferred_return_type(f),
                // `checkAndAggregateReturnExpressionTypes`
                Parent::Stmt(s) if matches!(hir[s].kind, StmtKind::Return(_)) => {
                    is_in_such_a_function()
                }
                _ => false,
            };
            if is_tested {
                self.note_qualified_name(file, u, obj);
            }
        }
        // `getAccessedPropertyName(e)` resolves the key of `x[a.b]`. `getFlowTypeOfReference` asks
        // for it where it compares `e` with another reference.
        for &e in index.of(ExprTag::Index) {
            let ExprKind::Index { index: key, .. } = hir[e].kind else {
                continue;
            };
            if !is_parenthesized(hir, key)
                && is_property_access_entity_name_expression(hir, key)
                && is_checked(u, e)
                && !self.is_definite_assignment_target(file, e)
                && compares_references(bound, bound.expr_flow[e.idx()], 0)
            {
                self.note_qualified_name(file, u, key);
            }
        }
        // `checkTemplateExpression`
        for &e in index.of(ExprTag::Template) {
            let is_tagged = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent)
                if matches!(hir[parent].kind, ExprKind::TaggedTemplate(call) if hir[call].template == e));
            if !is_tagged && is_checked(u, e) {
                self.note_evaluated(file, u, e, Location::Expr(file, e), 0);
            }
        }
        // `checkBinaryLikeExpression`: the right operand of a shift.
        for &e in index
            .of(ExprTag::Binary)
            .iter()
            .chain(index.of(ExprTag::Assign))
        {
            let (ExprKind::Binary { op, right, .. }
            | ExprKind::Assign {
                op: Some(op),
                value: right,
                ..
            }) = hir[e].kind
            else {
                continue;
            };
            if matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr) && is_checked(u, e) {
                self.note_evaluated(file, u, right, Location::Expr(file, right), 0);
            }
        }
        // `computeConstantEnumMemberValue`
        for (i, member) in hir.enum_members.iter().enumerate() {
            if member.init.is_some() {
                let location = Location::Member(file, EnumMemberId(i as u32));
                self.note_evaluated(file, u, member.init, location, 0);
            }
        }
    }

    /// `resolveEntityName(e, SymbolFlagsValue)` for `e` of the form `a.b`.
    fn note_qualified_name(&self, file: FileId, u: &mut Unused, e: ExprId) {
        let hir = self.hir(file);
        let mut first = e;
        while let ExprKind::Dot { obj, .. } = hir[first].kind {
            first = obj;
        }
        if let ExprKind::Ident(name) = hir[first].kind {
            u.note_namespace(self.enclosing_scope_of_expr(file, first), name);
        }
    }

    /// The names that `evaluate(e, location)` resolves. It visits what `evaluate` visits.
    fn note_evaluated(
        &mut self,
        file: FileId,
        u: &mut Unused,
        e: ExprId,
        location: Location,
        depth: u32,
    ) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Unary {
                op:
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::PreInc | UnOp::PreDec,
                operand,
            } => self.note_evaluated(file, u, operand, location, depth),
            ExprKind::Binary { left, right, .. }
            | ExprKind::Assign {
                target: left,
                value: right,
                ..
            } => {
                self.note_evaluated(file, u, left, location, depth);
                self.note_evaluated(file, u, right, location, depth);
            }
            // `evaluateTemplateExpression` stops at the first span without a value.
            ExprKind::Template { exprs } => {
                for span in hir.ids(exprs) {
                    self.note_evaluated(file, u, span, location, depth);
                    if self.evaluate(file, span, location).value.is_none() {
                        break;
                    }
                }
            }
            ExprKind::Index { obj, index, .. } => {
                if is_string_literal_like(hir, index)
                    && !is_parenthesized(hir, index)
                    && !is_parenthesized(hir, obj)
                    && is_property_access_entity_name_expression(hir, obj)
                {
                    self.note_qualified_name(file, u, obj);
                }
            }
            ExprKind::Dot { .. } if is_property_access_entity_name_expression(hir, e) => {
                self.note_qualified_name(file, u, e);
            }
            // The initializer of a constant.
            ExprKind::Ident(_) if depth < 16 => {
                if let Some(symbol) = self.resolve_entity_name_expression(file, e, SymFlags::VALUE)
                    && let Some((of, d)) = self.constant_variable_declaration(symbol, location)
                    && of == file
                {
                    let location = Location::Variable(of, d);
                    self.note_evaluated(file, u, hir[d].init, location, depth + 1);
                }
            }
            _ => {}
        }
    }

    /// `markJsxAliasReferenced`: a tag is a call of the factory, which must be in scope at the tag,
    /// unless an existing module is imported for it implicitly
    /// (`getJsxNamespaceContainerForImplicitImport`).
    fn note_jsx_factories(&self, file: FileId, index: &ExprsByKind, u: &mut Unused) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (options, atoms) = (&self.p.files.options, self.atoms());
        let runtime = crate::program::jsx_runtime_of(options, hir, &self.p.files.atoms);
        if runtime.is_some_and(|spec| {
            self.files()
                .module_of_specifier(file, atoms.intern(&spec))
                .is_some()
        }) {
            return;
        }
        let (factory, fragment_factory) = (
            super::errors_jsx::jsx_namespace(self.files(), self.atoms(), hir, false),
            super::errors_jsx::jsx_namespace(self.files(), self.atoms(), hir, true),
        );
        for &e in index.of(ExprTag::Jsx) {
            let ExprKind::Jsx(j) = hir[e].kind else {
                continue;
            };
            if bound.is_unchecked(e.idx()) || u.is_unchecked(e) {
                continue;
            }
            let is_fragment = hir[j].tag.is_none();
            let scope = u.scope_of(e);
            // `symbolReferenced`: the factory is marked as referenced even by a tag inside its own
            // declaration.
            if let Some(found) = u.note_name(
                scope,
                if is_fragment {
                    fragment_factory
                } else {
                    factory
                },
                SymFlags::VALUE,
                ALL,
            ) {
                u.referenced[found.idx()] |= ALL;
            }
            // `getJsxFactoryEntity`: a fragment uses both factories.
            if is_fragment {
                u.note_name(scope, factory, SymFlags::VALUE, VALUE);
            }
        }
    }

    /// `checkJSDocComment`: the name of each `{@link name}` in the JSDoc of a statement, a member
    /// or a parameter is resolved, which references its first identifier.
    fn note_jsdoc_links(&self, file: FileId, u: &mut Unused) {
        let atoms = &self.atoms();
        let text: &[u8] = &self.hir(file).text;
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let mut from = 0;
        while let Some(tag) = find_bytes(text, from, b"@link") {
            from = tag + 1;
            let Some(open) = bun_core::strings::last_index_of(&text[..tag], b"/**") else {
                continue;
            };
            let Some(close) = find_bytes(text, open + 2, b"*/") else {
                return;
            };
            if close < tag {
                continue;
            }
            from = close + 2;
            let scope = u.scope_of_jsdoc(open, close + 2);
            if scope.is_none() {
                continue;
            }
            for names in jsdoc_link_names(&text[open + 3..close]) {
                let Some(first) = atoms.lookup(names[0]) else {
                    continue;
                };
                // `resolveJSDocMemberName`: a qualified name that does not resolve as an entity
                // name is a member of the symbol its left side names.
                if names.len() > 1 {
                    u.note_name(scope, first, SymFlags::NAMESPACE, NAMESPACE);
                    let names: Vec<Atom> = names.iter().map(|name| atoms.intern(name)).collect();
                    if (2..=names.len()).rev().any(|n| {
                        self.files()
                            .resolve_entity(file, scope, &names[..n], all)
                            .is_some()
                    }) {
                        continue;
                    }
                }
                u.note_name(scope, first, all, ALL);
            }
        }
    }

    /// Records the reads of private members: every place where `markPropertyAsReferenced` is
    /// called.
    fn note_private_reads(&mut self, file: FileId, u: &mut Unused) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Only the private members of the file are marked, so an access with any other name is not
        // resolved. A computed name is not known in advance.
        let private = hir
            .members
            .iter()
            .filter(|m| m.flags.contains(Flags::PRIVATE) || matches!(m.key, PropKey::Private(_)));
        let may_be_any = private.clone().any(|m| m.key.name().is_none());
        let parameters = hir
            .params
            .iter()
            .filter(|p| p.flags.contains(Flags::PRIVATE));
        let names: crate::util::FxHashSet<Atom> = private
            .filter_map(|m| m.key.name())
            .chain(parameters.filter_map(|p| match hir[p.pat].kind {
                PatKind::Ident(name) => Some(name),
                _ => None,
            }))
            .collect();
        if names.is_empty() && !may_be_any {
            return;
        }
        let is_private = |name: Atom| may_be_any || names.contains(&name);
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            if !matches!(
                hir.exprs[i].kind,
                ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::Assign { op: None, .. }
                    | ExprKind::Binary { op: BinOp::In, .. }
            ) || bound.is_unchecked(i)
                || u.is_unchecked(e)
            {
                continue;
            }
            match hir.exprs[i].kind {
                ExprKind::Dot { obj, name, .. } if is_private(name) => {
                    let receiver = self.type_of_expr(file, obj);
                    let receiver = self.non_nullable(receiver);
                    self.note_property(file, u, receiver, name, Some(e), None);
                }
                ExprKind::Index { obj, index, .. } => {
                    let key = self.type_of_expr(file, index);
                    // `shouldDeferIndexedAccessType`: no property is looked up for a generic key.
                    if self.is_generic(key) {
                        continue;
                    }
                    let receiver = self.type_of_expr(file, obj);
                    let receiver = self.non_nullable(receiver);
                    // `getIndexedAccessTypeOrUndefined`: each member of a union of keys names a property.
                    for &k in self.parts(key) {
                        if let Some(name) = self.property_name_of_type(k).filter(|&n| is_private(n))
                        {
                            self.note_property(file, u, receiver, name, Some(e), None);
                        }
                    }
                }
                // `({ x } = o)`: `checkBinaryLikeExpression`
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_)) => {
                    let source = self.type_of_expr(file, value);
                    let from_this = (matches!(hir[value].kind, ExprKind::This)
                        && !is_parenthesized(hir, value))
                    .then_some(e);
                    self.note_destructured(file, u, target, source, from_this);
                }
                // `#x in o`: `checkPrivateIdentifierExpression`. Counts as a read, whatever `o` is
                // and wherever the expression appears.
                ExprKind::Binary {
                    op: BinOp::In,
                    left,
                    ..
                } => {
                    if let Some(&class) = bound.private_class.get(&left)
                        && let ExprKind::String(name) = hir[left].kind
                    {
                        // `lookupSymbolForPrivateIdentifierDeclaration`: the members of the class before its statics.
                        let find = |is_static: bool| {
                            hir[class].members.iter().find(|&m| {
                                hir[m].key == PropKey::Private(name)
                                    && hir[m].flags.contains(Flags::STATIC) == is_static
                            })
                        };
                        if let Some(m) = find(false).or_else(|| find(true)) {
                            let symbol = self.symbol_of_member(file, m);
                            u.referenced_members.insert(symbol);
                        }
                    }
                }
                _ => {}
            }
        }
        // `for ({ x } of os)`: `checkForOfStatement`
        for (i, s) in hir.stmts.iter().enumerate() {
            if let StmtKind::ForOf {
                left,
                expr,
                is_await,
                ..
            } = s.kind
                && !matches!(bound.stmt_parent[i], Parent::None)
                && !hir.is_in_with(s.start)
                && let StmtKind::Expr(target) = hir[left].kind
                && matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
            {
                let visited = self.type_of_expr(file, expr);
                let source = self.iterated_type(visited, is_await);
                self.note_destructured(file, u, target, source, None);
            }
        }
        // `const { x } = o`: `checkVariableLikeDeclaration`. The name of every binding element is
        // looked up in the destructured type, even the name of a rest element or of an array
        // pattern element.
        let unchecked = self.unchecked_jsdoc_types(file);
        for i in 0..hir.pats.len() {
            if hir.is_in_with(hir.pats[i].pos)
                || matches!(bound.pat_parent[i], PatParent::None)
                || unchecked.contain(hir.pats[i].pos)
            {
                continue;
            }
            match hir.pats[i].kind {
                PatKind::Object(props) => {
                    let whole = self.type_of_pat(file, PatId(i as u32));
                    for p in props.iter() {
                        let name = match hir[hir[p].value].kind {
                            PatKind::Ident(name) if hir[p].is_rest => Some(name),
                            _ => self.member_name(file, hir[p].key),
                        };
                        if let Some(name) = name.filter(|&n| is_private(n)) {
                            self.note_property(file, u, whole, name, None, None);
                        }
                    }
                }
                PatKind::Array(elems) => {
                    let whole = self.type_of_pat(file, PatId(i as u32));
                    for element in elems.iter() {
                        if let PatKind::Ident(name) = hir[hir[element].pat].kind
                            && is_private(name)
                        {
                            self.note_property(file, u, whole, name, None, None);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// `checkDestructuringAssignment`: `target`, the pattern of a destructuring assignment or a
    /// part of it, is assigned `source`.
    /// `from_this`: the assignment, if `target` is its whole pattern and the right-hand side is
    /// `this`.
    fn note_destructured(
        &mut self,
        file: FileId,
        u: &mut Unused,
        target: ExprId,
        source: TypeId,
        from_this: Option<ExprId>,
    ) {
        let hir = self.hir(file);
        // Whether `e` is a nested pattern, with or without a default.
        let is_pattern = |e: ExprId| {
            let e = match hir[e].kind {
                ExprKind::Assign {
                    op: None, target, ..
                } => target,
                _ => e,
            };
            matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_))
        };
        match hir[target].kind {
            // The default is assigned too, as an ordinary assignment.
            ExprKind::Assign {
                op: None, target, ..
            } => {
                let source = if self.p.files.options.strict_null_checks {
                    self.without_undefined(source)
                } else {
                    source
                };
                self.note_destructured(file, u, target, source, None);
            }
            // `checkObjectLiteralDestructuringPropertyAssignment`
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if !matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) {
                        continue;
                    }
                    let Some(name) = self.member_name(file, hir[p].key) else {
                        continue;
                    };
                    self.note_property(file, u, source, name, None, from_this);
                    if hir[p].value.is_some()
                        && is_pattern(hir[p].value)
                        && let Some(element) = self.type_of_property(source, name)
                    {
                        self.note_destructured(file, u, hir[p].value, element, None);
                    }
                }
            }
            // `checkArrayLiteralAssignment`
            ExprKind::Array(items) => {
                for (i, item) in hir.ids(items).enumerate() {
                    let (item, is_rest) = match hir[item].kind {
                        ExprKind::Spread(rest) => (rest, true),
                        _ => (item, false),
                    };
                    if is_pattern(item) {
                        let element = self.element_of_destructured(source, i, is_rest, None);
                        self.note_destructured(file, u, item, element, None);
                    }
                }
            }
            _ => {}
        }
    }

    /// `markPropertyAsReferenced` for the property `name` of `receiver`. `at`: the `a.b` or `a[b]`
    /// that accesses it, if any.
    /// `from_this`: the assignment, for a property named in the pattern of `({ b } = this)`.
    fn note_property(
        &mut self,
        file: FileId,
        u: &mut Unused,
        receiver: TypeId,
        name: Atom,
        at: Option<ExprId>,
        from_this: Option<ExprId>,
    ) {
        let is_this_type = matches!(self.data(receiver), TypeData::ThisParam(_));
        let receiver = self.apparent_type(receiver);
        // `createUnionOrIntersectionProperty`: a private property must exist in every member of a
        // union. If all members have the same property, the result is the first member's property.
        // Otherwise there is no property, or a synthesized one, and that one is marked.
        let mut found: Option<(&Prop, MapperId)> = None;
        for &part in self.parts(receiver) {
            let part = self.apparent_type(part);
            if part == TypeId::UNRESOLVED {
                return u.note_members_named(name);
            }
            let Some((mut prop, mut mapper)) = self.prop_ref(part, name) else {
                return;
            };
            if let PropSource::Intersected(_, list) = &prop.source {
                let Some(first) = list.first() else { return };
                if list.iter().any(|other| {
                    !self.is_same_property(first, MapperId::IDENTITY, other, MapperId::IDENTITY)
                }) {
                    return;
                }
                (prop, mapper) = (first, MapperId::IDENTITY);
            }
            let Some(first) = &found else {
                let is_private = match self.value_declaration_of_prop(prop) {
                    Some((f, Decl::Member(m))) => {
                        let member = &self.hir(f)[m];
                        member.flags.contains(Flags::PRIVATE)
                            || matches!(member.key, PropKey::Private(_))
                    }
                    Some((f, Decl::ParameterProperty(p))) => {
                        self.hir(f)[p].flags.contains(Flags::PRIVATE)
                    }
                    _ => false,
                };
                if !is_private {
                    return;
                }
                found = Some((prop, mapper));
                continue;
            };
            if !self.is_same_property(first.0, first.1, prop, mapper) {
                return;
            }
        }
        let Some((prop, _)) = found else { return };
        let PropSource::Symbol(symbol) = prop.source else {
            return;
        };
        // A write-only access is not a reference, unless the write calls a setter.
        if at.is_some_and(|e| u.is_write_only(e))
            && !self
                .flags_of_property(symbol)
                .contains(SymFlags::SET_ACCESSOR)
        {
            return;
        }
        // A self-reference from inside any declaration of the member is not a reference.
        if (from_this.is_some() || at.is_some_and(|e| self.is_self_type_access(file, e, receiver)))
            && let Some(inside) = at.or(from_this).and_then(|e| u.enclosing_member_fn(e))
            && self.symbol_of_member(file, inside) == symbol
            && (is_this_type || {
                let members = self.members_of_symbol(symbol);
                self.is_uninstantiated(file, &members)
            })
        {
            return;
        }
        u.referenced_members.insert(symbol);
    }

    /// Whether `createUnionOrIntersectionProperty` treats the two as the same property: same
    /// declaration, same type.
    fn is_same_property(
        &mut self,
        a: &Prop,
        a_mapper: MapperId,
        b: &Prop,
        b_mapper: MapperId,
    ) -> bool {
        a.source == b.source && {
            let (a, b) = (
                self.type_of_prop(a, a_mapper),
                self.type_of_prop(b, b_mapper),
            );
            a == b
        }
    }

    /// `isSelfTypeAccess` for `e`: `obj.name`, or `obj[key]` where `of` is the type a property
    /// access uses for `obj`.
    fn is_self_type_access(&self, file: FileId, e: ExprId, of: TypeId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (obj, is_dot) = match hir[e].kind {
            ExprKind::Dot { obj, .. } => (obj, true),
            ExprKind::Index { obj, .. } => (obj, false),
            _ => return false,
        };
        if is_parenthesized(hir, obj) {
            return false;
        }
        if matches!(hir[obj].kind, ExprKind::This) {
            return true;
        }
        // The symbol of `a` in `a.b` is compared with the symbol of its first identifier. For
        // `a.c.b` the former is the property `c`, which is not the symbol of `a`.
        if is_dot {
            return matches!(hir[obj].kind, ExprKind::Ident(_));
        }
        if !is_entity_name_expression(hir, obj) {
            return false;
        }
        let first = first_identifier(hir, obj);
        // For `a[k]` it is the symbol of the type of `a`: the class.
        let class = match self.data(of) {
            TypeData::Ref { target, .. } => *target,
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            } => *class,
            _ => return false,
        };
        let symbol = bound.expr_symbol[first.idx()];
        matches!(hir[first].kind, ExprKind::Ident(_))
            && symbol.is_some()
            && self.files().sym(file, symbol) == class
            // The name of a declaration with an `export` modifier resolves to the local symbol,
            // while the type has the export symbol.
            && !bound.symbols[symbol.idx()].decls.iter().any(|d| matches!(*d, Decl::Class(c) if hir[c].flags.contains(Flags::EXPORT)))
    }

    /// Whether the property that `members` declare is the declared symbol in every type it is found
    /// in: `instantiateSymbol` returns it unchanged.
    fn is_uninstantiated(&mut self, file: FileId, members: &[(FileId, MemberId)]) -> bool {
        // The properties of the static side are the exports of the class themselves.
        if members
            .iter()
            .all(|&(f, m)| self.hir(f)[m].flags.contains(Flags::STATIC))
        {
            return true;
        }
        // `isThisless`, in a class whose only type parameter to instantiate is `this`.
        let &[(of, m)] = members else { return false };
        if of != file {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let MemberOwner::Class(class) = bound.member_owner[m.idx()] else {
            return false;
        };
        is_thisless(hir, m)
            && self
                .outer_type_params(file, bound.class_scope[class.idx()])
                .iter()
                .all(|&t| matches!(self.data(t), TypeData::ThisParam(_)))
    }
}

/// The first position of `needle` in `text` at or after `from`.
fn find_bytes(text: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    let (&first, rest) = needle.split_first()?;
    let mut at = from;
    loop {
        at += text.get(at..)?.iter().position(|&c| c == first)?;
        if text[at + 1..].starts_with(rest) {
            return Some(at);
        }
        at += 1;
    }
}

/// The last byte of the token before the comment that starts at `open`, if both are on the same
/// line, ignoring comments between them. `GetLeadingCommentRanges` collects a comment only after a
/// line break or at the start of the text.
fn byte_before_comment(text: &[u8], mut open: usize) -> Option<u8> {
    loop {
        let before = text[..open].trim_ascii_end();
        if bun_core::strings::index_of_any(&text[before.len()..open], b"\n\r").is_some() {
            return None;
        }
        let &last = before.last()?;
        let comment = before
            .strip_suffix(b"*/")
            .and_then(|rest| bun_core::strings::last_index_of(rest, b"/*"));
        match comment {
            Some(comment) => open = comment,
            None => return Some(last),
        }
    }
}

/// The identifier at `at`, possibly empty. `ScanJSDocToken` treats a `-` as an identifier part.
fn identifier_at(text: &[u8], at: usize, is_jsdoc_token: bool) -> &[u8] {
    let rest = text.get(at..).unwrap_or(&[]);
    let is_start = |c: u8| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$') || c >= 0x80;
    if !rest.first().is_some_and(|&c| is_start(c)) {
        return &[];
    }
    let is_part = |c: u8| is_start(c) || c.is_ascii_digit() || is_jsdoc_token && c == b'-';
    let len = rest.iter().position(|&c| !is_part(c));
    &rest[..len.unwrap_or(rest.len())]
}

/// `parseJSDocLink`, `parseJSDocLinkName`: the names of each `{@link a.b}`, `{@linkcode a.b}` and `{@linkplain a.b}` in the text of
/// a JSDoc comment. A missing name is empty.
fn jsdoc_link_names(comment: &[u8]) -> Vec<Vec<&[u8]>> {
    let skip_spaces = |mut at: usize| {
        while comment.get(at).is_some_and(|c| c.is_ascii_whitespace()) {
            at += 1;
        }
        at
    };
    let mut links = Vec::new();
    // `jsdocStateSavingBackticks`, `inFencedCodeBlock`, `backtickCount`
    let (mut in_backticks, mut in_fence, mut backticks) = (false, false, 0u32);
    let mut i = 0;
    while let Some(&c) = comment.get(i) {
        if c != b'`' && backticks > 0 {
            in_fence ^= backticks >= 3;
            backticks = 0;
        }
        i += 1;
        match c {
            b'\n' | b'\r' => in_backticks = false,
            b'`' => {
                backticks += 1;
                in_backticks = !in_backticks;
            }
            b'{' if !in_backticks && !in_fence && comment.get(i) == Some(&b'@') => {
                let tag = identifier_at(comment, i + 1, true);
                if !matches!(tag, b"link" | b"linkcode" | b"linkplain") {
                    continue;
                }
                i = skip_spaces(i + 1 + tag.len());
                let first = identifier_at(comment, i, true);
                if !first.is_empty() {
                    i += first.len();
                    let mut names = vec![first];
                    // After the dots, `a#b` is parsed like `a.b`.
                    let mut dots = true;
                    loop {
                        let mut at = skip_spaces(i);
                        match comment.get(at) {
                            Some(b'.') if dots => at = skip_spaces(at + 1),
                            Some(b'#') if !identifier_at(comment, at + 1, false).is_empty() => {
                                dots = false;
                                at += 1;
                            }
                            _ => break,
                        }
                        let name = identifier_at(comment, at, false);
                        names.push(name);
                        i = at + name.len();
                    }
                    links.push(names);
                }
                // The rest of the link is text.
                let rest = &comment[i..];
                let end = bun_core::strings::index_of_any(rest, b"}\n\r");
                i += end.unwrap_or(rest.len());
            }
            _ => {}
        }
    }
    links
}

/// The position of the bracket that closes the brackets around `from`, or the end of `text`. Brackets in strings and comments count
/// as well.
fn closing_bracket_after(text: &[u8], from: usize) -> u32 {
    let mut depth = 0u32;
    for (i, &c) in text.iter().enumerate().skip(from) {
        match c {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => return i as u32,
            b')' | b']' | b'}' => depth -= 1,
            _ => {}
        }
    }
    text.len() as u32
}

/// `isThisless` for a method or an accessor.
fn is_thisless(hir: &hir::File, m: MemberId) -> bool {
    if !matches!(
        hir[m].kind,
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter
    ) || hir[m].func.is_none()
    {
        return false;
    }
    let f = &hir[hir[m].func];
    // `isThislessVariableLikeDeclaration`
    let is_thisless_parameter = |p: ParamId| {
        if hir[p].ty.is_some() {
            is_thisless_type(hir, hir[p].ty)
        } else {
            hir[p].default.is_none()
        }
    };
    f.ret.is_some()
        && is_thisless_type(hir, f.ret)
        && (f.this_ty(hir).is_none() || is_thisless_type(hir, f.this_ty(hir)))
        && f.params.iter().all(is_thisless_parameter)
        && f.type_params
            .iter()
            .all(|t| hir[t].constraint.is_none() || is_thisless_type(hir, hir[t].constraint))
}

/// `isThislessType`
fn is_thisless_type(hir: &hir::File, t: TypeNodeId) -> bool {
    // A parenthesized type is not inspected. Parentheses are only visible in the source text.
    if hir
        .text
        .get(..hir[t].pos as usize)
        .is_some_and(|before| before.trim_ascii_end().ends_with(b"("))
    {
        return false;
    }
    match hir[t].kind {
        TypeNodeKind::Keyword(keyword) => !matches!(keyword, Keyword::This | Keyword::Intrinsic),
        TypeNodeKind::StringLit(_)
        | TypeNodeKind::NumberLit(_)
        | TypeNodeKind::BigIntLit { .. }
        | TypeNodeKind::BoolLit(_) => true,
        TypeNodeKind::Array(element) => is_thisless_type(hir, element),
        TypeNodeKind::Ref { args, .. } => hir.ids(args).all(|a| is_thisless_type(hir, a)),
        _ => false,
    }
}

impl Unused<'_, '_> {
    // ───────────────────────────── references ─────────────────────────────

    fn note_references(&mut self, index: &ExprsByKind) {
        let (hir, bound) = (self.hir, self.bound);
        for &e in index.of(ExprTag::Ident) {
            let i = e.idx();
            let symbol = bound.expr_symbol[i];
            if symbol.is_none()
                || self.referenced[symbol.idx()] & VALUE != 0
                || bound.is_unchecked(i)
                || self.is_unchecked(e)
                || self.is_write_only(e)
                || self.is_inside_declaration_of(e, symbol)
            {
                continue;
            }
            // `checkVariableLikeDeclaration` only validates the alias that `const x = require("m")` declares. It does not check the
            // initializer, so it does not resolve the callee.
            if let Parent::Expr(call) = bound.expr_parent[i]
                && call.is_some()
                && let Parent::VarInit(d) = bound.expr_parent[call.idx()]
                && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
                && bound.required_by(hir, hir[d].pat).is_some()
            {
                continue;
            }
            self.referenced[symbol.idx()] |= VALUE;
        }
        for i in 0..hir.types.len() {
            let scope = bound.type_scope[i];
            let TypeNodeKind::Ref { name, .. } = hir.types[i].kind else {
                continue;
            };
            if bound.is_unchecked_type(i)
                || hir.is_in_with(hir.types[i].pos)
                || self.is_never_checked(hir.types[i].pos)
            {
                continue;
            }
            let Some(first) = hir.texts(name).next() else {
                continue;
            };
            let (meaning, bit) = if name.len() == 1 {
                (SymFlags::TYPE, TYPE)
            } else {
                (SymFlags::NAMESPACE, NAMESPACE)
            };
            if meaning == SymFlags::NAMESPACE {
                self.note_namespace(scope, first);
            } else {
                self.note_name(scope, first, meaning, bit);
            }
        }
        for (i, s) in hir.stmts.iter().enumerate() {
            if matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            match s.kind {
                // `export { a }` references `a` with any meaning.
                StmtKind::ExportNamed(id) if hir[id].spec.is_none() => {
                    let scope = bound.export_scope[id.idx()];
                    for item in hir[id].items.iter() {
                        self.note_name(scope, hir[item].local, SymFlags::all(), ALL);
                    }
                }
                StmtKind::ImportEquals(id) => {
                    if let ImportEqualsTarget::Entity(names) = hir[id].target
                        && let Some(first) = hir.texts(names).next()
                    {
                        self.note_name(
                            bound.import_equals_scope[id.idx()],
                            first,
                            SymFlags::all(),
                            ALL,
                        );
                    }
                }
                _ => {}
            }
        }
        // `export default I`, `export = I`: a type is accepted too.
        for &(e, scope) in &bound.free_idents {
            if let Parent::Stmt(s) = bound.expr_parent[e.idx()]
                && matches!(
                    hir[s].kind,
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                )
                && let ExprKind::Ident(name) = hir[e].kind
            {
                self.note_name(scope, name, SymFlags::all(), ALL);
            }
        }
    }

    /// Property access `.name` on a receiver whose type did not resolve: conservatively marks every member of the file with that name as referenced.
    fn note_members_named(&mut self, name: Atom) {
        let (hir, bound) = (self.hir, self.bound);
        let members = (0..hir.members.len())
            .filter(|&m| hir.members[m].key.name() == Some(name))
            .map(|m| bound.member_symbol[m]);
        let is_it = |p: &ParamId| {
            hir[*p].flags.contains(Flags::PRIVATE)
                && matches!(hir[hir[*p].pat].kind, PatKind::Ident(n) if n == name)
        };
        let properties = (0..hir.params.len() as u32)
            .map(ParamId)
            .filter(is_it)
            .map(|p| bound.symbol_of_declaration(Decl::ParameterProperty(p)));
        let symbols = members.chain(properties).filter(|symbol| symbol.is_some());
        self.referenced_members
            .extend(symbols.map(|symbol| self.files.sym(self.file, symbol)));
    }

    /// The scope that contains `e`. If the binder did not record it, the scope of the innermost
    /// enclosing function, class or namespace.
    fn scope_of(&self, e: ExprId) -> ScopeId {
        let (hir, bound) = (self.hir, self.bound);
        if let Some(&scope) = bound.expr_scope.get(&e) {
            return scope;
        }
        let mut scope = ScopeId(0);
        hir.find_ancestor(hir.parent(hir.node(e)), |around| {
            let (function, class) = (hir.function_of(around), hir.class_of(around));
            let found = match hir.data(around) {
                _ if function.is_some() => bound.fns[function.idx()].scope,
                _ if class.is_some() => bound.class_scope[class.idx()],
                NodeData::Stmt(s) => match hir[s].kind {
                    StmtKind::Module(m) => bound.module_scope[m.idx()],
                    _ => ScopeId::NONE,
                },
                _ => ScopeId::NONE,
            };
            if found.is_some() {
                scope = found;
            }
            found.is_some()
        });
        scope
    }

    /// The scope the names in the JSDoc comment `open..end` are resolved from: that of the
    /// statement, member or parameter it is attached to (`withJSDoc`), which are the nodes passed
    /// to `checkSourceElement`. `NONE` if it is attached to no node.
    fn scope_of_jsdoc(&self, open: usize, end: usize) -> ScopeId {
        let (hir, bound) = (self.hir, self.bound);
        let text: &[u8] = &hir.text;
        // Start of the host, including decorators and modifiers.
        let first = skip_trivia(text, end) as u32;
        if hir.is_in_with(first) {
            return ScopeId::NONE;
        }
        // `GetJSDocCommentRanges`: a parameter also owns the comments on the same line as the
        // previous token.
        let before = byte_before_comment(text, open);
        if before.is_none() {
            if let Some(s) = (0..hir.stmts.len()).find(|&i| {
                hir.stmts[i].start == first && !matches!(bound.stmt_parent[i], Parent::None)
            }) {
                return self.scope_of_statement(StmtId(s as u32));
            }
            if let Some(m) = hir.members.iter().position(|m| m.start == first) {
                return self.scope_of_member(MemberId(m as u32));
            }
            if let Some(m) = hir.enum_members.iter().position(|m| m.pos == first) {
                let owner = bound.enum_member_owner[m];
                return bound
                    .enum_scope
                    .get(owner.idx())
                    .map_or(ScopeId::NONE, |&it| it);
            }
        }
        match hir.params.iter().position(|p| p.pos == first) {
            Some(p)
                if bound.param_fn[p].is_some() && matches!(before, None | Some(b'(' | b',')) =>
            {
                bound.fns[bound.param_fn[p].idx()].scope
            }
            _ => ScopeId::NONE,
        }
    }

    /// The scope of the declaration that `s` is. For any other statement, the scope of the
    /// innermost enclosing function or namespace.
    fn scope_of_statement(&self, mut s: StmtId) -> ScopeId {
        let (hir, bound) = (self.hir, self.bound);
        match hir[s].kind {
            StmtKind::Fn(f) => return bound.fns[f.idx()].scope,
            StmtKind::Class(class) => return bound.class_scope[class.idx()],
            StmtKind::Interface(id) => return bound.interface_scope[id.idx()],
            StmtKind::TypeAlias(alias) => return bound.alias_scope[alias.idx()],
            StmtKind::Enum(e) => return bound.enum_scope[e.idx()],
            StmtKind::Module(m) => return bound.module_scope[m.idx()],
            _ => {}
        }
        loop {
            match bound.stmt_parent[s.idx()] {
                Parent::Stmt(outer) if outer.is_some() => s = outer,
                Parent::Case(case) if bound.case_stmt[case.idx()].is_some() => {
                    s = bound.case_stmt[case.idx()]
                }
                Parent::FnBody(f) => return bound.fns[f.idx()].scope,
                Parent::Module(m) => return bound.module_scope[m.idx()],
                Parent::File => return ScopeId(0),
                _ => return ScopeId::NONE,
            }
        }
    }

    /// `GetHostSignatureFromJSDoc`: the scope of the signature that `m` is, or that is the type of
    /// `m` if it is a property signature. Otherwise the scope `m` is declared in.
    fn scope_of_member(&self, m: MemberId) -> ScopeId {
        let (hir, bound) = (self.hir, self.bound);
        let (member, owner) = (&hir[m], bound.member_owner[m.idx()]);
        if member.func.is_some() {
            return bound.fns[member.func.idx()].scope;
        }
        if !matches!(owner, MemberOwner::Class(_))
            && member.ty.is_some()
            && let TypeNodeKind::Fn(f) = hir[member.ty].kind
        {
            return bound.fns[f.idx()].scope;
        }
        match owner {
            MemberOwner::Class(class) => bound.class_scope[class.idx()],
            MemberOwner::Interface(id) => bound.interface_scope[id.idx()],
            MemberOwner::TypeLiteral(t) => bound.type_scope[t.idx()],
            MemberOwner::None => ScopeId::NONE,
        }
    }

    /// `resolveEntityName(name, SymbolFlagsNamespace)`: a name that does not resolve to a namespace
    /// is looked up again, as an alias, with `isUse`. That lookup passes over a variable of the
    /// name, so it marks an import that the variable shadows.
    fn note_namespace(&mut self, scope: ScopeId, name: Atom) {
        let meaning = SymFlags::NAMESPACE;
        if self.note_name(scope, name, meaning, NAMESPACE).is_none()
            && (self.files.resolve_name(self.file, scope, name, meaning)).is_none()
        {
            self.note_name(scope, name, SymFlags::ALIAS, ALIAS);
        }
    }

    /// `Resolve` with `isUse`. Returns the symbol the name resolves to, if it is declared in the
    /// file.
    fn note_name(
        &mut self,
        from: ScopeId,
        name: Atom,
        meaning: SymFlags,
        bit: u8,
    ) -> Option<SymbolId> {
        let files = self.files;
        // The most recently searched scope.
        let mut found_in = ScopeId::NONE;
        let lookup = &mut |table: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            if let SymbolTable::Locals(_, scope) = table {
                found_in = scope;
            }
            held.filter(|&sym| files.means(sym, meaning))
        };
        let start = self.bound.scope_to_resolve_from(from, name);
        let found = files
            .resolve_with(self.file, start, name, meaning, false, lookup)
            .ok()??;
        let found = files
            .parts(found)
            .iter()
            .find(|part| part.file == self.file)?
            .id;
        // `lastSelfReferenceLocation`: the outermost declaration that contains the name, below the
        // scope where it is found.
        let mut inside = SymbolId::NONE;
        let mut scope = from;
        while scope != found_in {
            if self.owner_of_scope[scope.idx()].is_some() {
                inside = self.owner_of_scope[scope.idx()];
            }
            scope = self.bound.scopes[scope.idx()].parent;
        }
        if found != inside {
            self.referenced[found.idx()] |= bit;
        }
        Some(found)
    }

    /// `IsWriteOnlyAccess`
    fn is_write_only(&self, e: ExprId) -> bool {
        self.bound.is_write_only_access(self.hir, e)
    }

    /// Whether `e` is inside a function, class, enum or namespace declaration of `symbol`:
    /// `isSelfReferenceLocation`.
    fn is_inside_declaration_of(&self, e: ExprId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        bound.symbols[symbol.idx()]
            .flags
            .intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM | SymFlags::MODULE)
            && bound.symbols[symbol.idx()].decls.iter().any(|&d| {
                // The span of the declaration contains `e`: a position test instead of an ancestor walk.
                matches!(
                    d,
                    Decl::Fn(_) | Decl::Class(_) | Decl::Enum(_) | Decl::Module(_)
                ) && matches!(hir.data(hir.node(d)), NodeData::Stmt(s)
                        if (hir[s].loc.pos..hir[s].loc.end).contains(&hir[e].pos))
            })
    }

    /// The class method or accessor that directly contains `e`: `FindAncestor(e,
    /// IsFunctionLikeDeclaration)`, if that is one.
    fn enclosing_member_fn(&self, e: ExprId) -> Option<MemberId> {
        let hir = self.hir;
        let function = hir.find_ancestor(hir.parent(hir.node(e)), |n| {
            hir.function_of(n).is_some() && hir.kind(n) != Kind::ClassStaticBlockDeclaration
        });
        match hir.data(function) {
            NodeData::Member(m) => Some(m),
            _ => None,
        }
    }

    /// Whether the checker never visits `e`, so that nothing in `e` counts as a reference. `checkWithStatement` does not check the body
    /// of a `with` statement.
    fn is_unchecked(&self, e: ExprId) -> bool {
        self.hir.is_in_with(self.hir[e].pos)
            || self.has_unchecked_returns && self.is_in_unchecked_return(e)
            || self.is_never_checked(self.hir[e].pos)
    }

    fn is_never_checked(&self, pos: u32) -> bool {
        let mut never_checked = self.never_checked.iter();
        never_checked.any(|&(from, to)| (from..to).contains(&pos))
    }

    /// Whether `e` is in the expression of a `return` that is outside a function or directly in a class static block.
    /// `checkReturnStatement` reports such a statement and returns before it checks the expression.
    fn is_in_unchecked_return(&self, e: ExprId) -> bool {
        let hir = self.hir;
        // A `return` was visited, and the function that contains it has not been reached yet.
        let mut in_return = false;
        let static_block = hir.find_ancestor(hir.node(e), |around| {
            if hir.kind(around) == Kind::ReturnStatement {
                in_return = true;
            }
            let function = hir.function_of(around);
            function.is_some()
                && std::mem::take(&mut in_return)
                && hir[function].kind == FnKind::StaticBlock
        });
        static_block.is_some() || in_return
    }

    /// `allDeclarationsInSameSourceFile`
    fn is_declared_in_one_file(&self, symbol: SymbolId) -> bool {
        symbol.is_some()
            && !self.bound.symbols[symbol.idx()]
                .flags
                .contains(SymFlags::MERGED)
    }

    fn starts_with_underscore(&self, name: Atom) -> bool {
        name.is_some() && self.atoms.bytes(name).first() == Some(&b'_')
    }

    // `reportUnused` drops the diagnostics for a node that has
    // `NodeFlagsThisNodeOrAnySubNodesHasError`. The parser flags the first node it finishes after
    // an error (`finishNodeWithEnd`), and the binder flags the ancestors. Node ends are not stored,
    // so the `*_has_syntax_error` functions treat a node as extending to the start of the next
    // node.

    /// `NodeFlagsThisNodeOrAnySubNodesHasError`
    fn has_syntax_error(&self, location: Node) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let variable = |d: VarDeclId| {
            let stmt = bound.var_stmt[d.idx()];
            match hir.stmts.get(stmt.idx()).map(|s| s.kind) {
                Some(StmtKind::Var(decls)) => {
                    let i = decls.iter().position(|other| other == d);
                    i.is_some_and(|i| self.variable_has_syntax_error(stmt, decls, i))
                }
                _ => false,
            }
        };
        match hir.data(location) {
            NodeData::Stmt(s) => self.statement_has_syntax_error(s),
            NodeData::VarDecl(d) => variable(d),
            NodeData::Param(p) => self.parameter_has_syntax_error(p),
            NodeData::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => self.member_has_syntax_error(class, m),
                _ => false,
            },
            // The error may be in another part of the import than the one that is unused: node ends
            // are not stored.
            NodeData::ImportSpec(_)
            | NodeData::Part(Part::ImportClause | Part::NamedBindings, _) => {
                let is_statement = |n: Node| matches!(hir.data(n), NodeData::Stmt(_));
                self.has_syntax_error(hir.find_ancestor(location, is_statement))
            }
            NodeData::Part(Part::DeclarationList, row) => match hir.data(row) {
                NodeData::Stmt(s) => match hir[s].kind {
                    StmtKind::Var(decls) => decls.iter().any(variable),
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether a syntax error starts in `start..=end`.
    fn has_syntax_error_in(&self, start: u32, end: u32) -> bool {
        let first = self.syntax_errors.partition_point(|&at| at < start);
        self.syntax_errors.get(first).is_some_and(|&at| at <= end)
    }

    /// Whether a name in `pat` is missing (`createMissingIdentifier`).
    fn has_missing_name(&self, pat: PatId) -> bool {
        let hir = self.hir;
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(name) => name == known::empty,
            PatKind::Object(props) => props.iter().any(|p| self.has_missing_name(hir[p].value)),
            PatKind::Array(elems) => elems.iter().any(|e| self.has_missing_name(hir[e].pat)),
        }
    }

    /// Start of the node after the statement `s`, and whether that node is a statement. If nothing
    /// follows `s`, the position of the closing bracket of the enclosing block.
    fn start_of_next(&self, s: StmtId) -> (u32, bool) {
        let (hir, bound) = (self.hir, self.bound);
        let next_in = |list: IdList<StmtId>| hir.ids(list).skip_while(|&other| other != s).nth(1);
        let next = match bound.stmt_parent[s.idx()] {
            Parent::File => next_in(hir.body),
            Parent::Module(m) => next_in(hir[m].body),
            Parent::FnBody(f) => match hir[f].body {
                FnBody::Block(list) => next_in(list),
                _ => None,
            },
            Parent::Stmt(outer) if outer.is_some() => match hir[outer].kind {
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                } if init == s => {
                    let next = if test.is_some() {
                        hir[test].pos
                    } else if update.is_some() {
                        hir[update].pos
                    } else {
                        hir[body].start
                    };
                    return (next, false);
                }
                StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. }
                    if left == s =>
                {
                    return (hir[expr].pos, false);
                }
                StmtKind::Block(list) => next_in(list),
                StmtKind::Switch { cases, .. } => cases.iter().find_map(|c| next_in(hir[c].body)),
                _ => None,
            },
            _ => None,
        };
        match next {
            Some(next) => (hir[next].start, true),
            None => (
                closing_bracket_after(&hir.text, hir[s].start as usize),
                false,
            ),
        }
    }

    fn statement_has_syntax_error(&self, stmt: StmtId) -> bool {
        if self.syntax_errors.is_empty() {
            return false;
        }
        let start = self.hir[stmt].start;
        // An error at the start of the next statement belongs to that statement.
        let end = match self.start_of_next(stmt) {
            (next, true) => next.saturating_sub(1),
            (end, false) => end,
        };
        end >= start && self.has_syntax_error_in(start, end)
    }

    /// For declaration `i` of `decls`, the declarations of the variable statement `stmt`.
    fn variable_has_syntax_error(&self, stmt: StmtId, decls: Span<VarDeclId>, i: usize) -> bool {
        let hir = self.hir;
        let pat = hir[decls.at(i)].pat;
        if self.has_missing_name(pat) {
            return true;
        }
        if self.syntax_errors.is_empty() {
            return false;
        }
        let start = hir[pat].pos;
        if i + 1 < decls.len() {
            // A missing `,` is reported at the next declaration, and the first node finished after it is in there.
            let next = hir[hir[decls.at(i + 1)].pat].pos;
            return next > start && self.has_syntax_error_in(start, next - 1);
        }
        // A missing type or initializer is reported at the token after the declaration.
        self.has_syntax_error_in(start, self.start_of_next(stmt).0)
    }

    fn parameter_has_syntax_error(&self, p: ParamId) -> bool {
        let hir = self.hir;
        if self.has_missing_name(hir[p].pat) {
            return true;
        }
        let f = self.bound.param_fn[p.idx()];
        if self.syntax_errors.is_empty() || f.is_none() {
            return false;
        }
        let start = hir[p].pos;
        let next = ParamId(p.0 + 1);
        if hir[f].params.range().contains(&next.idx()) {
            return hir[next].pos > start && self.has_syntax_error_in(start, hir[next].pos - 1);
        }
        // The last one extends to the `=>` of an arrow function or the `)` of the list.
        let end = if hir[f].kind == FnKind::Arrow {
            hir[f].anchor
        } else {
            closing_bracket_after(&hir.text, start as usize)
        };
        self.has_syntax_error_in(start, end)
    }

    fn member_has_syntax_error(&self, class: ClassId, m: MemberId) -> bool {
        if self.syntax_errors.is_empty() {
            return false;
        }
        let hir = self.hir;
        let start = hir[m].start;
        let next = MemberId(m.0 + 1);
        if hir[class].members.range().contains(&next.idx()) {
            return hir[next].start > start && self.has_syntax_error_in(start, hir[next].start - 1);
        }
        self.has_syntax_error_in(start, closing_bracket_after(&hir.text, start as usize))
    }

    /// `isUnreferencedVariableDeclaration`
    fn is_unreferenced(&self, pat: PatId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let name = match hir[pat].kind {
            PatKind::Missing => return true,
            PatKind::Object(props) => {
                return props.iter().all(|p| self.is_unreferenced(hir[p].value));
            }
            PatKind::Array(elems) => return elems.iter().all(|e| self.is_unreferenced(hir[e].pat)),
            PatKind::Ident(name) => name,
        };
        let symbol = bound.pat_symbol[pat.idx()];
        if symbol.is_some() && self.referenced[symbol.idx()] & VALUE != 0 {
            return false;
        }
        let excuses_underscore = match bound.pat_parent[pat.idx()] {
            PatParent::Param(_) => true,
            PatParent::Var(d) => {
                let stmt = bound.var_stmt[d.idx()];
                let heads_a_loop = stmt.is_some()
                    && matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(outer) if outer.is_some()
                        && matches!(hir[outer].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt));
                heads_a_loop || matches!(hir[d].kind, VarKind::Using | VarKind::AwaitUsing)
            }
            PatParent::Prop(parent, p) => {
                // In `{ a, ...b }`, `a` exists to be omitted from `b`.
                if let PatKind::Object(props) = hir[parent].kind
                    && let Some(last) = props.iter().last()
                    && last != p
                    && hir[last].is_rest
                {
                    return false;
                }
                // Only a binding that follows a property name could choose its name: not `{ _a }`,
                // not `{ ..._a }`.
                !hir[p].is_rest && hir[p].pos != hir[pat].pos
            }
            PatParent::Elem(..) => true,
            PatParent::None => false,
        };
        !(excuses_underscore && self.starts_with_underscore(name))
    }

    fn is_unreferenced_type_parameter(&self, p: TypeParamId) -> bool {
        let symbol = self.bound.type_param_symbol[p.idx()];
        symbol.is_some()
            && self.referenced[symbol.idx()] & TYPE == 0
            && !self.starts_with_underscore(self.hir[p].name)
    }
}

impl Checker<'_, '_> {
    /// `checkUnusedIdentifiers`. The nodes `registerForUnusedIdentifiersCheck` collects there are
    /// iterated by kind here.
    fn check_unused_identifiers(&mut self, u: &Unused<'_, '_>) {
        let (hir, bound) = (u.hir, u.bound);
        let unchecked = self.unchecked_jsdoc_types(u.file);
        for (i, scope) in bound.scopes.iter().enumerate() {
            let checks_locals = match scope.kind {
                // `checkSourceFile`: `IsExternalOrCommonJSModule`
                ScopeKind::File => hir.has_module_syntax || bound.commonjs_indicator.is_some(),
                ScopeKind::Module(_) | ScopeKind::Block => true,
                // Among overloads, only the implementation.
                ScopeKind::Fn(f) => {
                    !matches!(hir[f].body, FnBody::None)
                        && hir.kind(hir.node(f)).is_function_like_declaration()
                }
                _ => false,
            };
            if checks_locals {
                self.check_unused_locals_and_parameters(u, ScopeId(i as u32));
            }
        }
        if u.parameters {
            for (i, f) in hir.fns.iter().enumerate() {
                // Set for function declarations and named function expressions only. A method that several files declare in one
                // interface is one symbol too, which is not tracked.
                let symbol = bound.fn_symbol[i];
                if matches!(bound.fns[i].owner, FnOwner::None) || unchecked.contain(f.start) {
                    continue;
                }
                if symbol.is_none() || u.is_declared_in_one_file(symbol) {
                    self.check_unused_type_parameters(u, hir.node(FnId(i as u32)), f.type_params);
                }
            }
            for (i, c) in hir.classes.iter().enumerate() {
                if u.is_declared_in_one_file(bound.class_symbol[i]) {
                    let node = hir.node(ClassId(i as u32));
                    self.check_unused_type_parameters(u, node, c.type_params);
                }
            }
            for (i, a) in hir.aliases.iter().enumerate() {
                self.check_unused_type_parameters(u, hir.node(AliasId(i as u32)), a.type_params);
            }
            for (i, id) in hir.interfaces.iter().enumerate() {
                if u.is_declared_in_one_file(bound.interface_symbol[i]) {
                    let node = hir.node(InterfaceId(i as u32));
                    self.check_unused_type_parameters(u, node, id.type_params);
                }
            }
            // `checkUnusedInferTypeParameter`
            for (i, t) in hir.types.iter().enumerate() {
                if let TypeNodeKind::Infer(param) = t.kind
                    && hir[param].name != known::empty
                    && !unchecked.contain(t.pos)
                    && u.is_unreferenced_type_parameter(param)
                {
                    let at = self.place_of_token(u.file, hir[param].pos);
                    let args = [Arg::Atom(hir[param].name)];
                    self.report_unused(u, hir.node(TypeNodeId(i as u32)), true, at, 6196, &args);
                }
            }
        }
        if u.locals && !u.reads_unknown_members {
            self.check_unused_class_members(u);
        }
    }

    /// `reportUnused`
    fn report_unused(
        &mut self,
        u: &Unused<'_, '_>,
        location: Node,
        is_parameter: bool,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) {
        let is_error = if is_parameter { u.parameters } else { u.locals };
        if is_error && !u.hir.is_ambient(location) && !u.has_syntax_error(location) {
            self.error_at(at, code, args);
        }
    }

    /// `checkUnusedLocalsAndParameters`
    fn check_unused_locals_and_parameters(&mut self, u: &Unused<'_, '_>, scope: ScopeId) {
        let (hir, bound, file) = (u.hir, u.bound, u.file);
        let mut variable_parents: Vec<Node> = Vec::new();
        let mut import_clauses: Vec<(Node, Node)> = Vec::new();
        for &(name, local) in bound.table(bound.scopes[scope.idx()].locals) {
            // A missing name is a syntax error inside its declaration, so `reportUnused` drops its
            // diagnostic.
            if name == known::empty || name.is_none() {
                continue;
            }
            let symbol = &bound.symbols[local.idx()];
            let kinds = u.referenced[local.idx()];
            if if symbol.flags.contains(SymFlags::TYPE_PARAMETER) {
                !symbol.flags.intersects(SymFlags::VARIABLE) || kinds & VALUE != 0
            } else {
                kinds != 0
                    || symbol.export_symbol.is_some()
                    || symbol.flags.contains(SymFlags::MODULE_EXPORTS)
            } {
                continue;
            }
            for &decl in &symbol.decls {
                let declaration = hir.node(decl);
                match hir.kind(declaration) {
                    Kind::VariableDeclaration | Kind::Parameter | Kind::BindingElement => {
                        let parent = hir.parent(hir.get_root_declaration(declaration));
                        if !variable_parents.contains(&parent) {
                            variable_parents.push(parent);
                        }
                    }
                    Kind::ImportClause | Kind::ImportSpecifier | Kind::NamespaceImport => {
                        if !u.starts_with_underscore(name) {
                            // `importClauseFromImported`
                            let is_clause = |n: Node| hir.kind(n) == Kind::ImportClause;
                            import_clauses
                                .push((hir.find_ancestor(declaration, is_clause), declaration));
                        }
                    }
                    // `export default function f() {}`. `IsAmbientModule`
                    Kind::FunctionDeclaration
                    | Kind::ClassDeclaration
                    | Kind::InterfaceDeclaration
                    | Kind::TypeAliasDeclaration
                    | Kind::JSTypeAliasDeclaration
                    | Kind::EnumDeclaration
                    | Kind::ModuleDeclaration
                    | Kind::ImportEqualsDeclaration
                        if !hir
                            .flags(declaration)
                            .intersects(Flags::EXPORT | Flags::DEFAULT)
                            || matches!(
                                decl,
                                Decl::Alias(_)
                                    | Decl::Enum(_)
                                    | Decl::Module(_)
                                    | Decl::ImportEquals(_)
                            ) =>
                    {
                        self.report_unused_local(u, declaration, name)
                    }
                    _ => {}
                }
            }
        }
        for parent in variable_parents {
            let list = match hir.data(parent) {
                NodeData::Part(Part::DeclarationList, row) => hir.data(row),
                _ => NodeData::None,
            };
            if let NodeData::Stmt(stmt) = list
                && let StmtKind::Var(decls) = hir[stmt].kind
            {
                // `reportUnusedVariables`
                if decls.len() > 1 && decls.iter().all(|d| u.is_unreferenced(hir[d].pat)) {
                    let start = self.start_after_modifiers(file, stmt);
                    let at = (file, start, self.end_of_var_decl_list(file, decls));
                    self.report_unused(u, parent, false, at, 6199, &[]);
                } else {
                    for d in decls.iter() {
                        self.report_unused_variable_declaration(u, hir.node(d), hir[d].pat);
                    }
                }
            } else if let Some(function) = hir.fns.get(hir.function_of(parent).idx()) {
                // `reportUnusedParameters`, `reportUnusedVariableDeclarations`: not a parameter property, and not a parameter named `this`.
                for p in function.params.iter() {
                    if !hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                        && !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this))
                    {
                        self.report_unused_variable_declaration(u, hir.node(p), hir[p].pat);
                    }
                }
            }
        }
        // `reportUnusedImports`
        import_clauses.sort_unstable();
        for unuseds in import_clauses.chunk_by(|a, b| a.0 == b.0) {
            let clause = unuseds[0].0;
            let NodeData::Stmt(stmt) = hir.data(clause.row()) else {
                continue;
            };
            let StmtKind::Import(import) = hir[stmt].kind else {
                continue;
            };
            let import = &hir[import];
            let declaration_count = usize::from(import.default.is_some())
                + usize::from(import.namespace.is_some())
                + import.named.len();
            if declaration_count > 1 && declaration_count == unuseds.len() {
                let at = (file, hir[stmt].start, self.end_of_stmt(file, stmt));
                self.report_unused(u, clause, false, at, 6192, &[]);
            } else {
                for &(_, unused) in unuseds {
                    self.report_unused_local(u, unused, hir.text(hir.name(unused)));
                }
            }
        }
    }

    /// `reportUnusedLocal`
    fn report_unused_local(&mut self, u: &Unused<'_, '_>, node: Node, name: Atom) {
        let hir = u.hir;
        // `IsTypeDeclaration`: the bindings of `import type` are type declarations. (Not those of
        // `import { type T }`, nor `* as ns`.)
        let is_type_declaration = match hir.kind(node) {
            Kind::ClassDeclaration
            | Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::EnumDeclaration => true,
            Kind::ImportClause | Kind::ImportSpecifier => {
                let is_statement = |n: Node| matches!(hir.data(n), NodeData::Stmt(_));
                matches!(hir.data(hir.find_ancestor(node, is_statement)), NodeData::Stmt(s)
                    if matches!(hir[s].kind, StmtKind::Import(i) if hir[i].type_only))
            }
            _ => false,
        };
        let at = self.place_of_token(u.file, hir.start(hir.name(node)));
        let code = if is_type_declaration { 6196 } else { 6133 };
        self.report_unused(u, node, false, at, code, &[Arg::Atom(name)]);
    }

    /// `reportUnusedVariableDeclarations`, for one of them. `root`: the variable declaration or
    /// parameter whose name is or contains `pat`, which is the node `reportUnusedVariable` walks up
    /// to.
    fn report_unused_variable_declaration(&mut self, u: &Unused<'_, '_>, root: Node, pat: PatId) {
        let (hir, file) = (u.hir, u.file);
        let is_parameter = hir.kind(root) == Kind::Parameter;
        let elements: Vec<PatId> = match hir[pat].kind {
            PatKind::Missing => return,
            PatKind::Ident(name) => {
                if u.is_unreferenced(pat) {
                    let at = self.place_of_token(file, hir[pat].pos);
                    self.report_unused(u, root, is_parameter, at, 6133, &[Arg::Atom(name)]);
                }
                return;
            }
            PatKind::Object(props) => props.iter().map(|p| hir[p].value).collect(),
            PatKind::Array(elems) => elems.iter().map(|e| hir[e].pat).collect(),
        };
        // `reportUnusedBindingElements`
        if elements.len() > 1 && elements.iter().all(|&e| u.is_unreferenced(e)) {
            let at = (file, hir[pat].pos, self.end_of_pat(file, pat));
            self.report_unused(u, root, is_parameter, at, 6198, &[]);
        } else {
            for e in elements {
                self.report_unused_variable_declaration(u, root, e);
            }
        }
    }

    /// `checkUnusedTypeParameters` for the declaration `node`.
    fn check_unused_type_parameters(
        &mut self,
        u: &Unused<'_, '_>,
        node: Node,
        params: Span<TypeParamId>,
    ) {
        let (hir, file) = (u.hir, u.file);
        // `reportUnused` receives the declaration they belong to, which contains the syntax error
        // of a missing name.
        if params.iter().any(|p| hir[p].name == known::empty) {
            return;
        }
        if params.len() > 1 && params.iter().all(|p| u.is_unreferenced_type_parameter(p)) {
            // `rangeOfTypeParameters`: starts at the `<`. A list synthesized from `@template` tags
            // begins at the `@` of the first tag (`gatherTypeParameters`), so the range starts one
            // position before that.
            let first = hir[params.at(0)].start;
            let before = hir.text.get(..first as usize).unwrap_or_default();
            let open = if hir[params.at(0)].flags.contains(Flags::REPARSED) {
                bun_core::strings::last_index_of(before, b"@template")
                    .map(|at| at.saturating_sub(1))
            } else {
                bun_core::strings::last_index_of_char(before, b'<')
            };
            let start = open.map_or_else(|| first.saturating_sub(1), |at| at as u32);
            let last = self.end_of_type_param(file, params.at(params.len() - 1));
            let mut close = skip_trivia(&hir.text, last as usize);
            if hir.text.get(close) == Some(&b',') {
                close = skip_trivia(&hir.text, close + 1);
            }
            return self.report_unused(u, node, true, (file, start, close as u32 + 1), 6205, &[]);
        }
        for p in params.iter() {
            if u.is_unreferenced_type_parameter(p) {
                let at = (file, hir[p].start, self.end_of_type_param(file, p));
                self.report_unused(u, node, true, at, 6196, &[Arg::Atom(hir[p].name)]);
            }
        }
    }

    /// `checkUnusedClassMembers`
    fn check_unused_class_members(&mut self, u: &Unused<'_, '_>) {
        let (hir, bound, file) = (u.hir, u.bound, u.file);
        for (i, member) in hir.members.iter().enumerate() {
            let m = MemberId(i as u32);
            let MemberOwner::Class(_) = bound.member_owner[i] else {
                continue;
            };
            match member.kind {
                MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter => {
                    if !(member.flags.contains(Flags::PRIVATE)
                        || matches!(member.key, PropKey::Private(_)))
                    {
                        continue;
                    }
                    let symbol = self.symbol_of_member(file, m);
                    // Already reported on the getter.
                    if member.kind == MemberKind::Setter
                        && self
                            .flags_of_property(symbol)
                            .contains(SymFlags::GET_ACCESSOR)
                    {
                        continue;
                    }
                    if !u.referenced_members.contains(&symbol) {
                        let (start, end) = (member.name_pos, self.end_of_member_name(file, m));
                        let name = hir.text.get(start as usize..end as usize);
                        let (at, name) = ((file, start, end), Arg::Bytes(name.unwrap_or_default()));
                        self.report_unused(u, hir.node(m), false, at, 6133, &[name]);
                    }
                }
                MemberKind::Constructor => {
                    for p in hir[member.func].params.iter() {
                        // Whether the parameter property is referenced. The parameter itself may be referenced
                        // even if the property is not.
                        let property = bound.symbol_of_declaration(Decl::ParameterProperty(p));
                        let is_referenced = property.is_some()
                            && (u.referenced_members).contains(&self.files().sym(file, property));
                        if hir[p].flags.contains(Flags::PRIVATE) && !is_referenced {
                            let at = self.place_of_token(file, hir[hir[p].pat].pos);
                            let name = hir.text(hir.node(hir[p].pat));
                            self.report_unused(u, hir.node(p), false, at, 6138, &[Arg::Atom(name)]);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
