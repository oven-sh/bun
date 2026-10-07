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
use bun_core::lexer;
use std::borrow::Cow;

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
    /// `symbolReferenceLinks`, indexed by symbol: the meanings it was referenced with.
    referenced: Vec<u8>,
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

/// What a name resolves to where it is used.
#[derive(Copy, Clone)]
struct Use {
    /// A symbol of the file.
    symbol: SymbolId,
    /// The name is inside a declaration of the symbol (`lastSelfReferenceLocation`), which does not
    /// count as a reference.
    is_self_reference: bool,
}

/// What `Checker::private_property_read` finds.
enum PropertyRead {
    /// The type of the receiver did not resolve.
    Unresolved,
    /// No member of a class is marked.
    NotPrivate,
    Private(Sym),
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
            files: self.p.files,
            file,
            hir,
            bound,
            atoms: self.atoms(),
            referenced: vec![0; bound.symbols.len()],
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
        // `bindTypeParameter`: a type parameter of a class and a member of its name are one symbol.
        let is_member = |symbol: &SymbolId| {
            let symbol = bound.symbols.get(symbol.idx());
            symbol.is_some_and(|it| it.flags.intersects(SymFlags::CLASS_MEMBER))
        };
        if locals || bound.type_param_symbol.iter().any(is_member) {
            self.note_private_reads(file, &mut u);
            let is_declared_here = |symbol: &&Sym| symbol.file == file;
            let marked = self.referenced_properties.iter().filter(is_declared_here);
            for symbol in marked.copied().collect::<Vec<Sym>>() {
                self.note_property_symbol(&mut u, symbol);
            }
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
                self.note_evaluated(file, u, e, Location::Expr(file, e));
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
                self.note_evaluated(file, u, right, Location::Expr(file, right));
            }
        }
        // `computeConstantEnumMemberValue`
        for (i, member) in hir.enum_members.iter().enumerate() {
            if member.init.is_some() {
                let location = Location::Member(file, EnumMemberId(i as u32));
                self.note_evaluated(file, u, member.init, location);
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
    fn note_evaluated(&mut self, file: FileId, u: &mut Unused, e: ExprId, location: Location) {
        if self.is_stack_low() {
            return;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Unary {
                op:
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::PreInc | UnOp::PreDec,
                operand,
            } => self.note_evaluated(file, u, operand, location),
            ExprKind::Binary { left, right, .. }
            | ExprKind::Assign {
                target: left,
                value: right,
                ..
            } => {
                self.note_evaluated(file, u, left, location);
                self.note_evaluated(file, u, right, location);
            }
            // `evaluateTemplateExpression` stops at the first span without a value.
            ExprKind::Template { exprs } => {
                for span in hir.ids(exprs) {
                    self.note_evaluated(file, u, span, location);
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
            ExprKind::Ident(_) => {
                if let Some(symbol) = self.resolve_entity_name_expression(file, e, SymFlags::VALUE)
                    && let Some((of, d)) = self.constant_variable_declaration(symbol, location)
                    && of == file
                {
                    let location = Location::Variable(of, d);
                    self.note_evaluated(file, u, hir[d].init, location);
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
        // `shouldFactoryRefErr`
        let meaning = match options.jsx {
            crate::resolve::JsxEmit::Preserve | crate::resolve::JsxEmit::ReactNative => {
                SymFlags::VALUE.difference(SymFlags::ENUM)
            }
            _ => SymFlags::VALUE,
        };
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
            if let Some(found) = u.resolve_use(
                scope,
                if is_fragment {
                    fragment_factory
                } else {
                    factory
                },
                meaning,
            ) {
                u.referenced[found.symbol.idx()] |= ALL;
            }
            // `getJsxFactoryEntity`: a fragment uses both factories.
            if is_fragment {
                u.note_name(scope, factory, meaning, VALUE);
            }
        }
    }

    /// `checkJSDocComment`: the name of each `{@link name}` in the JSDoc of a node that
    /// `checkSourceElement` visits is resolved, which references its first identifier.
    fn note_jsdoc_links(&self, file: FileId, u: &mut Unused) {
        let atoms = &self.atoms();
        let hir = self.hir(file);
        let text: &[u8] = &hir.text;
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let mut from = 0;
        // `parseJSDocLinkPrefix`: every link starts with these two tokens.
        while let Some(link) = bun_core::strings::index_of(&text[from..], b"{@") {
            let Some(host) = u.jsdoc_host_at((from + link) as u32) else {
                from += link + 2;
                continue;
            };
            from = host.start as usize;
            let scope = host.scope;
            let comments = jsdoc_comment_ranges(text, &host, hir.is_js);
            let links = (comments.iter()).flat_map(|&(start, end)| jsdoc_links(text, start, end));
            for names in links {
                let Some(first) = atoms.lookup(&names[0]) else {
                    continue;
                };
                // `resolveJSDocMemberName`: a qualified name that does not resolve as an entity
                // name is a member of the symbol its left side names.
                if names.len() > 1 {
                    u.note_namespace(scope, first);
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
                    | ExprKind::PrivateIdentifier(_)
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
                // `checkPrivateIdentifierExpression`: a read, wherever the expression appears.
                ExprKind::PrivateIdentifier(name) => {
                    if let Some((_, m)) =
                        self.lookup_symbol_for_private_identifier_declaration(file, e, name)
                    {
                        let symbol = self.symbol_of_member(file, m);
                        self.note_property_symbol(u, symbol);
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
        let symbol = match self.private_property_read(file, receiver, name, at) {
            PropertyRead::Unresolved => return u.note_members_named(name),
            PropertyRead::NotPrivate => return,
            PropertyRead::Private(symbol) => symbol,
        };
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
        self.note_property_symbol(u, symbol);
    }

    /// `markPropertyAsReferenced` where it is called, for a member that another file than `file`
    /// declares: the property `name` of `receiver` is accessed in `file`. `note_private_reads`
    /// collects the accesses in the file of the declaration. `at`: as for `note_property`. No
    /// declaration of the member contains the access, so `isSelfTypeAccess` does not matter.
    pub(super) fn mark_property_as_referenced(
        &mut self,
        file: FileId,
        receiver: TypeId,
        name: Atom,
        at: Option<ExprId>,
    ) {
        let Some(visited) = self.task.file else {
            return;
        };
        if !self.p.files.options.no_unused_locals {
            return;
        }
        let receiver = self.apparent_type(receiver);
        let PropertyRead::Private(symbol) = self.private_property_read(file, receiver, name, at)
        else {
            return;
        };
        // `checkUnusedClassMembers` comes at the end of the file of the declaration.
        let files = self.files();
        if symbol.file == file || files.rank_of_file(visited) > files.rank_of_file(symbol.file) {
            return;
        }
        // The checkers of a `checkerPool` share nothing.
        if self.referenced_properties.insert(symbol) && self.task.checker_count == 0 {
            self.p.properties_referenced_before.lock().insert(symbol);
        }
    }

    /// The start of `markPropertyAsReferenced`, up to `isSelfTypeAccess`, for the property `name`
    /// of the apparent type `receiver`, accessed in `file`. `at`: as for `note_property`.
    fn private_property_read(
        &mut self,
        file: FileId,
        receiver: TypeId,
        name: Atom,
        at: Option<ExprId>,
    ) -> PropertyRead {
        // `createUnionOrIntersectionProperty`: a private property must exist in every member of a
        // union. If all members have the same property, the result is the first member's property.
        // Otherwise there is no property, or a synthesized one, and that one is marked.
        let mut found: Option<(&Prop, MapperId)> = None;
        for &part in self.parts(receiver) {
            let part = self.apparent_type(part);
            if part == TypeId::UNRESOLVED {
                return PropertyRead::Unresolved;
            }
            let Some((mut prop, mut mapper)) = self.prop_ref(part, name) else {
                return PropertyRead::NotPrivate;
            };
            if let PropSource::Intersected(_, list) = &prop.source {
                let Some(first) = list.first() else {
                    return PropertyRead::NotPrivate;
                };
                if list.iter().any(|other| {
                    !self.is_same_property(first, MapperId::IDENTITY, other, MapperId::IDENTITY)
                }) {
                    return PropertyRead::NotPrivate;
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
                    return PropertyRead::NotPrivate;
                }
                found = Some((prop, mapper));
                continue;
            };
            if !self.is_same_property(first.0, first.1, prop, mapper) {
                return PropertyRead::NotPrivate;
            }
        }
        let Some((prop, _)) = found else {
            return PropertyRead::NotPrivate;
        };
        let PropSource::Symbol(symbol) = prop.source else {
            return PropertyRead::NotPrivate;
        };
        // A write-only access is not a reference, unless the write calls a setter.
        if at.is_some_and(|e| self.bound(file).is_write_only_access(self.hir(file), e))
            && !self
                .flags_of_property(symbol)
                .contains(SymFlags::SET_ACCESSOR)
        {
            return PropertyRead::NotPrivate;
        }
        PropertyRead::Private(symbol)
    }

    /// `symbolReferenceLinks.Get(symbol).referenceKinds |= SymbolFlagsAll` for the symbol of a
    /// property. The marks are on the symbols the binder gave its declarations.
    fn note_property_symbol(&mut self, u: &mut Unused, symbol: Sym) {
        let file = u.file;
        let declarations = self.declarations_of_property(symbol);
        for &(_, declaration) in declarations.iter().filter(|it| it.0 == file) {
            let own = u.bound.symbol_of_declaration(declaration);
            if own.is_some() {
                u.referenced[own.idx()] |= ALL;
            }
        }
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

/// A node whose JSDoc comments `checkSourceElementWorker` visits.
struct JSDocHost {
    /// `node.Loc`
    loc: TextRange,
    /// The position of its first token.
    start: u32,
    /// Where the names in its comments are resolved from.
    scope: ScopeId,
    /// `GetJSDocCommentRanges`: the comments on the line of the previous token are its comments
    /// too.
    owns_trailing_comments: bool,
}

/// `withJSDoc`, `GetJSDocCommentRanges`: the JSDoc comments of `host` that the parser parses while
/// it parses the file (`EagerJSDoc`).
fn jsdoc_comment_ranges(text: &[u8], host: &JSDocHost, is_js: bool) -> Vec<(usize, usize)> {
    // `isJSDocLikeText`
    let is_jsdoc = |&(start, end): &(usize, usize)| {
        let comment = &text[start..end];
        comment.len() >= 4 && comment[1] == b'*' && comment[2] == b'*' && comment[3] != b'/'
    };
    let pos = host.loc.pos as usize;
    let trailing = super::spans::get_trailing_comment_ranges(text, pos);
    let leading = super::spans::get_leading_comment_ranges(text, pos);
    // `jsdocScannerInfo`: every comment before the first token of the host sets the flags of that
    // token.
    if !is_js
        && !(trailing.iter().chain(&leading))
            .any(|comment| is_jsdoc(comment) && has_see_or_link_tag(&text[comment.0..comment.1]))
    {
        return Vec::new();
    }
    let mut ranges = if host.owns_trailing_comments {
        trailing
    } else {
        Vec::new()
    };
    ranges.extend(leading);
    ranges.retain(|comment| comment.1 <= host.loc.end as usize && is_jsdoc(comment));
    ranges
}

const SEE_OR_LINK_TAGS: [&[u8]; 4] = [b"see", b"link", b"linkcode", b"linkplain"];

/// `scanJSDocCommentForTags`: whether `comment` sets `TokenFlagsPrecedingJSDocWithSeeOrLink`.
fn has_see_or_link_tag(mut comment: &[u8]) -> bool {
    while let Some(at) = bun_core::strings::index_of_char_usize(comment, b'@') {
        comment = &comment[at + 1..];
        if has_jsdoc_tag(comment, &SEE_OR_LINK_TAGS) {
            return true;
        }
    }
    false
}

/// `hasJSDocTag`
fn has_jsdoc_tag(text: &[u8], tags: &[&[u8]]) -> bool {
    tags.iter().any(|tag| {
        text.strip_prefix(*tag).is_some_and(|rest| {
            matches!(
                rest.first(),
                None | Some(b' ' | b'\t' | b'\n' | b'\r' | b'}' | b'*')
            )
        })
    })
}

/// `parseTag`: whether the parser of the tag `name` takes a `{` that follows the name, as
/// `tryParseTypeExpression`, `parseJSDocTypeExpression`,
/// `parseExpressionWithTypeArgumentsForAugments` and `tryParseImportClause` do.
fn jsdoc_tag_takes_brace(name: &[u8]) -> bool {
    matches!(
        name,
        b"implements"
            | b"augments"
            | b"extends"
            | b"this"
            | b"arg"
            | b"argument"
            | b"param"
            | b"return"
            | b"returns"
            | b"template"
            | b"type"
            | b"typedef"
            | b"satisfies"
            | b"exception"
            | b"throws"
            | b"import"
    )
}

/// The tokens that the parser of JSDoc comments has to tell apart to find the links.
#[derive(Copy, Clone, PartialEq, Eq)]
enum JSDocToken {
    EndOfFile,
    WhitespaceTrivia,
    NewLineTrivia,
    /// `KindJSDocCommentTextToken`
    CommentText,
    At,
    Asterisk,
    OpenBrace,
    CloseBrace,
    Dot,
    Backtick,
    /// `tokenIsIdentifierOrKeyword`
    Identifier,
    PrivateIdentifier,
    Other,
}

/// `jsdocState`
#[derive(Copy, Clone, PartialEq, Eq)]
enum JSDocState {
    BeginningOfLine,
    SawAsterisk,
    SavingComments,
    SavingBackticks,
}

impl JSDocState {
    fn saving(in_backticks: bool) -> JSDocState {
        if in_backticks {
            JSDocState::SavingBackticks
        } else {
            JSDocState::SavingComments
        }
    }

    fn is_saving(self) -> bool {
        matches!(
            self,
            JSDocState::SavingComments | JSDocState::SavingBackticks
        )
    }

    /// The state after a backtick.
    fn toggle_backticks(self) -> JSDocState {
        JSDocState::saving(self != JSDocState::SavingBackticks)
    }
}

/// `ScannerState`
#[derive(Copy, Clone)]
struct JSDocScannerState {
    token: JSDocToken,
    /// `TokenFullStart`
    full_start: usize,
    /// `TokenStart`
    start: usize,
    /// `TokenEnd`
    pos: usize,
    /// `HasPrecedingLineBreak`
    has_preceding_line_break: bool,
}

/// `parseJSDocComment` for the comment of `source` from `start` to `end`: the names of each
/// `{@link a.b}`, `{@linkcode a.b}` and `{@linkplain a.b}` that has a name. A missing name is
/// empty.
fn jsdoc_links(source: &[u8], start: usize, end: usize) -> Vec<Vec<Cow<'_, [u8]>>> {
    let mut parser = JSDocParser {
        text: &source[..end - 2],
        scanner: JSDocScannerState {
            token: JSDocToken::Other,
            full_start: start + 3,
            start: start + 3,
            pos: start + 3,
            has_preceding_line_break: false,
        },
        links: Vec::new(),
    };
    parser.parse_jsdoc_comment_worker(start);
    parser.links
}

/// The part of jsdoc.go, of TypeScript's parser, that finds the links in a JSDoc comment.
struct JSDocParser<'a> {
    /// The source, up to the `*/` of the comment.
    text: &'a [u8],
    scanner: JSDocScannerState,
    links: Vec<Vec<Cow<'a, [u8]>>>,
}

impl<'a> JSDocParser<'a> {
    /// `nextTokenJSDoc`, `ScanJSDocToken`
    fn next_token_jsdoc(&mut self) -> JSDocToken {
        let (text, start) = (self.text, self.scanner.pos);
        let mut pos = start + 1;
        let token = match text.get(start) {
            None => {
                pos = start;
                JSDocToken::EndOfFile
            }
            Some(b'\t' | 0x0B | 0x0C | b' ') => {
                pos = lexer::end_of_run(text, pos, lexer::is_white_space_single_line);
                JSDocToken::WhitespaceTrivia
            }
            Some(b'@') => JSDocToken::At,
            Some(b'\r') if text.get(pos) == Some(&b'\n') => {
                pos += 1;
                JSDocToken::NewLineTrivia
            }
            Some(b'\r' | b'\n') => JSDocToken::NewLineTrivia,
            Some(b'*') => JSDocToken::Asterisk,
            Some(b'{') => JSDocToken::OpenBrace,
            Some(b'}') => JSDocToken::CloseBrace,
            Some(b'.') => JSDocToken::Dot,
            Some(b'`') => JSDocToken::Backtick,
            Some(b'\\') => match lexer::peek_unicode_escape(text, start) {
                Some((escaped, len)) if lexer::is_identifier_start(escaped as u32) => {
                    pos = lexer::scan_identifier_parts(text, start + len);
                    JSDocToken::Identifier
                }
                _ => JSDocToken::Other,
            },
            Some(_) => {
                let (ch, size) = lexer::char_and_size(text, start);
                pos = start + size;
                if lexer::is_identifier_start(ch as u32) {
                    let is_part =
                        |ch: i32| lexer::is_identifier_part(ch as u32) || ch == i32::from(b'-');
                    pos = lexer::end_of_run(text, pos, is_part);
                    if text.get(pos) == Some(&b'\\') {
                        pos = lexer::scan_identifier_parts(text, pos);
                    }
                    JSDocToken::Identifier
                } else {
                    JSDocToken::Other
                }
            }
        };
        self.scanner = JSDocScannerState {
            token,
            full_start: start,
            start,
            pos,
            has_preceding_line_break: token == JSDocToken::NewLineTrivia,
        };
        token
    }

    /// `nextJSDocCommentTextToken`, `ScanJSDocCommentTextToken`
    fn next_jsdoc_comment_text_token(&mut self, in_backticks: bool) -> JSDocToken {
        let (text, start) = (self.text, self.scanner.pos);
        let mut pos = start;
        while let Some(&ch) = text.get(pos) {
            if ch == b'`' || lexer::starts_with_line_break(&text[pos..]) {
                break;
            }
            if !in_backticks {
                if ch == b'{' {
                    break;
                }
                // "@ doesn't start a new tag inside ``, and elsewhere, only after whitespace and
                // before identifier"
                if ch == b'@'
                    && lexer::is_white_space_single_line(lexer::last_char(&text[..pos]).0)
                    && lexer::is_identifier_start(lexer::char_and_size(text, pos + 1).0 as u32)
                {
                    break;
                }
            }
            pos += 1;
        }
        if pos == start {
            return self.next_token_jsdoc();
        }
        self.scanner = JSDocScannerState {
            token: JSDocToken::CommentText,
            full_start: start,
            start,
            pos,
            has_preceding_line_break: false,
        };
        JSDocToken::CommentText
    }

    /// `CanFollowJSDocAt`
    fn can_follow_jsdoc_at(&self) -> bool {
        let (ch, size) = lexer::char_and_size(self.text, self.scanner.pos);
        size == 0
            || lexer::is_identifier_start(ch as u32)
            || lexer::is_white_space_single_line(ch)
            || lexer::starts_with_line_break(&self.text[self.scanner.pos..])
    }

    /// `nextToken`, `Scan`
    fn next_token(&mut self) -> JSDocToken {
        let (text, full_start) = (self.text, self.scanner.pos);
        let start = skip_trivia(text, full_start);
        let pos = token_end(text, start, false);
        let token = match text.get(start) {
            None => JSDocToken::EndOfFile,
            Some(b'}') => JSDocToken::CloseBrace,
            Some(b'.') if pos == start + 1 => JSDocToken::Dot,
            Some(b'#') if text.get(start + 1) != Some(&b'!') => JSDocToken::PrivateIdentifier,
            Some(b'0'..=b'9') => JSDocToken::Other,
            Some(_) if super::spans::identifier_end(text, start) > start => JSDocToken::Identifier,
            Some(_) => JSDocToken::Other,
        };
        self.scanner = JSDocScannerState {
            token,
            full_start,
            start,
            pos,
            has_preceding_line_break: (full_start..start)
                .any(|at| super::spans::line_break_len(text, at) != 0),
        };
        token
    }

    /// `ResetPos`
    fn reset_pos(&mut self, pos: usize) {
        self.scanner.full_start = pos;
        self.scanner.start = pos;
        self.scanner.pos = pos;
    }

    /// `TokenValue` of an identifier.
    fn token_value(&self) -> Cow<'a, [u8]> {
        super::spans::unescaped_identifier(&self.text[self.scanner.start..self.scanner.pos])
    }

    /// `parseOptionalJsdoc`
    fn parse_optional_jsdoc(&mut self, token: JSDocToken) -> bool {
        let is_next = self.scanner.token == token;
        if is_next {
            self.next_token_jsdoc();
        }
        is_next
    }

    /// `parseJSDocCommentWorker` for the comment that starts at `start`.
    fn parse_jsdoc_comment_worker(&mut self, start: usize) {
        let line_start = bun_core::strings::last_index_of_char(&self.text[..start], b'\n')
            .map_or(0, |at| at + 1);
        // "initial indent is start+4 to account for leading `/** `"
        let mut indent = start + 4 - line_start;
        let mut state = JSDocState::SawAsterisk;
        let mut backtick_count = 0;
        let mut in_fenced_code_block = false;
        self.next_token_jsdoc();
        while self.parse_optional_jsdoc(JSDocToken::WhitespaceTrivia) {}
        if self.parse_optional_jsdoc(JSDocToken::NewLineTrivia) {
            state = JSDocState::BeginningOfLine;
            indent = 0;
        }
        loop {
            // "Three or more consecutive backticks toggle the fenced code block state."
            if self.scanner.token != JSDocToken::Backtick && backtick_count > 0 {
                in_fenced_code_block ^= backtick_count >= 3;
                backtick_count = 0;
            }
            let token_len = self.scanner.pos - self.scanner.start;
            match self.scanner.token {
                JSDocToken::At if !in_fenced_code_block && self.can_follow_jsdoc_at() => {
                    self.parse_tag(indent);
                    state = JSDocState::BeginningOfLine;
                }
                JSDocToken::NewLineTrivia => {
                    state = JSDocState::BeginningOfLine;
                    indent = 0;
                }
                // "Ignore the first asterisk on a line"
                JSDocToken::Asterisk if state != JSDocState::SawAsterisk => {
                    state = JSDocState::SawAsterisk;
                    indent += token_len;
                }
                JSDocToken::WhitespaceTrivia => indent += token_len,
                JSDocToken::EndOfFile => break,
                JSDocToken::Backtick => {
                    backtick_count += 1;
                    state = state.toggle_backticks();
                    indent += token_len;
                }
                JSDocToken::OpenBrace if !in_fenced_code_block => {
                    state = JSDocState::SavingComments;
                    if !self.parse_jsdoc_link() {
                        indent += token_len;
                    }
                }
                JSDocToken::Asterisk => {
                    state = JSDocState::SavingComments;
                    indent += token_len;
                }
                JSDocToken::At | JSDocToken::OpenBrace => {
                    state = JSDocState::saving(in_fenced_code_block);
                    indent += token_len;
                }
                _ => {
                    if state != JSDocState::SavingBackticks {
                        state = JSDocState::saving(in_fenced_code_block);
                    }
                    indent += token_len;
                }
            }
            if state.is_saving() {
                self.next_jsdoc_comment_text_token(state == JSDocState::SavingBackticks);
            } else {
                self.next_token_jsdoc();
            }
        }
    }

    /// Whether only white space follows, which `skipWhitespace` and `skipWhitespaceOrAsterisk` do
    /// not skip: `isNextNonwhitespaceTokenEndOfFile`.
    fn is_at_trailing_whitespace(&mut self) -> bool {
        let state = self.scanner;
        let mut token = state.token;
        while matches!(
            token,
            JSDocToken::WhitespaceTrivia | JSDocToken::NewLineTrivia
        ) {
            token = self.next_token_jsdoc();
        }
        self.scanner = state;
        token == JSDocToken::EndOfFile
    }

    /// `skipWhitespace`
    fn skip_whitespace(&mut self) {
        if self.is_at_trailing_whitespace() {
            return;
        }
        while matches!(
            self.scanner.token,
            JSDocToken::WhitespaceTrivia | JSDocToken::NewLineTrivia
        ) {
            self.next_token_jsdoc();
        }
    }

    /// `skipWhitespaceOrAsterisk`. Returns the length of the indentation after the last line break.
    fn skip_whitespace_or_asterisk(&mut self) -> usize {
        if self.is_at_trailing_whitespace() {
            return 0;
        }
        let mut preceding_line_break = self.scanner.has_preceding_line_break;
        let mut seen_line_break = false;
        let mut indent = 0;
        loop {
            match self.scanner.token {
                JSDocToken::Asterisk if preceding_line_break => {
                    preceding_line_break = false;
                    indent += 1;
                }
                JSDocToken::WhitespaceTrivia => indent += self.scanner.pos - self.scanner.start,
                JSDocToken::NewLineTrivia => {
                    preceding_line_break = true;
                    seen_line_break = true;
                    indent = 0;
                }
                _ => break,
            }
            self.next_token_jsdoc();
        }
        if seen_line_break { indent } else { 0 }
    }

    /// `parseTag`. Of the syntax of a tag, only a type in braces right after its name is passed
    /// over. The rest is read as its comment.
    fn parse_tag(&mut self, margin: usize) {
        let start = self.scanner.start;
        self.next_token_jsdoc();
        // `parseJSDocIdentifierName`
        let mut tag_name = Cow::default();
        if self.scanner.token == JSDocToken::Identifier {
            tag_name = self.token_value();
            self.next_token_jsdoc();
        }
        let indent_text = self.skip_whitespace_or_asterisk();
        if self.scanner.token == JSDocToken::OpenBrace && jsdoc_tag_takes_brace(&tag_name) {
            let inside = self.scanner.pos;
            // No type starts with `@`, and `parseTagComments` ends at it: it starts a tag.
            let after = match self.text.get(inside) {
                Some(b'@') => inside,
                _ => closing_bracket_after(self.text, inside) as usize + 1,
            };
            self.reset_pos(after.min(self.text.len()));
            self.next_token_jsdoc();
        }
        self.parse_trailing_tag_comments(start, self.scanner.full_start, margin, indent_text);
    }

    /// `parseTrailingTagComments` for the tag that starts at `start`. `indent_text`: the length of
    /// that text.
    fn parse_trailing_tag_comments(
        &mut self,
        start: usize,
        end: usize,
        mut margin: usize,
        indent_text: usize,
    ) {
        if indent_text == 0 {
            margin += end - start;
        }
        self.parse_tag_comments(margin, indent_text.saturating_sub(margin));
    }

    /// `parseTagComments`. `initial_margin`: the length of that text.
    fn parse_tag_comments(&mut self, mut indent: usize, initial_margin: usize) {
        let mut state = JSDocState::SawAsterisk;
        let mut backtick_count = 0;
        let mut in_fenced_code_block = false;
        let mut margin = None;
        if initial_margin != 0 {
            margin = Some(indent);
            indent += initial_margin;
        }
        loop {
            if self.scanner.token != JSDocToken::Backtick && backtick_count > 0 {
                in_fenced_code_block ^= backtick_count >= 3;
                backtick_count = 0;
            }
            let token_len = self.scanner.pos - self.scanner.start;
            // `pushComment`
            let mut is_pushed = true;
            match self.scanner.token {
                JSDocToken::NewLineTrivia => {
                    state = JSDocState::BeginningOfLine;
                    indent = 0;
                    is_pushed = false;
                }
                JSDocToken::At if !in_fenced_code_block && self.can_follow_jsdoc_at() => {
                    self.reset_pos(self.scanner.pos - 1);
                    break;
                }
                JSDocToken::EndOfFile => break,
                JSDocToken::WhitespaceTrivia => {
                    // "if the whitespace crosses the margin, take only the whitespace that passes
                    // the margin"
                    if margin.is_some_and(|margin| indent + token_len > margin) {
                        state = JSDocState::saving(in_fenced_code_block);
                    }
                    indent += token_len;
                    is_pushed = false;
                }
                JSDocToken::OpenBrace if !in_fenced_code_block => {
                    state = JSDocState::SavingComments;
                    is_pushed = !self.parse_jsdoc_link();
                }
                JSDocToken::At | JSDocToken::OpenBrace => {
                    state = JSDocState::saving(in_fenced_code_block);
                }
                JSDocToken::Backtick => {
                    backtick_count += 1;
                    state = state.toggle_backticks();
                }
                // "leading asterisks start recording on the *next* (non-whitespace) token"
                JSDocToken::Asterisk if state == JSDocState::BeginningOfLine => {
                    state = JSDocState::SawAsterisk;
                    indent += 1;
                    is_pushed = false;
                }
                _ => {
                    if state != JSDocState::SavingBackticks {
                        state = JSDocState::saving(in_fenced_code_block);
                    }
                }
            }
            if is_pushed {
                margin.get_or_insert(indent);
                indent += token_len;
            }
            if state.is_saving() {
                self.next_jsdoc_comment_text_token(state == JSDocState::SavingBackticks);
            } else {
                self.next_token_jsdoc();
            }
        }
    }

    /// `parseJSDocLink`. Returns whether there is a link at the current token, a `{`.
    fn parse_jsdoc_link(&mut self) -> bool {
        let state = self.scanner;
        if !self.parse_jsdoc_link_prefix() {
            self.scanner = state;
            return false;
        }
        self.next_token_jsdoc();
        self.skip_whitespace();
        let name = self.parse_jsdoc_link_name();
        if !name.is_empty() {
            self.links.push(name);
        }
        while !matches!(
            self.scanner.token,
            JSDocToken::CloseBrace | JSDocToken::NewLineTrivia | JSDocToken::EndOfFile
        ) {
            self.next_token_jsdoc();
        }
        true
    }

    /// `parseJSDocLinkName`. Empty if there is none.
    fn parse_jsdoc_link_name(&mut self) -> Vec<Cow<'a, [u8]>> {
        let mut name = Vec::new();
        if self.scanner.token != JSDocToken::Identifier {
            return name;
        }
        name.push(self.parse_identifier_name());
        while self.scanner.token == JSDocToken::Dot {
            name.push(match self.next_token() {
                JSDocToken::PrivateIdentifier => Cow::default(),
                _ => self.parse_identifier_name(),
            });
        }
        while self.scanner.token == JSDocToken::PrivateIdentifier {
            // `ReScanHashToken`
            self.scanner.pos = self.scanner.start + 1;
            self.next_token_jsdoc();
            name.push(self.parse_identifier_name());
        }
        name
    }

    /// `parseIdentifierName`
    fn parse_identifier_name(&mut self) -> Cow<'a, [u8]> {
        if self.scanner.token != JSDocToken::Identifier {
            return Cow::default();
        }
        let text = self.token_value();
        self.next_token();
        text
    }

    /// `parseJSDocLinkPrefix`
    fn parse_jsdoc_link_prefix(&mut self) -> bool {
        self.skip_whitespace_or_asterisk();
        self.scanner.token == JSDocToken::OpenBrace
            && self.next_token_jsdoc() == JSDocToken::At
            && self.next_token_jsdoc() == JSDocToken::Identifier
            && matches!(&*self.token_value(), b"link" | b"linkcode" | b"linkplain")
    }
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
pub(super) fn is_thisless(hir: &hir::File, m: MemberId) -> bool {
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
pub(super) fn is_thisless_type(hir: &hir::File, t: TypeNodeId) -> bool {
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
                StmtKind::ExportNamed(id) if !hir[id].has_module_specifier => {
                    let scope = bound.export_scope[id.idx()];
                    for item in hir[id].items.iter() {
                        self.note_name(scope, hir[item].local, SymFlags::all(), ALL);
                    }
                }
                StmtKind::ImportEquals(id) => {
                    if let ImportEqualsTarget::Entity(names) = hir[id].target {
                        self.note_module_reference(bound.import_equals_scope[id.idx()], names);
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
        for symbol in members.chain(properties).filter(|symbol| symbol.is_some()) {
            self.referenced[symbol.idx()] |= ALL;
        }
    }

    /// `isReferenced`
    fn is_referenced(&self, symbol: SymbolId) -> bool {
        let kinds = self.referenced.get(symbol.idx());
        kinds.is_some_and(|&kinds| kinds != 0)
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

    /// The statement, member, parameter, function type or variable declaration that has `at` in
    /// the trivia before its first token, where its JSDoc comments are (`withJSDoc`). Those are the
    /// nodes with comments that are passed to `checkSourceElement`.
    fn jsdoc_host_at(&self, at: u32) -> Option<JSDocHost> {
        let (hir, bound) = (self.hir, self.bound);
        // The range of a node is empty if the parser did not record it.
        let follows = |loc: TextRange, start: u32| loc.end != 0 && (loc.pos..start).contains(&at);
        let host = |loc: TextRange, start: u32, scope: ScopeId, owns_trailing_comments: bool| {
            (scope.is_some() && !hir.is_in_with(start)).then_some(JSDocHost {
                loc,
                start,
                scope,
                owns_trailing_comments,
            })
        };
        let is_checked = |i: usize| !matches!(bound.stmt_parent[i], Parent::None);
        let mut statements = hir.stmts.iter().enumerate();
        if let Some((i, s)) = statements.find(|&(i, s)| follows(s.loc, s.start) && is_checked(i)) {
            return host(
                s.loc,
                s.start,
                self.scope_of_statement(StmtId(i as u32)),
                false,
            );
        }
        let mut members = hir.members.iter().enumerate();
        if let Some((i, m)) = members.find(|(_, m)| follows(m.loc, m.start)) {
            return host(
                m.loc,
                m.start,
                self.scope_of_member(MemberId(i as u32)),
                false,
            );
        }
        let mut enum_members = hir.enum_members.iter().enumerate();
        if let Some((i, m)) = enum_members.find(|(_, m)| follows(m.loc, m.pos)) {
            let scope = bound.enum_scope.get(bound.enum_member_owner[i].idx());
            return host(m.loc, m.pos, scope.map_or(ScopeId::NONE, |&it| it), false);
        }
        let mut parameters = hir.params.iter().enumerate();
        if let Some((i, p)) = parameters.find(|(_, p)| follows(p.loc, p.pos)) {
            let function = bound.param_fn[i];
            let scope = if function.is_some() {
                bound.fns[function.idx()].scope
            } else {
                ScopeId::NONE
            };
            return host(p.loc, p.pos, scope, true);
        }
        // `parseFunctionOrConstructorType`. `node.Pos()` of a type is not stored.
        let function_types = (hir.types.iter().enumerate()).filter_map(|(i, t)| match t.kind {
            TypeNodeKind::Fn(f) if t.pos > at => Some((i, t, f)),
            _ => None,
        });
        if let Some((i, t, f)) = function_types.min_by_key(|it| it.1.pos) {
            let pos = skip_trivia_back(&hir.text, t.pos as usize) as u32;
            if pos <= at {
                let is_checked = !bound.is_unchecked_type(i) && !self.is_never_checked(t.pos);
                let loc = TextRange { pos, end: t.end };
                return host(loc, t.pos, bound.fns[f.idx()].scope, false).filter(|_| is_checked);
            }
        }
        let mut declarations = hir.var_decls.iter().enumerate();
        let (i, d) = declarations.find(|(_, d)| follows(d.loc, hir[d.pat].pos))?;
        // `checkVariableDeclarationList`: not the variable of a `catch` clause.
        let s = bound.var_stmt[i];
        if s.is_none() || !matches!(hir[s].kind, StmtKind::Var(_)) {
            return None;
        }
        let scope = match bound.stmt_scope[s.idx()] {
            ScopeId::NONE => self.scope_of_statement(s),
            scope => scope,
        };
        host(d.loc, hir[d.pat].pos, scope, true)
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
        // A `ParenthesizedType` is not function-like.
        if member.kind == MemberKind::Property
            && !matches!(owner, MemberOwner::Class(_))
            && member.ty.is_some()
            && let TypeNodeKind::Fn(f) = hir[member.ty].kind
            && super::spans::Spans::of(hir)
                .parens_before(member.name_pos as usize, hir[member.ty].pos as usize)
                .next()
                .is_none()
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

    /// The lookups of the first of `names`, the `a.b` of `import x = a.b`.
    fn note_module_reference(&mut self, scope: ScopeId, names: Span<NameId>) {
        let names: Vec<Atom> = self.hir.texts(names).collect();
        let Some(&first) = names.first() else {
            return;
        };
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        // `getSymbolOfPartOfRightHandSideOfImportEquals`
        self.note_namespace(scope, first);
        // `checkAndReportErrorForResolvingImportAliasToTypeOnlySymbol`
        self.note_name(scope, first, any, ALL);
        // `checkImportEqualsDeclaration`: "Target is a value symbol, check that it is not hidden by
        // a local declaration with the same name"
        let meaning = if names.len() == 1 {
            SymFlags::NAMESPACE
        } else {
            any
        };
        let target = (self.files).resolve_entity(self.file, scope, &names, meaning);
        if target.is_some_and(|target| {
            let flags = self.files.symbol_flags(target);
            flags != SymFlags::all() && flags.intersects(SymFlags::VALUE)
        }) {
            let meaning = SymFlags::VALUE | SymFlags::NAMESPACE;
            self.note_name(scope, first, meaning, VALUE | NAMESPACE);
        }
    }

    /// `resolveEntityName(name, SymbolFlagsNamespace)`: a name that does not resolve to a namespace
    /// is looked up again, as an alias, with `isUse`. That lookup passes over a variable of the
    /// name, so it marks an import that the variable shadows.
    fn note_namespace(&mut self, scope: ScopeId, name: Atom) {
        let meaning = SymFlags::NAMESPACE;
        if let Some(found) = self.resolve_use(scope, name, meaning) {
            self.note_use(found, NAMESPACE);
        } else if (self.files.resolve_name(self.file, scope, name, meaning)).is_none() {
            self.note_name(scope, name, SymFlags::ALIAS, ALIAS);
        }
    }

    /// `Resolve` with `isUse`. A name that does not resolve to a symbol declared in the file
    /// references nothing here.
    fn note_name(&mut self, from: ScopeId, name: Atom, meaning: SymFlags, bit: u8) {
        if let Some(found) = self.resolve_use(from, name, meaning) {
            self.note_use(found, bit);
        }
    }

    /// `symbol.isReferenced |= meaning`
    fn note_use(&mut self, found: Use, bit: u8) {
        if !found.is_self_reference {
            self.referenced[found.symbol.idx()] |= bit;
        }
    }

    /// `Resolve`: what the name resolves to, if that is declared in the file.
    fn resolve_use(&self, from: ScopeId, name: Atom, meaning: SymFlags) -> Option<Use> {
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
        Some(Use {
            symbol: found,
            is_self_reference: found == inside,
        })
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
                // `checkModuleDeclaration`: `!IsGlobalScopeAugmentation(node)`
                ScopeKind::Module(m) => hir[m].name != ModuleName::Global,
                ScopeKind::Block => true,
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
                let declaration = match bound.fns[i].owner {
                    FnOwner::None => continue,
                    FnOwner::Member(m) => Decl::Member(m),
                    _ => Decl::Fn(FnId(i as u32)),
                };
                if !unchecked.contain(f.start) {
                    self.check_unused_type_parameters(u, declaration, f.type_params);
                }
            }
            for (i, c) in hir.classes.iter().enumerate() {
                self.check_unused_type_parameters(u, Decl::Class(ClassId(i as u32)), c.type_params);
            }
            for (i, a) in hir.aliases.iter().enumerate() {
                // `checkTypeAliasDeclaration` returns before `registerForUnusedIdentifiersCheck`.
                let is_intrinsic = a.ty.is_some()
                    && matches!(hir[a.ty].kind, TypeNodeKind::Keyword(Keyword::Intrinsic));
                if !is_intrinsic {
                    let declaration = Decl::Alias(AliasId(i as u32));
                    self.check_unused_type_parameters(u, declaration, a.type_params);
                }
            }
            for (i, id) in hir.interfaces.iter().enumerate() {
                let declaration = Decl::Interface(InterfaceId(i as u32));
                self.check_unused_type_parameters(u, declaration, id.type_params);
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
        if u.locals {
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
                    if !hir.is_parameter_property_declaration(hir.node(p))
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

    /// `checkUnusedTypeParameters` for `declaration`, whose type parameters are `params`.
    fn check_unused_type_parameters(
        &mut self,
        u: &Unused<'_, '_>,
        declaration: Decl,
        params: Span<TypeParamId>,
    ) {
        let (hir, file) = (u.hir, u.file);
        // `reportUnused` receives the declaration they belong to, which contains the syntax error
        // of a missing name.
        if params.iter().any(|p| hir[p].name == known::empty) {
            return;
        }
        // `allDeclarationsInSameSourceFile`
        let is_elsewhere = |&(of, _): &(FileId, Decl)| of != file;
        if params.is_empty()
            || (self.declarations_of_member(file, declaration).iter()).any(is_elsewhere)
        {
            return;
        }
        let node = hir.node(declaration);
        if params.len() > 1 && params.iter().all(|p| u.is_unreferenced_type_parameter(p)) {
            // `rangeOfTypeParameters`: starts at the `<`. A list synthesized from `@template` tags
            // begins at the `@` of the first tag (`gatherTypeParameters`), so the range starts one
            // position before that.
            let first = hir[params.at(0)].start;
            let open = if hir[params.at(0)].flags.contains(Flags::REPARSED) {
                let before = hir.text.get(..first as usize).unwrap_or_default();
                bun_core::strings::last_index_of(before, b"@template")
                    .map(|at| at.saturating_sub(1) as u32)
            } else {
                start_of_token_before(&hir.text, first, b"<")
            };
            let start = open.unwrap_or_else(|| first.saturating_sub(1));
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
                    if !u.is_referenced(bound.member_symbol[i]) {
                        let (start, end) = (member.name_pos, self.end_of_member_name(file, m));
                        let name = hir.text.get(start as usize..end as usize);
                        let (at, name) = ((file, start, end), Arg::Bytes(name.unwrap_or_default()));
                        self.report_unused(u, hir.node(m), false, at, 6133, &[name]);
                        self.unused_private_members.push((symbol, start));
                    }
                }
                MemberKind::Constructor => {
                    for p in hir[member.func].params.iter() {
                        // Whether the parameter property is referenced. The parameter itself may be referenced
                        // even if the property is not.
                        let property = bound.symbol_of_declaration(Decl::ParameterProperty(p));
                        if hir[p].flags.contains(Flags::PRIVATE) && !u.is_referenced(property) {
                            let pat = hir[p].pat;
                            // `ast.SymbolName(parameter.Symbol())`: a pattern (1187) has no name, and
                            // its symbol is `InternalSymbolNameMissing`.
                            let (at, name) = match hir[pat].kind {
                                PatKind::Ident(name) => {
                                    (self.place_of_token(file, hir[pat].pos), Arg::Atom(name))
                                }
                                _ => (
                                    (file, hir[pat].pos, self.end_of_pat(file, pat)),
                                    Arg::Bytes(b"\xFEmissing"),
                                ),
                            };
                            self.report_unused(u, hir.node(p), false, at, 6138, &[name]);
                            if property.is_some() {
                                let symbol = self.files().sym(file, property);
                                self.unused_private_members.push((symbol, at.1));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
