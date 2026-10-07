//! The types of named values: variables, parameters, functions, classes, imports; and the return
//! types of functions.

use super::context::{IncludePatternInType, ReportErrors};
use super::decl::declarations_of;
use super::mapped::AccessNode;
use super::related::Place;
use super::shape::SpreadSymbolOptions;
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeId, UNREACHABLE};
use crate::program::{EntityNameLookup, SymbolTable};
use smallvec::SmallVec;
use std::rc::Rc;

/// `WideningContext`
pub(super) struct WideningContext<'p> {
    parent: Option<usize>,
    property_name: Atom,
    siblings: Option<Rc<[TypeId]>>,
    resolved_properties: Option<Rc<[&'p Prop<'p>]>>,
    child_contexts: FxHashMap<Atom, usize>,
    widened_types: FxHashMap<TypeId, TypeId>,
}

/// What `resolveAlias` gives.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum AliasTarget {
    Symbol(Sym),
    /// A property has no `Sym`: its owner type (`never`: none), its name, its type.
    Property(TypeId, Atom, TypeId),
    /// `unknownSymbol`
    Unknown,
}

impl From<Sym> for AliasTarget {
    fn from(symbol: Sym) -> Self {
        AliasTarget::Symbol(symbol)
    }
}

impl AliasTarget {
    pub(super) fn symbol(self) -> Option<Sym> {
        match self {
            AliasTarget::Symbol(symbol) => Some(symbol),
            _ => None,
        }
    }
}

impl EntityNameLookup for Checker<'_, '_> {
    fn get_symbol(&mut self, _: SymbolTable, held: Option<Sym>, meaning: SymFlags) -> Option<Sym> {
        Checker::get_symbol(self, held, meaning)
    }

    /// The symbol tables have the target, unless there is a symbol to combine.
    fn resolve_alias(&mut self, alias: Sym) -> Option<Sym> {
        let combined = self.combined_symbol_of_alias(alias);
        combined.or_else(|| self.files().resolve_alias(alias))
    }
}

#[derive(Copy, Clone)]
enum WideningKind {
    FunctionReturn,
    GeneratorNext,
    GeneratorYield,
}

/// What `reportCircularityError` returns for a declaration with the type annotation `annotation`.
pub(super) fn circularity_error_type(annotation: TypeNodeId) -> TypeId {
    if annotation.is_some() {
        TypeId::ERROR
    } else {
        TypeId::ANY
    }
}

/// Whether `getTypeOfSymbol` calls `getTypeOfVariableOrParameterOrProperty` for a symbol with
/// `flags` and `value_declaration`. It tests for an accessor first, and neither
/// `getTypeOfAccessors` nor `getTypeOfAlias` assigns or reports anything where
/// `pushTypeResolution` fails.
fn is_variable_or_property(flags: SymFlags, value_declaration: Option<(FileId, Decl)>) -> bool {
    !flags.intersects(SymFlags::ACCESSOR)
        && (flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY)
            || matches!(
                value_declaration,
                Some((_, Decl::Expando(_) | Decl::ThisProperty(_)))
            ))
}

#[derive(Copy, Clone, Debug)]
pub struct IterationTypes {
    pub yielded: TypeId,
    pub returned: TypeId,
    pub next: TypeId,
}

/// `IterationTypes`: the yield type, the return type and the next type. Any of them may be missing.
/// All missing: the type is not iterable.
#[derive(Copy, Clone, Default)]
pub(super) struct Iter3 {
    pub y: Option<TypeId>,
    pub r: Option<TypeId>,
    pub n: Option<TypeId>,
}

impl Iter3 {
    pub(super) fn has_types(&self) -> bool {
        self.y.is_some() || self.r.is_some() || self.n.is_some()
    }

    fn all(ty: TypeId) -> Iter3 {
        Iter3 {
            y: Some(ty),
            r: Some(ty),
            n: Some(ty),
        }
    }
}

/// `IterationUse`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum IterationUse {
    Element,
    ForOf,
    ForAwaitOf,
    Spread,
    Destructuring,
    YieldStar,
    AsyncYieldStar,
    GeneratorReturnType,
    AsyncGeneratorReturnType,
}

impl IterationUse {
    fn yield_star(is_async: bool) -> IterationUse {
        if is_async {
            IterationUse::AsyncYieldStar
        } else {
            IterationUse::YieldStar
        }
    }

    /// `IterationUseAllowsSyncIterablesFlag`
    fn allows_sync(self) -> bool {
        self != IterationUse::AsyncGeneratorReturnType
    }

    /// `IterationUseAllowsAsyncIterablesFlag`
    pub(super) fn allows_async(self) -> bool {
        matches!(
            self,
            IterationUse::ForAwaitOf
                | IterationUse::AsyncYieldStar
                | IterationUse::AsyncGeneratorReturnType
        )
    }

    /// `IterationUseForOfFlag`, which always comes with `IterationUseAllowsStringInputFlag`.
    fn is_for_of(self) -> bool {
        matches!(self, IterationUse::ForOf | IterationUse::ForAwaitOf)
    }

    /// `use & IterationUseCacheFlags`
    fn cache_flags(self) -> u8 {
        u8::from(self.allows_sync())
            | u8::from(self.allows_async()) << 1
            | u8::from(self.is_for_of()) << 2
    }

    /// No caller in tsgo passes an `errorNode` with it.
    fn has_no_error_node(self) -> bool {
        self.code_for_sent_type().is_none()
    }

    /// The error code reported when `next` does not accept the sent type. `None`: nothing is sent.
    fn code_for_sent_type(self) -> Option<u32> {
        match self {
            IterationUse::ForOf | IterationUse::ForAwaitOf => Some(2763),
            IterationUse::Spread => Some(2764),
            IterationUse::Destructuring => Some(2765),
            IterationUse::YieldStar | IterationUse::AsyncYieldStar => Some(2766),
            IterationUse::Element
            | IterationUse::GeneratorReturnType
            | IterationUse::AsyncGeneratorReturnType => None,
        }
    }
}

/// The message of `reportTypeNotIterableError`.
fn type_not_iterable_code(allows_async: bool) -> u32 {
    if allows_async { 2504 } else { 2488 }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum IteratorMethod {
    Next,
    Return,
    Throw,
}

impl<'p, 's> Checker<'p, 's> {
    /// The type of `sym` as a value.
    #[inline]
    pub fn type_of_symbol(&mut self, sym: Sym) -> TypeId {
        if let Some(known) = self.p.symbol_types.get(&self.task, &sym) {
            return known;
        }
        self.resolve_type_of_symbol(sym)
    }

    #[inline(never)]
    fn resolve_type_of_symbol(&mut self, sym: Sym) -> TypeId {
        loop {
            let ty = self.resolve_type_of_symbol_once(sym);
            if self.unwind_to != self.stack.len() || !self.resolve_what_was_too_deep() {
                return ty;
            }
            if let Some(known) = self.p.symbol_types.get(&self.task, &sym) {
                return known;
            }
        }
    }

    /// Inlined: a frame of its own would be one more for each variable in a chain.
    #[inline(always)]
    fn resolve_type_of_symbol_once(&mut self, sym: Sym) -> TypeId {
        let mut value_declaration = self.files().value_declaration(sym);
        // A parameter property has the type of its parameter, which is a separate query.
        if let Some((file, Decl::ParameterProperty(p))) = value_declaration {
            let scope = self.begin_scope();
            let ty = self.type_of_param(file, p);
            // Cached here once it is cached there, because every `this.x` queries it. The cached value is copied: `ty` can be
            // provisional while the final type is stored.
            let pat = self.hir(file)[p].pat;
            let cached = (self.p.pat_types.get(&self.task, &(file, pat))).map(|(ty, _)| ty);
            if let (Ok(stored), Some(cached)) = (self.end_scope(scope), cached) {
                self.p.symbol_types.insert(&self.task, sym, cached, stored);
            }
            return ty;
        }
        // Before the query is entered: `lateBindMember` resolves the names of the other members,
        // which may re-enter this query.
        let mut flags = self.files().flags(sym);
        let (mut members, mut declarations) = (SmallVec::new(), List::default());
        if flags.intersects(SymFlags::CLASS_MEMBER) {
            (flags, value_declaration, declarations) = self.merged_symbol_of_property(sym);
            members = members_among(&declarations);
            if let Some(known) = self.p.symbol_types.get(&self.task, &sym) {
                return known;
            }
        }
        // `checkCallExpression` checks the descriptor of `Object.defineProperty(f, "name",
        // descriptor)` before anything requests the type of `name`: the text
        // `reportNonexistentProperty` prints for an access in the descriptor starts the resolution.
        let in_report = !self.reporting_nonexistent.is_empty()
            && matches!(value_declaration, Some((file, Decl::Expando(e)))
                if matches!(self.hir(file)[e].kind, ExprKind::Call(_)));
        if in_report && self.stack[self.resolution_start..].contains(&Query::Symbol(sym)) {
            return self.type_of_circular_symbol(sym, flags, value_declaration, None);
        }
        if let Some(raw) = self.provisional(Query::Symbol(sym)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::Symbol(sym)) {
            if !self.found_cycle {
                // `getTypeOfFuncClassEnumModule` has no guard against re-entry. For a class whose
                // base expression refers to it, `getBaseConstructorTypeOfClass` finds the cycle,
                // and the reference has the type of the class without a base type variable.
                let from = self.resolution_start.min(self.stack.len());
                if self.files().flags(sym).contains(SymFlags::CLASS)
                    && self.stack[from..].contains(&Query::Symbol(sym))
                {
                    return self.type_of_class_value(sym);
                }
                return TypeId::UNRESOLVED;
            }
            let ty = self.type_of_circular_symbol(sym, flags, value_declaration, None);
            let ty = self.cache_circularity_error_type(sym, flags, value_declaration, ty);
            if let Some((file, Decl::Var(pat) | Decl::Param(pat))) = value_declaration {
                self.report_circularity_error_of_pat(Query::Pat(file, pat), file, pat);
            } else if is_variable_or_property(flags, value_declaration) {
                let first = declarations.first().copied();
                self.report_circularity_error_of_property(sym, value_declaration, first, ty);
            }
            return ty;
        }
        // `checkExpressionCached` has no guard against re-entry: the descriptor is checked again from the start.
        let resolution_start = self.resolution_start;
        if in_report {
            self.resolution_start = self.stack.len() - 1;
        }
        // `getTypeOfSymbol` tests for an accessor, then for a property, then for a method.
        let is_property =
            flags.contains(SymFlags::PROPERTY) && !flags.intersects(SymFlags::ACCESSOR);
        let ty = match value_declaration {
            // `getTypeOfVariableOrParameterOrPropertyWorker`, `case ast.KindMethodDeclaration`:
            // `checkObjectLiteralMethod` ends with `getTypeOfSymbol(getSymbolOfDeclaration(node))`.
            Some((file, Decl::Member(m)))
                if is_property && self.hir(file)[m].kind == MemberKind::Method =>
            {
                self.type_of_symbol(sym)
            }
            _ if members.is_empty() => self.type_of_symbol_uncached(sym),
            _ => self.type_of_members_uncached(&members),
        };
        self.resolution_start = resolution_start;
        // For `module` and `exports`, `getTypeOfVariableOrParameterOrPropertyWorker` returns
        // without `popTypeResolution`: only a `pushTypeResolution` that fails reports.
        let is_module_exports = self.files().flags(sym).contains(SymFlags::MODULE_EXPORTS);
        let left = match is_module_exports {
            true => self.leave_without_pop(sym),
            false => self.leave(Query::Symbol(sym)),
        };
        if self.left_a_cycle && !is_module_exports {
            let ty = self.type_of_circular_symbol(sym, flags, value_declaration, Some(ty));
            let stored = self.cycle_result();
            let kept = self.p.symbol_types.insert(&self.task, sym, ty, stored);
            let first = declarations.first().copied();
            match value_declaration {
                Some((_, Decl::Member(_))) if flags.intersects(SymFlags::ACCESSOR) => {
                    self.report_circular_accessors(sym, &members);
                }
                Some((_, Decl::Member(_) | Decl::Expando(_) | Decl::ThisProperty(_))) => {
                    self.report_circularity_error_of_property(sym, value_declaration, first, ty);
                }
                _ if flags.contains(SymFlags::ALIAS) && !flags.intersects(SymFlags::VALUE) => {
                    self.report_circularity_error_of_alias(sym);
                }
                _ if flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY) => {
                    self.report_circularity_error_of_property(sym, value_declaration, first, ty);
                }
                _ => {}
            }
            return kept;
        }
        // `getTypeOfAccessors`: `links.resolvedType` is assigned only if it is nil, and the caller
        // gets that value. `getTypeOfVariableOrParameterOrProperty` returns its own.
        if flags.intersects(SymFlags::ACCESSOR)
            && let Some(known) = self.p.symbol_types.get(&self.task, &sym)
        {
            return known;
        }
        match left {
            // `getTypeOfEnumMember` assigns `links.resolvedType` whatever a nested call has
            // assigned.
            Ok(stored) if self.files().flags(sym).contains(SymFlags::ENUM_MEMBER) => {
                self.p.symbol_types.rewrite(&self.task, sym, ty, stored);
            }
            Ok(stored) => {
                self.p.symbol_types.insert(&self.task, sym, ty, stored);
            }
            Err(open) => self.cache_provisionally(Query::Symbol(sym), u64::from(ty.0), open),
        }
        ty
    }

    /// `reportCircularityError`, where `popTypeResolution` finds the cycle. `at`:
    /// `symbol.ValueDeclaration`. `ty`: the result of `circularity_error_type` for it.
    /// `is_bare_parameter`: it is a parameter without an initializer.
    pub(super) fn report_circularity_error(
        &mut self,
        owner: Query,
        at: (FileId, u32, u32),
        name: Arg<'_>,
        ty: TypeId,
        is_bare_parameter: bool,
    ) {
        let code = if ty == TypeId::ERROR {
            2502
        } else if self.p.files.options.no_implicit_any && !is_bare_parameter {
            7022
        } else {
            return;
        };
        let err = self.new_diagnostic(at, code, &[name]);
        self.add_diagnostic_of(Some(owner), err);
    }

    /// `reportCircularityError(symbol)` in `getTypeOfVariableOrParameterOrPropertyWorker`, both
    /// where `pushTypeResolution` fails and where `popTypeResolution` finds the cycle, for a
    /// `sym` whose `value_declaration` is no variable, parameter or binding element. `first`:
    /// `symbol.Declarations[0]`. `ty`: what it returns.
    #[cold]
    #[inline(never)]
    fn report_circularity_error_of_property(
        &mut self,
        sym: Sym,
        value_declaration: Option<(FileId, Decl)>,
        first: Option<(FileId, Decl)>,
        ty: TypeId,
    ) {
        let owner = Query::Symbol(sym);
        match value_declaration {
            Some((file, Decl::Member(member))) => {
                let (hir, end) = (self.hir(file), self.end_of_member_name(file, member));
                let start = hir[member].name_pos;
                // `getNameOfSymbolAsWritten`: the name in the first declaration that has one.
                let name = match first {
                    Some(named) if named != (file, Decl::Member(member)) => Arg::Sym(sym),
                    _ => Arg::Bytes(&hir.text[start as usize..end as usize]),
                };
                self.report_circularity_error(owner, (file, start, end), name, ty, false);
            }
            Some((file, Decl::Expando(declaration) | Decl::ThisProperty(declaration))) => {
                let hir = self.hir(file);
                let range = |c: &Self, e: ExprId| {
                    (
                        file,
                        c.start_inside_parentheses(file, e),
                        c.end_inside_parentheses(file, e),
                    )
                };
                // `GetNonAssignedNameOfDeclaration`: for `f["a"] = e` and `Object.defineProperty(f,
                // "a", d)` the `"a"`, as source text.
                let named = match hir[declaration].kind {
                    ExprKind::Assign { target, .. } => match hir[target].kind {
                        ExprKind::Index { index, .. } => Some(index),
                        _ => None,
                    },
                    ExprKind::Call(call) => hir.ids(hir[call].args).nth(1),
                    _ => None,
                };
                let name = match named.map(|named| range(self, named)) {
                    Some((_, start, end)) => Arg::Bytes(&hir.text[start as usize..end as usize]),
                    None => Arg::Atom(self.files().symbol(sym).name),
                };
                let at = range(self, declaration);
                self.report_circularity_error(owner, at, name, ty, false);
            }
            _ => {
                if let Some(at) = self.place_of_export_value_declaration(sym) {
                    self.report_circularity_error(owner, at, Arg::Sym(sym), ty, false);
                }
            }
        }
    }

    /// `report_circularity_error` for the variable, parameter or binding element whose name is
    /// `pat`.
    pub(super) fn report_circularity_error_of_pat(
        &mut self,
        owner: Query,
        file: FileId,
        pat: PatId,
    ) {
        let hir = self.hir(file);
        // `symbolToString`: `DeclarationNameToString` of a pattern is its text.
        let name = match hir[pat].kind {
            PatKind::Ident(name) => Arg::Atom(name),
            PatKind::Object(_) | PatKind::Array(_) => {
                Arg::Bytes(&hir.text[hir[pat].pos as usize..hir[pat].end as usize])
            }
            PatKind::Missing => return,
        };
        // `GetErrorRangeForNode`: the range of a parameter is not its name but begins at its start,
        // modifiers and `...` included.
        let (is_bare_parameter, start, end) = match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Param(p) => (
                hir[p].default.is_none(),
                hir[p].pos,
                self.end_of_param(file, p),
            ),
            _ => (
                false,
                hir[pat].pos,
                self.end_of_token_at(file, hir[pat].pos),
            ),
        };
        let ty = circularity_error_type(self.type_annotation_of_pat(file, pat));
        self.report_circularity_error(owner, (file, start, end), name, ty, is_bare_parameter);
    }

    /// The end of `getTypeOfAlias`, where `popTypeResolution` finds the cycle:
    /// `reportCircularityError(core.OrElse(exportSymbol, symbol))`.
    fn report_circularity_error_of_alias(&mut self, alias: Sym) {
        let owner = Query::Symbol(alias);
        // `getTargetOfAliasDeclaration`, which does not resolve an alias it finds.
        let export_symbol = match self.files().alias_links(alias).immediate_target {
            Some(target) => AliasTarget::Symbol(target),
            None => self.resolve_alias(alias),
        };
        match export_symbol {
            AliasTarget::Symbol(symbol) => self.report_circularity_error_of_symbol(owner, symbol),
            AliasTarget::Property(..) => {
                if let Some(prop) = self.property_of_alias(alias)
                    && let Some(declaration) = self.value_declaration_of_prop(prop)
                {
                    self.report_circularity_error_at(owner, declaration, Arg::Prop(prop));
                }
            }
            AliasTarget::Unknown => self.report_circularity_error_of_symbol(owner, alias),
        }
    }

    /// `reportCircularityError`
    fn report_circularity_error_of_symbol(&mut self, owner: Query, symbol: Sym) {
        let files = self.files();
        if let Some(declaration) = files.value_declaration(symbol) {
            self.report_circularity_error_at(owner, declaration, Arg::Sym(symbol));
        } else if files.flags(symbol).contains(SymFlags::ALIAS)
            && let Some((file, node)) = files.declaration_of_alias_symbol(symbol)
            && let Some(at) = self.place_of_alias_declaration(Sym { file, ..symbol }, node)
        {
            let diagnostic = self.new_diagnostic(at, 2303, &[Arg::Sym(symbol)]);
            self.add_diagnostic_of(Some(owner), diagnostic);
        }
    }

    /// `reportCircularityError` for a symbol that has the `ValueDeclaration` `declaration` and is
    /// printed as `name`.
    fn report_circularity_error_at(
        &mut self,
        owner: Query,
        (file, declaration): (FileId, Decl),
        name: Arg<'_>,
    ) {
        if let Decl::Var(pat) | Decl::Param(pat) = declaration {
            return self.report_circularity_error_of_pat(owner, file, pat);
        }
        let Some((start, end)) = self.error_range_of_declaration(file, declaration) else {
            return;
        };
        let ty = circularity_error_type(self.type_node_of_declaration(file, declaration));
        let is_bare_parameter = matches!(declaration, Decl::ParameterProperty(p) if self.hir(file)[p].default.is_none());
        self.report_circularity_error(owner, (file, start, end), name, ty, is_bare_parameter);
    }

    /// `declaration.Type()`
    fn type_node_of_declaration(&self, file: FileId, declaration: Decl) -> TypeNodeId {
        let hir = self.hir(file);
        match declaration {
            Decl::Var(pat) | Decl::Param(pat) => self.type_annotation_of_pat(file, pat),
            Decl::ParameterProperty(p) => hir[p].ty,
            Decl::Fn(func) => hir[func].ret,
            Decl::Member(m) if hir[m].func.is_some() => hir[hir[m].func].ret,
            Decl::Member(m) => hir[m].ty,
            Decl::Property(p) => match hir[p].kind {
                PropKind::Init | PropKind::Shorthand => hir.jsdoc_type(JsDocTypeOwner::Prop(p)),
                PropKind::Spread => TypeNodeId::NONE,
                _ if hir[p].value.is_none() => TypeNodeId::NONE,
                PropKind::Method | PropKind::Getter | PropKind::Setter => {
                    match hir[hir[p].value].kind {
                        ExprKind::Fn(func) => hir[func].ret,
                        _ => TypeNodeId::NONE,
                    }
                }
            },
            Decl::ExportExpr(statement) => hir.jsdoc_type(JsDocTypeOwner::Export(statement)),
            Decl::ModuleExports(assignment)
            | Decl::ExportsProperty(assignment)
            | Decl::Expando(assignment)
            | Decl::ThisProperty(assignment) => hir.jsdoc_type(JsDocTypeOwner::Assign(assignment)),
            _ => TypeNodeId::NONE,
        }
    }

    /// The error range of `symbol.ValueDeclaration` for `export default e`, `export = e`, `module.exports = e`, `exports.a = e`, and for
    /// the CommonJS variables `exports` and `module`, whose declaration is the source file (`declareCommonJSVariable`).
    fn place_of_export_value_declaration(&self, sym: Sym) -> Option<(FileId, u32, u32)> {
        let (file, declaration) = self.files().value_declaration(sym)?;
        let is_export = matches!(
            declaration,
            Decl::ExportExpr(_)
                | Decl::ModuleExports(_)
                | Decl::ExportsProperty(_)
                | Decl::CommonJsVariable
        );
        let (start, end) = self.error_range_of_declaration(file, declaration)?;
        is_export.then_some((file, start, end))
    }

    /// The type of `sym`, which has `flags` and `value_declaration`, when the resolution of its
    /// type depends on itself. `resolved`: the resolved type, if `popTypeResolution` found the
    /// cycle. `None`: `pushTypeResolution` found it.
    fn type_of_circular_symbol(
        &self,
        sym: Sym,
        flags: SymFlags,
        value_declaration: Option<(FileId, Decl)>,
        resolved: Option<TypeId>,
    ) -> TypeId {
        // `getTypeOfAlias`
        if flags.contains(SymFlags::ALIAS) && !flags.intersects(SymFlags::VALUE) {
            return resolved.unwrap_or(TypeId::ERROR);
        }
        // `getTypeOfAccessors`: `errorType` where `pushTypeResolution` finds the cycle, `anyType`
        // where `popTypeResolution` does.
        if flags.intersects(SymFlags::ACCESSOR) {
            return resolved.map_or(TypeId::ERROR, |_| TypeId::ANY);
        }
        // `symbol.ValueDeclaration.Type()`
        if let Some((file, member @ Decl::Member(_))) = value_declaration {
            return circularity_error_type(self.type_node_of_declaration(file, member));
        }
        for (file, decl) in declarations_of(self.files(), sym) {
            let hir = self.hir(file);
            let annotation = match decl {
                Decl::Var(pat) | Decl::Param(pat) => self.type_annotation_of_pat(file, pat),
                Decl::Member(m) => hir[m].ty,
                Decl::ExportExpr(stmt) => hir.jsdoc_type(JsDocTypeOwner::Export(stmt)),
                Decl::Expando(e) | Decl::ThisProperty(e) => {
                    hir.jsdoc_type(JsDocTypeOwner::Assign(e))
                }
                Decl::ModuleExports(_) | Decl::ExportsProperty(_) => {
                    match self.commonjs_value_declaration(self.files().symbol(sym)) {
                        Some(assignment) => hir.jsdoc_type(JsDocTypeOwner::Assign(assignment)),
                        None => TypeNodeId::NONE,
                    }
                }
                _ => continue,
            };
            return circularity_error_type(annotation);
        }
        TypeId::ANY
    }

    /// `getTypeOfVariableOrParameterOrProperty` where `pushTypeResolution` fails: what
    /// `reportCircularityError` returns is assigned to `links.resolvedType`. The next request does
    /// not get to `pushTypeResolution`, so a resolution that begins after this one is not in the
    /// cycle: in `const a = [g(), h()]`, where both functions return `a`, only `g` is. And
    /// `typeResolutionHasProperty` holds for the resolution in progress.
    fn cache_circularity_error_type(
        &mut self,
        sym: Sym,
        flags: SymFlags,
        value_declaration: Option<(FileId, Decl)>,
        ty: TypeId,
    ) -> TypeId {
        if !is_variable_or_property(flags, value_declaration) {
            return ty;
        }
        if let Some((file, Decl::Var(pat) | Decl::Param(pat))) = value_declaration
            && !self.cache_circularity_error_type_of_pat(file, pat, ty)
        {
            return ty;
        }
        let stored = self.cycle_result();
        self.note_result(Query::Symbol(sym));
        self.p.symbol_types.insert(&self.task, sym, ty, stored)
    }

    /// `cache_circularity_error_type` for the name `pat`. `false`, and nothing is cached:
    /// `isParameterOfContextSensitiveSignature`.
    pub(super) fn cache_circularity_error_type_of_pat(
        &mut self,
        file: FileId,
        pat: PatId,
        ty: TypeId,
    ) -> bool {
        if let PatParent::Param(p) = root_declaration(self.bound(file), pat)
            && self.is_parameter_of_context_sensitive_signature(file, p)
        {
            return false;
        }
        let stored = self.cycle_result();
        self.note_result(Query::Pat(file, pat));
        self.note_result(Query::ParameterSymbol(file, pat));
        self.p
            .pat_types
            .insert(&self.task, (file, pat), (ty, true), stored);
        true
    }

    /// `isParameterOfContextSensitiveSignature`, where `GetRootDeclaration` is the parameter `p`.
    pub(super) fn is_parameter_of_context_sensitive_signature(
        &self,
        file: FileId,
        p: ParamId,
    ) -> bool {
        let bound = self.bound(file);
        let func = bound.param_fn[p.idx()];
        matches!(bound.fns[func.idx()].owner, FnOwner::Expr(owner)
            if self.is_context_sensitive_function_or_method(file, func, owner))
    }

    /// `declaration.Type()` of the variable declaration, parameter or binding element whose name is `pat`.
    pub(super) fn type_annotation_of_pat(&self, file: FileId, pat: PatId) -> TypeNodeId {
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Var(d) => self.hir(file)[d].ty,
            PatParent::Param(p) => self.hir(file)[p].ty,
            _ => TypeNodeId::NONE,
        }
    }

    fn type_of_symbol_uncached(&mut self, sym: Sym) -> TypeId {
        // `c.valueSymbolLinks.Get(c.undefinedSymbol).resolvedType = c.undefinedWideningType`
        if sym == self.files().undefined_symbol {
            return self.undefined_widening();
        }
        // `cloneTypeAsModuleType` assigns the type of the symbol it creates. A symbol created by
        // `combineValueAndTypeSymbols` has the type of the value.
        if let Some((alias, is_combined)) = self.files().alias_of_transient_symbol(sym)
            && let Some(ty) = if is_combined {
                self.symbol_from_variable(alias).map(|found| found.2)
            } else {
                self.type_of_namespace_import(alias)
            }
        {
            return ty;
        }
        let flags = self.files().flags(sym);
        // `getTypeOfSymbol`: the alias case comes last, so a local value declaration of the name
        // takes precedence.
        if flags.contains(SymFlags::ALIAS) && !flags.intersects(SymFlags::VALUE) {
            return self.type_of_alias(sym);
        }
        // `getTypeOfVariableOrParameterOrPropertyWorker`: `exports` has the type of the module as
        // `require` returns it, and `module` contains it.
        if flags.contains(SymFlags::MODULE_EXPORTS) {
            if self.files().symbol(sym).name == known::exports {
                let module = self.files().file_symbol(sym.file);
                let value = self.resolve_external_module_symbol(module);
                return self.type_of_alias_target(value);
            }
            // `newAnonymousType(symbol, symbol.Members, ..)`
            let property = self.bound(sym.file).module_exports_property;
            let prop = Prop {
                name: known::exports,
                flags: PropFlags::empty(),
                source: PropSource::Symbol(self.files().sym(sym.file, property)),
                mapper: MapperId::IDENTITY,
            };
            return self.synth(Shape {
                props: vec_from_iter_in([prop], self.arena),
                ..Shape::new_in(self.arena)
            });
        }
        if flags.intersects(SymFlags::VARIABLE) {
            for (file, decl) in declarations_of(self.files(), sym) {
                if let Decl::Var(pat) | Decl::Param(pat) = decl {
                    return self.type_of_pat(file, pat);
                }
            }
        }
        if let Some(ty) = self.type_of_assignment_declarations(sym) {
            return ty;
        }
        if flags.contains(SymFlags::CLASS) {
            return self.type_of_class_value(sym);
        }
        if flags.contains(SymFlags::FUNCTION) {
            let mut mapper = MapperId::IDENTITY;
            for (file, decl) in declarations_of(self.files(), sym) {
                if let Decl::Fn(f) = decl {
                    let scope = self.bound(file).fns[f.idx()].scope;
                    let parent = self.bound(file).scopes[scope.idx()].parent;
                    mapper = self.identity_mapper(file, parent);
                    // `checkFunctionExpressionOrObjectLiteralMethod`: the type of a function expression is the type of its symbol.
                    if matches!(self.bound(file).fns[f.idx()].owner, FnOwner::Expr(_)) {
                        return self.intern_key(TypeKey::Fns {
                            decls: &[(file, f)],
                            mapper,
                        });
                    }
                    break;
                }
            }
            return self.intern(TypeData::Anon {
                origin: Origin::Function(sym),
                mapper,
            });
        }
        if flags.intersects(SymFlags::ENUM) {
            return self.intern(TypeData::Anon {
                origin: Origin::EnumObject(sym),
                mapper: MapperId::IDENTITY,
            });
        }
        if flags.contains(SymFlags::ENUM_MEMBER) {
            let ty = self.enum_member_type(sym);
            return self.fresh(ty);
        }
        if flags.contains(SymFlags::VALUE_MODULE) {
            if sym == self.files().global_this_symbol {
                return self.intern(TypeData::Anon {
                    origin: Origin::GlobalThis,
                    mapper: MapperId::IDENTITY,
                });
            }
            // Of `declare module "m";` nothing is known.
            if self.files().is_shorthand_ambient_module_symbol(sym) {
                return TypeId::ANY;
            }
            return self.intern(TypeData::Anon {
                origin: Origin::Module(sym),
                mapper: MapperId::IDENTITY,
            });
        }
        if flags.contains(SymFlags::PROPERTY) {
            for (file, decl) in declarations_of(self.files(), sym) {
                if let Decl::ExportExpr(stmt) = decl
                    && let StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) =
                        self.hir(file)[stmt].kind
                {
                    // `declaration.Type()`
                    let annotation = self.hir(file).jsdoc_type(JsDocTypeOwner::Export(stmt));
                    if annotation.is_some() {
                        return self.type_from_node(file, annotation);
                    }
                    // A literal type is preserved, except in a JSON file
                    // (`getTypeOfVariableOrParameterOrPropertyWorker`).
                    let hir = self.hir(file);
                    let is_json = hir.kind == FileKind::Json;
                    // `len(statements) == 0`: the value of a text without a token is an object
                    // literal at its end (`parse_json_text`).
                    if is_json && hir.text.get(hir[e].pos as usize).is_none() {
                        return TypeId::EMPTY_OBJECT;
                    }
                    let ty = self.type_of_expr(file, e);
                    return if is_json {
                        self.widened(ty)
                    } else {
                        self.widened_for_declaration(ty, None)
                    };
                }
            }
        }
        // `bindClassLikeDeclaration`: the `prototype` of a class is among its exports.
        let name = self.files().symbol(sym).name;
        if flags.intersects(SymFlags::CLASS_MEMBER)
            && let Some(class) = self.files().parent_of_symbol(sym)
            && self.files().flags(class).contains(SymFlags::CLASS)
            && self.files().export(class, name) == Some(self.files().canonical(sym))
        {
            let statics = self.type_of_class_value(class);
            return self
                .type_of_property(statics, name)
                .unwrap_or(TypeId::ERROR);
        }
        if !flags.intersects(SymFlags::VALUE) {
            // A symbol that is not a value has the error type.
            return TypeId::ERROR;
        }
        TypeId::UNRESOLVED
    }

    /// `getTypeOfVariableOrParameterOrPropertyWorker`, `case KindBinaryExpression, KindCallExpression`. `None`: no assignment declares `sym`.
    fn type_of_assignment_declarations(&mut self, sym: Sym) -> Option<TypeId> {
        let (mut first_expando, mut first_export) = (None, None);
        // Every class, function and enum reaches this point: late binding only adds to symbols that
        // assignments declare.
        let declarations = match self.files().flags(sym).contains(SymFlags::ASSIGNMENT) {
            true => self.declarations_of_property(sym),
            false => self.files().decls_of(sym),
        };
        for &(file, decl) in declarations.iter() {
            match decl {
                Decl::Expando(e) | Decl::ThisProperty(e) if file == sym.file => {
                    first_expando = first_expando.or(Some(e));
                }
                Decl::ModuleExports(e) | Decl::ExportsProperty(e) if file == sym.file => {
                    first_export = first_export.or(Some(e));
                }
                _ => {}
            }
        }
        let name = self.files().symbol(sym).name;
        // `SetValueDeclaration`: an assignment yields to any other value declaration.
        let others = SymFlags::VALUE.difference(SymFlags::PROPERTY);
        let value_declaration = match first_expando {
            Some(first) if !self.files().flags(sym).intersects(others) => first,
            _ => self
                .commonjs_value_declaration(self.files().symbol(sym))
                .or(first_export)?,
        };
        Some(self.get_widened_type_for_assignment_declaration(
            sym.file,
            name,
            &declarations,
            value_declaration,
        ))
    }

    /// `getTypeOfAlias`
    pub(super) fn type_of_alias(&mut self, sym: Sym) -> TypeId {
        match self.resolve_alias(sym) {
            AliasTarget::Symbol(target) if target != sym => self.type_of_symbol(target),
            AliasTarget::Property(_, _, ty) => ty,
            _ => TypeId::ERROR,
        }
    }

    /// `resolveAlias`. `Files::alias_links` has `getTargetOfAliasDeclaration` as far as it can be
    /// resolved by name. The part that needs types is added here.
    pub(super) fn resolve_alias(&mut self, alias: Sym) -> AliasTarget {
        let files = self.files();
        let mut at = alias;
        // The aliases from `alias` to `at`. `resolveIndirectionAlias`: each is being resolved while
        // the next one is. They are only entered where a type is asked for.
        let mut resolving: SmallVec<[Sym; 4]> = SmallVec::new();
        // Every alias in a cycle `is_circular`, so the walk ends.
        loop {
            if !files.flags(at).contains(SymFlags::ALIAS) {
                return AliasTarget::Symbol(at);
            }
            let links = files.alias_links(at);
            if links.is_circular {
                return AliasTarget::Unknown;
            }
            resolving.push(at);
            if let Some(module) = self.module_of_namespace_import_or_export(at) {
                if !self.enter_alias_targets(&resolving) {
                    return AliasTarget::Unknown;
                }
                let created = self.resolve_es_module_symbol(at, module);
                if !self.leave_alias_targets(&resolving) {
                    return AliasTarget::Unknown;
                }
                if let Some(created) = created {
                    return created;
                }
            }
            let immediate_target = match self.target_of_module_default(&resolving) {
                Some(AliasTarget::Symbol(target)) => Some(target),
                Some(target) => return target,
                None => links.immediate_target,
            };
            let Some(next) = immediate_target else {
                let before = &resolving[..resolving.len() - 1];
                if !self.enter_alias_targets(before) {
                    return AliasTarget::Unknown;
                }
                let symbol_from_variable = self.symbol_from_variable(at);
                if !self.leave_alias_targets(before) {
                    return AliasTarget::Unknown;
                }
                let symbol_from_module = self.synthetic_default_from_module(&resolving);
                // `combineValueAndTypeSymbols`: the property is the value. The `default` that
                // `createDefaultPropertyWrapperForModule` makes is an alias without a declaration:
                // combined with the `export =`, it resolves as that does.
                let symbol_from_variable = symbol_from_variable.filter(|&(object, ..)| {
                    symbol_from_module.is_none() || !self.has_default_property_wrapper(object)
                });
                if let Some((object, name, ty)) = symbol_from_variable {
                    return AliasTarget::Property(object, name, ty);
                }
                let Some(next) = symbol_from_module else {
                    return self.resolved_symbol_of_alias_like_expression(&resolving);
                };
                at = next;
                continue;
            };
            if let Some(combined) = self.combined_symbol_of_alias(at) {
                return AliasTarget::Symbol(combined);
            }
            // As in `aliasTarget` of the symbol links: a target resolved while symbols were merged is the symbol that
            // existed at that time.
            if next == at || !files.is_non_local_alias(next) {
                // `resolveIndirectionAlias`: `getMergedSymbol(resolveAlias(target))`.
                return AliasTarget::Symbol(match at == alias {
                    true => next,
                    false => files.canonical(next),
                });
            }
            at = next;
        }
    }

    /// `resolveSymbol`
    pub(super) fn resolve_symbol(&mut self, symbol: impl Into<AliasTarget>) -> AliasTarget {
        match symbol.into() {
            AliasTarget::Symbol(alias) if self.files().is_non_local_alias(alias) => {
                self.resolve_alias(alias)
            }
            symbol => symbol,
        }
    }

    /// `resolveExternalModuleSymbol(module, false /*dontResolveAlias*/)`. `Files::module_value`
    /// follows an `export =` past an `import * as ns` to what that imports, also where
    /// `resolveESModuleSymbol` creates a symbol for `ns`.
    pub(super) fn resolve_external_module_symbol(&mut self, module: Sym) -> AliasTarget {
        let files = self.files();
        match files.export(module, known::export_equals) {
            Some(equals) if files.is_non_local_alias(equals) => match self.resolve_alias(equals) {
                AliasTarget::Symbol(symbol) => AliasTarget::Symbol(files.canonical(symbol)),
                target => target,
            },
            _ => AliasTarget::Symbol(files.module_value(module)),
        }
    }

    /// `getTypeOfSymbol`
    pub(super) fn type_of_alias_target(&mut self, symbol: AliasTarget) -> TypeId {
        match symbol {
            AliasTarget::Symbol(symbol) => self.type_of_symbol(symbol),
            AliasTarget::Property(_, _, ty) => ty,
            AliasTarget::Unknown => TypeId::ERROR,
        }
    }

    /// The end of `getTargetOfAliasLikeExpression`: in `export = e`, `export default e`,
    /// `module.exports = e` and `exports.x = e`, an entity name `e` that `resolveEntityName` does
    /// not resolve aliases the `resolvedSymbol` that checking `e` records. For the last of the
    /// aliases `resolving` (`enter_alias_targets`).
    fn resolved_symbol_of_alias_like_expression(&mut self, resolving: &[Sym]) -> AliasTarget {
        let Some(&sym) = resolving.last() else {
            return AliasTarget::Unknown;
        };
        let Some((file, decl)) = self.files().declaration_of_alias_symbol(sym) else {
            return AliasTarget::Unknown;
        };
        let hir = self.hir(file);
        let e = match decl {
            Decl::ExportExpr(stmt) => match hir[stmt].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => e,
                _ => return AliasTarget::Unknown,
            },
            Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
                match hir[assignment].kind {
                    ExprKind::Assign { value, .. } => value,
                    _ => return AliasTarget::Unknown,
                }
            }
            _ => return AliasTarget::Unknown,
        };
        // `resolveAlias`: `e` is checked while every one of them is being resolved.
        if !self.enter_alias_targets(resolving) {
            return AliasTarget::Unknown;
        }
        let target = self.resolved_symbol_of_checked_expression(file, e);
        match self.leave_alias_targets(resolving) {
            true => target,
            false => AliasTarget::Unknown,
        }
    }

    /// `checkExpressionCached(e)`, then `getResolvedSymbolOrNil(e)`, for an entity name expression
    /// `e` that `resolveEntityName` does not resolve.
    fn resolved_symbol_of_checked_expression(&mut self, file: FileId, e: ExprId) -> AliasTarget {
        let hir = self.hir(file);
        match hir[e].kind {
            // `argumentsSymbol` is not a property of any type.
            ExprKind::Ident(name)
                if name == known::arguments
                    && self.symbol_of_identifier(file, e, name).is_none() =>
            {
                AliasTarget::Property(TypeId::NEVER, name, self.type_of_expr(file, e))
            }
            // `checkPropertyAccessExpressionOrQualifiedName` records a property, never an index
            // signature, and nothing for `any`.
            ExprKind::Dot { obj, name, .. } => {
                let object = self.type_of_expr(file, obj);
                // `checkNonNullExpression`
                let object = self.non_null_type(object);
                if self.is_any(object) {
                    return AliasTarget::Unknown;
                }
                if let Some((property, _)) = self.declared_property(object, name) {
                    return AliasTarget::Property(object, name, property);
                }
                // `getPropertyOfTypeEx` also finds the members of `Object` and `Function`, except on a `const enum` object.
                let apparent = self.reduced_apparent_type(object);
                if !self.is_union(apparent)
                    && !self.is_const_enum_object(apparent)
                    && let Some(members) = self.members(apparent)
                    && members.resolved.prop(name).is_none()
                    && let Some((prop, mapper)) = self.property_in_type(apparent, &members, name)
                {
                    return AliasTarget::Property(object, name, self.type_of_prop(prop, mapper));
                }
                AliasTarget::Unknown
            }
            _ => AliasTarget::Unknown,
        }
    }

    /// `getExternalModuleMember`: `combineValueAndTypeSymbols(symbolFromVariable,
    /// symbolFromModule)`, where it creates a symbol.
    pub(super) fn combined_symbol_of_alias(&mut self, alias: Sym) -> Option<Sym> {
        let combined = self.files().combined_symbol(alias)?;
        self.symbol_from_variable(alias).map(|_| combined)
    }

    /// `getSymbolFlags`. The symbol tables compute and cache it, unless types are needed: where the
    /// alias chain does not resolve to a symbol, or there is a symbol to combine.
    pub(super) fn get_symbol_flags(&mut self, sym: Sym) -> SymFlags {
        let files = self.files();
        let kept = files.symbol_flags(sym);
        if kept != SymFlags::all() && files.combined_symbol(sym).is_none() {
            return kept;
        }
        self.flags_of_alias_target(sym)
            .map_or(SymFlags::all(), |of_target| files.flags(sym) | of_target)
    }

    /// `getSymbolFlags(resolveAlias(alias))`. `None`: `unknownSymbol`.
    pub(super) fn flags_of_alias_target(&mut self, alias: Sym) -> Option<SymFlags> {
        let files = self.files();
        match self.resolve_alias(alias) {
            AliasTarget::Symbol(target) => {
                Some(files.symbol_flags(files.export_symbol_of_value_symbol_if_exported(target)))
            }
            // An export of a namespace or a module is a property of its type, and has the meaning
            // it has there.
            AliasTarget::Property(..) => Some(match self.property_of_alias(alias) {
                Some(&Prop {
                    source: PropSource::Symbol(member),
                    ..
                }) => files.symbol_flags(member),
                _ => SymFlags::PROPERTY,
            }),
            AliasTarget::Unknown => None,
        }
    }

    /// `getSymbol`
    pub(super) fn get_symbol(&mut self, held: Option<Sym>, meaning: SymFlags) -> Option<Sym> {
        held.filter(|&symbol| self.get_symbol_flags(symbol).intersects(meaning))
    }

    /// `resolveName`
    pub(super) fn resolve(
        &mut self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        reports_errors: bool,
    ) -> Result<Option<Sym>, (u32, MemberId)> {
        let files = self.files();
        let scope = self.bound(file).scope_to_resolve_from(scope, name);
        files.resolve_with(
            file,
            scope,
            name,
            meaning,
            reports_errors,
            &mut |_, held, meaning| self.get_symbol(held, meaning),
        )
    }

    /// `resolveEntityName`, `dontResolveAlias`
    pub(super) fn resolve_entity_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: Span<NameId>,
        meaning: SymFlags,
        ignore_errors: bool,
    ) -> Option<Sym> {
        let files = self.files();
        let texts: SmallVec<[Atom; 4]> = self.hir(file).texts(names).collect();
        let found = files.resolve_entity_with(file, scope, &texts, meaning, !ignore_errors, self);
        if found.is_none() && !ignore_errors {
            self.report_unresolved_entity_name(file, scope, names, meaning);
        }
        found
    }

    /// `resolveAlias` of `sym`, where it resolves to a property.
    pub(super) fn property_of_alias(&mut self, sym: Sym) -> Option<&'p Prop<'p>> {
        let AliasTarget::Property(object, name, _) = self.resolve_alias(sym) else {
            return None;
        };
        // `getReducedApparentType`
        let apparent = self.reduced_apparent_type(object);
        Some(self.prop_ref(apparent, name)?.0)
    }

    /// The module that `getTargetOfNamespaceImport` or `getTargetOfNamespaceExport` passes to
    /// `resolveESModuleSymbol` for `alias`: `import * as ns`, `export * as ns`.
    fn module_of_namespace_import_or_export(&self, alias: Sym) -> Option<Sym> {
        let (file, files) = (alias.file, self.files());
        let hir = self.hir(file);
        let mut declarations = files.symbol(alias).decls.iter();
        let (spec, mode) = declarations.find_map(|&decl| match decl {
            Decl::ImportNamespace(import) => Some((hir[import].spec, hir[import].mode)),
            Decl::ExportStarAs(statement) => match hir[statement].kind {
                StmtKind::ExportStar { spec, mode, .. } => Some((spec, mode)),
                _ => None,
            },
            _ => None,
        })?;
        files.module_of_specifier_as(file, spec, files.mode_of_import(file, mode))
    }

    /// `resolveESModuleSymbol` for `alias`, which names `module`, where the result is a symbol
    /// that `cloneTypeAsModuleType` has created. `None`: the tables have the target.
    fn resolve_es_module_symbol(&mut self, alias: Sym, module: Sym) -> Option<AliasTarget> {
        let files = self.files();
        // No symbol is created for the copy of a target that has none itself: `export = a`, where
        // `a` resolves to a property.
        if let Some(ty) = self.type_of_namespace_import(alias) {
            return Some(match files.module_clone(alias) {
                Some(clone) => AliasTarget::Symbol(clone),
                None => AliasTarget::Property(TypeId::NEVER, files.symbol(alias).name, ty),
            });
        }
        // For another `import * as ns`, through which the `export =` of `module` resolves.
        let symbol = self.resolve_external_module_symbol(module).symbol()?;
        let target = files.target_of_module_clone(symbol);
        target.map(|_| AliasTarget::Symbol(symbol))
    }

    /// `resolveESModuleSymbol`: the type of the symbol `cloneTypeAsModuleType` creates for the
    /// `import * as ns` that declares `sym`. It has no signatures, and a `default` where one is
    /// synthesized. `None`: `sym` is declared differently, or aliases the module, or its `export =`
    /// target, itself.
    fn type_of_namespace_import(&mut self, sym: Sym) -> Option<TypeId> {
        let import = self
            .files()
            .symbol(sym)
            .decls
            .iter()
            .find_map(|d| match *d {
                Decl::ImportNamespace(i) => Some(i),
                _ => None,
            })?;
        let file = sym.file;
        let import = &self.hir(file)[import];
        // `IsImportDeclaration(referenceParent)`: the `JSImportDeclaration` of an `@import` tag is none.
        if self.hir(file).is_in_jsdoc(import.namespace_pos) {
            return None;
        }
        let mode = self.files().mode_of_import(file, import.mode);
        let module = self
            .files()
            .module_of_specifier_as(file, import.spec, mode)?;
        let symbol = self.resolve_external_module_symbol(module);
        let ty = self.type_of_alias_target(symbol);
        let files = self.files();
        // A property has no symbol: the `export =` that resolves to it stands for it.
        let value = symbol
            .symbol()
            .unwrap_or_else(|| files.module_value(module));
        // Under a Node module mode, an ECMAScript module imports a file.
        let is_file_to_node = files
            .symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && files.options.module.is_node()
            && files.module(file).is_esm;
        // `getTypeWithSyntheticDefaultOnly`, `isOnlyImportableAsDefault`: in that case a JSON file
        // has only a default export.
        if is_file_to_node && files.is_json_module(module.file) {
            return Some(self.intern(TypeData::Anon {
                origin: Origin::Namespace {
                    module: value,
                    with_default: true,
                    is_default_only: true,
                    originating_import: sym,
                },
                mapper: MapperId::IDENTITY,
            }));
        }
        // `exportModuleDotExportsSymbol`, which `alias_target` gives.
        if files.is_commonjs_import_of_esm_file(file, module)
            && files.module_exports_export(value).is_some()
        {
            return None;
        }
        // `hasSignatures(typ) || getPropertyOfTypeEx(typ, "default", ..) != nil || isEsmCjsRef`
        if self.signatures(ty, false).is_empty()
            && self.signatures(ty, true).is_empty()
            && self
                .get_property_of_type_ex(ty, known::default, true)
                .is_none()
            && !files.is_commonjs_to_node(file, module)
        {
            return None;
        }
        let usage = files.emit_syntax_of_import(file);
        let with_default = self.has_synthetic_default_import_type(ty, usage, module);
        Some(self.intern(TypeData::Anon {
            origin: Origin::Namespace {
                module: value,
                with_default,
                is_default_only: false,
                originating_import: sym,
            },
            mapper: MapperId::IDENTITY,
        }))
    }

    /// `hasSyntheticDefault` of `getTypeWithSyntheticDefaultImportType`. The result is cached under
    /// the id of `ty`, the type of `module`, alone, although it depends on `usage`: the first use
    /// decides for all.
    pub(super) fn has_synthetic_default_import_type(
        &mut self,
        ty: TypeId,
        usage: ResolutionMode,
        module: Sym,
    ) -> bool {
        if let Some(&known) = self.synthetic_default_import_types.get(&ty) {
            return known;
        }
        let before = self.non_cacheable_mark();
        let has_synthetic_default = self.can_have_synthetic_default(usage, module);
        if before == self.non_cacheable_mark() {
            self.synthetic_default_import_types
                .insert(ty, has_synthetic_default);
        }
        has_synthetic_default
    }

    /// `canHaveSyntheticDefault`. `resolveExportByName` of a module with `export =` looks up a
    /// property of the type of the value.
    pub(super) fn can_have_synthetic_default(
        &mut self,
        usage: impl crate::program::Usage,
        module: Sym,
    ) -> bool {
        let files = self.files();
        if files.export(module, known::export_equals).is_none() {
            return files.synthetic_default(usage, module).is_some();
        }
        let resolve_export_by_name = &mut |name| {
            let (_, prop, _) = self.resolve_export_by_name(module, name)?;
            Some(
                matches!(prop.source, PropSource::Symbol(symbol) if files.has_syntactic_default(symbol)),
            )
        };
        files
            .synthetic_default_with(usage, module, resolve_export_by_name)
            .is_some()
    }

    /// `resolveExportByName` of `module`, which has `export =`: the property `name` of the type of
    /// the exported value, after that type.
    pub(super) fn resolve_export_by_name(
        &mut self,
        module: Sym,
        name: Atom,
    ) -> Option<(TypeId, &'p Prop<'p>, MapperId)> {
        let export_value = self.files().export(module, known::export_equals)?;
        let ty = self.type_of_symbol(export_value);
        if self.is_any(ty) {
            return None;
        }
        let (prop, mapper) = self.get_property_of_type_ex(ty, name, true)?;
        Some((ty, prop, mapper))
    }

    /// The module that `getTargetOfImportClause` passes to `getTargetOfModuleDefault` for `alias`,
    /// or `getTargetOfImportSpecifier` or `getTargetOfExportSpecifier` for the name `default`.
    /// Only one with an `export =` whose properties the tables do not have.
    fn module_of_default_import(&self, alias: Sym) -> Option<Sym> {
        let (file, files) = (alias.file, self.files());
        let hir = self.hir(file);
        let mut declarations = files.symbol(alias).decls.iter();
        let (spec, mode) = declarations.find_map(|&decl| match decl {
            Decl::ImportDefault(import) => {
                let mode = files.mode_of_import(file, hir[import].mode);
                Some((hir[import].spec, mode))
            }
            Decl::ImportSpec(_) | Decl::ExportSpec(_) => {
                let (spec, mode, name) = files.external_module_member_of(file, decl)?;
                (name == known::default).then_some((spec, mode))
            }
            _ => None,
        })?;
        let module = files.module_of_specifier_as(file, spec, mode)?;
        files.export(module, known::export_equals)?;
        let only_the_type_tells = SymFlags::VARIABLE | SymFlags::PROPERTY | SymFlags::ALIAS;
        let value = files.module_value(module);
        (files.flags(value).intersects(only_the_type_tells)).then_some(module)
    }

    /// `getTargetOfModuleDefault`, without its errors, for the last of the aliases `resolving`
    /// (`enter_alias_targets`). `None`: the tables have its target (`module_of_default_import`).
    fn target_of_module_default(&mut self, resolving: &[Sym]) -> Option<AliasTarget> {
        let &alias = resolving.last()?;
        let module = self.module_of_default_import(alias)?;
        let (file, files) = (alias.file, self.files());
        if !self.enter_alias_targets(resolving) {
            return Some(AliasTarget::Unknown);
        }
        // `exportModuleDotExportsSymbol`, or else `exportDefaultSymbol`
        let mut export_symbol = match files.module_exports_name() {
            Some(name) if files.is_commonjs_import_of_esm_file(file, module) => {
                self.resolve_export_by_name(module, name)
            }
            _ => None,
        };
        let mut has_synthetic_default_or_default_only = false;
        if export_symbol.is_none() {
            export_symbol = self.resolve_export_by_name(module, known::default);
            let has_default_only = files.is_only_importable_as_default(file, module);
            let has_synthetic_default = self.can_have_synthetic_default(file, module);
            has_synthetic_default_or_default_only = has_synthetic_default || has_default_only;
        }
        if !self.leave_alias_targets(resolving) {
            return Some(AliasTarget::Unknown);
        }
        // "a synthetic default overrides a "real" .default member if `__esModule` is not present"
        if has_synthetic_default_or_default_only {
            let export_equals = files.export(module, known::export_equals);
            return export_equals.map(AliasTarget::Symbol);
        }
        // `resolveAlias` finds the property. Its type is for `getTypeOfAlias`.
        Some(match export_symbol {
            Some((object, prop, mapper)) => {
                AliasTarget::Property(object, prop.name, self.type_of_prop(prop, mapper))
            }
            None => AliasTarget::Unknown,
        })
    }

    /// `getTypeOfFuncClassEnumModuleWorker` for a class: its static side, in terms of the outer
    /// type parameters of the class (`getObjectTypeInstantiation`). The constructor type of a class
    /// that extends a value whose type is a type variable also includes that type variable.
    pub(super) fn type_of_class_value(&mut self, sym: Sym) -> TypeId {
        let class = declarations_of(self.files(), sym).find_map(|(file, decl)| match decl {
            Decl::Class(c) => Some((file, c)),
            _ => None,
        });
        let mut mapper = MapperId::IDENTITY;
        if let Some((file, c)) = class {
            let scope = self.bound(file).class_scope[c.idx()];
            if scope.is_some() {
                let around = self.bound(file).scopes[scope.idx()].parent;
                mapper = self.identity_mapper(file, around);
            }
        }
        let statics = self.intern(TypeData::Anon {
            origin: Origin::ClassStatic(sym),
            mapper,
        });
        match self.base_type_variable_of_class(sym) {
            Some(variable) => self.intersection(&[statics, variable]),
            None => statics,
        }
    }

    /// `getBaseTypeVariableOfClass`
    pub(super) fn base_type_variable_of_class(&mut self, class: Sym) -> Option<TypeId> {
        let base = self.base_constructor_type_of_class(class);
        match self.data(base) {
            TypeData::Intersection(parts) => {
                parts.iter().copied().find(|&p| self.is_type_variable(p))
            }
            _ => self.is_type_variable(base).then_some(base),
        }
    }

    /// `symbolFromVariable` of `getExternalModuleMember`: `import { a } from "m"`, `export { a }
    /// from "m"` and `const { a } = require("m")` name a property of the value when `m` has `export
    /// = value`. Returns the type of the value, `a`, and the type of the property.
    pub(super) fn symbol_from_variable(&mut self, sym: Sym) -> Option<(TypeId, Atom, TypeId)> {
        let (module, name) = self.imported_from_export_equals(sym)?;
        if !self.enter_alias_target(sym) {
            return None;
        }
        let value = self.resolve_external_module_symbol(module);
        let ty = self.type_of_alias_target(value);
        let property = match self.is_any(ty) {
            true => None,
            false => self.get_property_of_type_ex(ty, name, true),
        };
        if !self.leave_alias_target(sym) {
            return None;
        }
        // `resolveAlias` finds the property. Its type is for `getTypeOfAlias`.
        let (prop, mapper) = property?;
        Some((ty, name, self.type_of_prop(prop, mapper)))
    }

    /// `symbolFromModule` of `getExternalModuleMember` where the module exports no `default`, for
    /// the last of the aliases `resolving` (`enter_alias_targets`). Only a binding element comes
    /// there with that name: `const { default: d } = require("m")`.
    fn synthetic_default_from_module(&mut self, resolving: &[Sym]) -> Option<Sym> {
        let &alias = resolving.last()?;
        let (file, files) = (alias.file, self.files());
        let mut declarations = files.symbol(alias).decls.iter();
        let (spec, mode, name) = declarations.find_map(|&decl| match decl {
            Decl::Require(_) => files.external_module_member_of(file, decl),
            _ => None,
        })?;
        if name != known::default {
            return None;
        }
        let module = files.module_of_specifier_as(file, spec, mode)?;
        if !self.enter_alias_targets(resolving) {
            return None;
        }
        // `getEmitSyntaxForModuleSpecifierExpression` of the argument of `require`.
        let usage = ResolutionMode::Require;
        let has_synthetic_default = files.is_only_importable_as_default(usage, module)
            || self.can_have_synthetic_default(usage, module);
        if !self.leave_alias_targets(resolving) || !has_synthetic_default {
            return None;
        }
        // `resolveExternalModuleSymbol(moduleSymbol, true /*dontResolveAlias*/)`
        let export_equals = files.export(module, known::export_equals);
        Some(export_equals.map_or(module, |it| files.canonical(it)))
    }

    /// Whether the `default` of `ty` is the one `createDefaultPropertyWrapperForModule` makes for
    /// an `import * as ns`.
    fn has_default_property_wrapper(&self, ty: TypeId) -> bool {
        let TypeData::Anon { origin, .. } = self.data(ty) else {
            return false;
        };
        matches!(
            origin,
            Origin::Namespace {
                with_default: true,
                ..
            }
        )
    }

    /// The beginning of `resolveAlias`. `false`: `aliasTarget` is `unknownSymbol` since an earlier
    /// cycle, or `pushTypeResolution` finds one.
    pub(super) fn enter_alias_target(&mut self, alias: Sym) -> bool {
        let circular = &self.p.circular_alias_targets;
        circular.get(&self.task, &alias).is_none() && self.enter(Query::AliasTarget(alias))
    }

    /// The end of `resolveAlias`, after `enter_alias_target(alias)`. `false`: `popTypeResolution`
    /// has found a cycle, and `aliasTarget` is `unknownSymbol`.
    pub(super) fn leave_alias_target(&mut self, alias: Sym) -> bool {
        let _ = self.leave(Query::AliasTarget(alias));
        if !self.left_a_cycle {
            return true;
        }
        let stored = self.cycle_result();
        (self.p.circular_alias_targets).insert(&self.task, alias, (), stored);
        if let Some((file, node)) = self.files().declaration_of_alias_symbol(alias)
            && let Some(at) = self.place_of_alias_declaration(Sym { file, ..alias }, node)
        {
            let diagnostic = self.new_diagnostic(at, 2303, &[Arg::Sym(alias)]);
            self.add_diagnostic_of(Some(Query::AliasTarget(alias)), diagnostic);
        }
        false
    }

    /// `enter_alias_target` for each of `resolving`, where `resolveAlias` of each has come to the
    /// next one through `resolveIndirectionAlias`. `false`: the target of all is `unknownSymbol`,
    /// and none is entered.
    fn enter_alias_targets(&mut self, resolving: &[Sym]) -> bool {
        for (entered, &alias) in resolving.iter().enumerate() {
            if !self.enter_alias_target(alias) {
                self.leave_alias_targets(&resolving[..entered]);
                return false;
            }
        }
        true
    }

    /// `leave_alias_target` for each of `resolving`, the last first. `false`: for one of them.
    fn leave_alias_targets(&mut self, resolving: &[Sym]) -> bool {
        let mut is_resolved = true;
        for &alias in resolving.iter().rev() {
            is_resolved &= self.leave_alias_target(alias);
        }
        is_resolved
    }

    /// `m` and the name `a`, for `symbol_from_variable`.
    fn imported_from_export_equals(&self, sym: Sym) -> Option<(Sym, Atom)> {
        let file = sym.file;
        let files = self.files();
        for &decl in &files.symbol(sym).decls {
            let Some((spec, mode, name)) = files.external_module_member_of(file, decl) else {
                continue;
            };
            // `{ default as d }` is the default import by another spelling, but not in a binding pattern.
            if name == known::default && !matches!(decl, Decl::Require(_)) {
                continue;
            }
            let Some(module) = files.module_of_specifier_as(file, spec, mode) else {
                continue;
            };
            if files.module_value(module) == module {
                continue;
            }
            return Some((module, name));
        }
        None
    }

    /// The declared type of a mutable location initialized with a value of type `ty`.
    pub fn widened(&mut self, ty: TypeId) -> TypeId {
        let ty = self.widen_literal(ty);
        self.get_widened_type(ty)
    }

    /// `widenTypeForVariableLikeDeclaration`: the type of a named declaration, given the type it is
    /// inferred from. A `unique symbol` belongs to the declaration it was created for, which does
    /// not reach this function: for any other it is a `symbol`. `name`: the declaration it is the
    /// type of. `None`: `reportErrors` is false.
    pub(super) fn widened_for_declaration(
        &mut self,
        ty: TypeId,
        name: Option<(FileId, PatId)>,
    ) -> TypeId {
        let ty = if matches!(self.data(ty), TypeData::UniqueSymbol { .. }) {
            TypeId::SYMBOL
        } else {
            ty
        };
        let widened = self.get_widened_type(ty);
        // `getTypeOfVariableOrParameterOrPropertyWorker` goes by `symbol.ValueDeclaration`.
        if let Some((file, pat)) = name
            && self.contains_widening_type(ty)
            && self.value_declaration_of_variable_name(file, pat) == (file, pat)
            && self.report_errors_from_widening(ty)
        {
            self.report_implicit_any_of_name(file, pat, widened);
        }
        widened
    }

    /// `t.objectFlags&ObjectFlagsContainsWideningType != 0`
    #[inline]
    pub(super) fn contains_widening_type(&self, ty: TypeId) -> bool {
        (self.types().object_flags(ty)).contains(ObjectFlags::CONTAINS_WIDENING_TYPE)
    }

    /// `reportErrorsFromWidening`. Returns whether `reportImplicitAny` remains to be called, which
    /// is left to the caller that knows the declaration.
    pub(super) fn report_errors_from_widening(&mut self, ty: TypeId) -> bool {
        self.p.files.options.no_implicit_any
            && self.contains_widening_type(ty)
            && !self.report_widening_errors_in_type(ty)
    }

    /// `reportWideningErrorsInType`: 7018
    fn report_widening_errors_in_type(&mut self, ty: TypeId) -> bool {
        if !self.contains_widening_type(ty) {
            return false;
        }
        let mut error_reported = false;
        match self.data(ty) {
            TypeData::Union(members) => {
                if members.iter().any(|&m| self.is_empty_object_type(m)) {
                    return true;
                }
                for &m in members.iter() {
                    error_reported = error_reported || self.report_widening_errors_in_type(m);
                }
            }
            TypeData::Tuple { .. } | TypeData::Ref { .. } if self.is_array_or_tuple(ty) => {
                for &argument in self.type_arguments(ty) {
                    error_reported =
                        error_reported || self.report_widening_errors_in_type(argument);
                }
            }
            _ if self.is_object_literal_type(ty) => {
                let Some(members) = self.members(ty) else {
                    return false;
                };
                let literal = self.symbol_declaration_of_object_type(ty);
                for prop in &members.shape().props {
                    let of_prop = self.type_of_prop(prop, members.mapper);
                    if !self.contains_widening_type(of_prop) {
                        continue;
                    }
                    error_reported = self.report_widening_errors_in_type(of_prop);
                    if error_reported {
                        continue;
                    }
                    // "we need to account for property types coming from object literal type normalization in unions"
                    let written = Self::declared_properties(&[prop], self.arena)
                        .iter()
                        .find_map(|declared| {
                            let PropSource::Literal(file, p) = declared.source else {
                                return None;
                            };
                            let owner = self.bound(file).prop_owner[p.idx()];
                            (owner.is_some()
                                && literal.is_some_and(|it| {
                                    (it.0, it.1) == (file, self.hir(file)[owner].pos)
                                }))
                            .then_some((file, p))
                        });
                    if let Some((file, p)) = written {
                        let start = self.hir(file)[p].pos;
                        let name = self.declaration_name_at(file, start);
                        let widened = self.get_widened_type(of_prop);
                        self.error_at(
                            (file, start, self.end_of_prop(file, p)),
                            7018,
                            &[Arg::Bytes(&name), Arg::Type(widened)],
                        );
                        error_reported = true;
                    }
                }
            }
            _ => {}
        }
        error_reported
    }

    /// `reportErrorsFromWidening` for the yield, return or next type of the function `func`.
    fn report_errors_from_widening_of_function(
        &mut self,
        file: FileId,
        func: FnId,
        ty: TypeId,
        kind: WideningKind,
    ) {
        if !self.p.files.options.no_implicit_any || !self.contains_widening_type(ty) {
            return;
        }
        let f = &self.hir(file)[func];
        // `shouldReportErrorsFromWideningWithContextualSignature`
        if let Some(signature) = self.contextual_signature(file, func) {
            let returned = self.sig_return(signature);
            let is_async = f.flags.contains(Flags::ASYNC);
            let is_generator = f.flags.contains(Flags::GENERATOR);
            let iteration = if is_generator {
                self.iteration_types(returned, is_async)
            } else {
                None
            };
            let expected = match kind {
                WideningKind::GeneratorYield => iteration.map(|types| types.yielded),
                WideningKind::GeneratorNext => iteration.map(|types| types.next),
                WideningKind::FunctionReturn if is_generator => {
                    Some(iteration.map_or(returned, |types| types.returned))
                }
                WideningKind::FunctionReturn if is_async => {
                    Some(self.awaited_no_alias(returned).unwrap_or(returned))
                }
                WideningKind::FunctionReturn => Some(returned),
            };
            if !expected.is_some_and(|expected| self.is_generic(expected)) {
                return;
            }
        }
        if !self.report_errors_from_widening(ty) || self.hir(file).is_js && !self.is_check_js(file)
        {
            return;
        }
        // `reportImplicitAny`
        let at = self.place_of_signature_declaration(file, func);
        let widened = self.get_widened_type(ty);
        let is_yield = matches!(kind, WideningKind::GeneratorYield);
        if f.name.is_some() || matches!(f.kind, FnKind::Method | FnKind::Getter) {
            let name = self.declaration_name_at(file, at.1);
            let code = if is_yield { 7055 } else { 7010 };
            self.error_at(at, code, &[Arg::Bytes(&name), Arg::Type(widened)]);
        } else {
            let code = if is_yield { 7025 } else { 7011 };
            self.error_at(at, code, &[Arg::Type(widened)]);
        }
    }

    /// `declarationBelongsToPrivateAmbientMember` for the variable, the parameter or the binding
    /// element whose name is `pat`.
    pub(super) fn declaration_belongs_to_private_ambient_member(
        &self,
        file: FileId,
        pat: PatId,
    ) -> bool {
        let bound = self.bound(file);
        match root_declaration(bound, pat) {
            PatParent::Param(root) => {
                self.is_private_within_ambient(file, bound.param_fn[root.idx()])
            }
            _ => false,
        }
    }

    /// `reportImplicitAny` for the variable, the parameter or the binding element whose name is
    /// `pat` and whose type resolves to `ty`: 7005, 7006 7019 7051, 7031.
    pub(super) fn report_implicit_any_of_name(&mut self, file: FileId, pat: PatId, ty: TypeId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.p.files.options.no_implicit_any || hir.is_js && !self.is_check_js(file) {
            return;
        }
        let start = hir[pat].pos;
        let is_missing = matches!(
            hir[pat].kind,
            PatKind::Missing | PatKind::Ident(known::empty)
        );
        let (name_end, name) = match hir[pat].kind {
            _ if is_missing => (start, Arg::Bytes(b"(Missing)")),
            // `DeclarationNameToString`: the name as written. The text of the default library is
            // not retained.
            PatKind::Ident(name) => {
                let end = self.end_of_name_at(file, start);
                match hir.text.get(start as usize..end as usize) {
                    Some(text) => (end, Arg::Bytes(text)),
                    None => (end, Arg::Atom(name)),
                }
            }
            _ => {
                let end = self.end_of_pat(file, pat);
                (end, Arg::Bytes(&hir.text[start as usize..end as usize]))
            }
        };
        let PatParent::Param(p) = bound.pat_parent[pat.idx()] else {
            let is_element = matches!(
                bound.pat_parent[pat.idx()],
                PatParent::Prop(..) | PatParent::Elem(..)
            );
            let code = if is_element { 7031 } else { 7005 };
            self.error_at((file, start, name_end), code, &[name, Arg::Type(ty)]);
            return;
        };
        // A missing parameter has an empty span.
        let node = (file, hir[p].pos, self.end_of_param(file, p).max(hir[p].pos));
        let (func, is_rest) = (bound.param_fn[p.idx()], hir[p].flags.contains(Flags::REST));
        let is_signature = matches!(hir[func].kind, FnKind::CallSignature | FnKind::FunctionType)
            || hir[func].kind == FnKind::Method
                && matches!(bound.fns[func.idx()].owner, FnOwner::Member(m) if !matches!(bound.member_owner[m.idx()], crate::bind::MemberOwner::Class(_)));
        if let PatKind::Ident(written) = hir[pat].kind
            && is_signature
            && self.is_name_of_a_type(file, func, written)
        {
            // A leading `this` parameter is counted, and is not among `params`.
            let position = p.0 - hir[func].params.start + hir[func].this_ty(hir).is_some() as u32;
            let atoms = &self.atoms();
            let new_name = [b"arg", atoms.bytes(self.number_name(position as f64))].concat();
            let array_name = match name {
                Arg::Bytes(text) => [text, b"[]"].concat(),
                _ => [atoms.bytes(written), b"[]"].concat(),
            };
            let type_name = if is_rest && !is_missing {
                Arg::Bytes(&array_name)
            } else {
                name
            };
            self.error_at(node, 7051, &[Arg::Bytes(&new_name), type_name]);
            return;
        }
        let code = if is_rest { 7019 } else { 7006 };
        self.error_at(node, code, &[name, Arg::Type(ty)]);
    }

    /// `isObjectLiteralType`: whether `ty` is the type of an object literal expression, fresh or
    /// not, as opposed to the type of a declaration initialized with one. The type implied by a
    /// binding pattern is marked too, but no expression has that type
    /// (`getTypeFromObjectBindingPattern`).
    #[inline]
    pub fn is_object_literal_type(&self, ty: TypeId) -> bool {
        super::relate::is_object_literal_kind(self.data(ty))
    }

    /// `isObjectLiteralType(t) && t.objectFlags&ObjectFlagsFreshLiteral != 0`
    #[inline]
    pub fn is_fresh_object_literal_type(&self, ty: TypeId) -> bool {
        super::relate::is_fresh_object_literal_kind(self.data(ty))
    }

    /// An object literal without spreads: it has exactly the declared properties.
    pub fn is_closed_object_literal_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                ..
            } => true,
            TypeData::Synth(shape) => matches!(
                shape.literal,
                Literalness::Literal | Literalness::JsxAttributes
            ),
            _ => false,
        }
    }

    /// `t.ObjectFlags() & ObjectFlagsRequiresWidening`
    pub(super) fn requires_widening(&mut self, ty: TypeId) -> bool {
        self.types()
            .object_flags(ty)
            .contains(ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL)
            || self.get_widened_type(ty) != ty
    }

    /// `getWidenedType`
    #[inline]
    pub fn get_widened_type(&mut self, ty: TypeId) -> TypeId {
        if self.may_require_widening(ty) {
            self.get_widened_type_with_context(ty, None)
        } else {
            ty
        }
    }

    /// `t.objectFlags&ObjectFlagsRequiresWidening != 0`
    #[inline]
    fn may_require_widening(&self, ty: TypeId) -> bool {
        (self.types().object_flags(ty)).intersects(ObjectFlags::REQUIRES_WIDENING)
    }

    /// `getWidenedTypeWithContext`. A type that widening leaves entirely unchanged is returned as
    /// is.
    fn get_widened_type_with_context(&mut self, ty: TypeId, context: Option<usize>) -> TypeId {
        if !self.may_require_widening(ty) {
            return ty;
        }
        match self.data(ty) {
            TypeData::Intrinsic(_) => return TypeId::ANY,
            // Without a context it is interned, which acts as a cache.
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                ..
            } => return self.get_widened_type_of_object_literal(ty, context),
            // The type implied by a pattern is widened like a literal, into a type that
            // `patternForType` does not know.
            TypeData::Synth(shape)
                if shape.literal.is_of_expression()
                    || matches!(
                        shape.literal,
                        Literalness::Pattern | Literalness::PatternWithComputedNames
                    ) =>
            {
                return self.get_widened_type_of_object_literal(ty, context);
            }
            _ => {}
        }
        if context.is_none()
            && let Some(&cached) = self.widened_types.get(&ty)
        {
            return cached;
        }
        let before = self.non_cacheable_mark();
        let result = match self.data(ty) {
            TypeData::Union(types) => {
                let union_context = context.unwrap_or_else(|| {
                    self.new_widening_context(None, Atom::NONE, Some(Rc::from(&types[..])))
                });
                let widened_types: SmallVec<[TypeId; 8]> = types
                    .iter()
                    .map(|&t| {
                        if self.is_nullish(t) {
                            t
                        } else {
                            self.get_widened_type_with_context(t, Some(union_context))
                        }
                    })
                    .collect();
                if context.is_none() {
                    self.widening_contexts.truncate(union_context);
                }
                if widened_types[..] == types[..] {
                    ty
                } else if widened_types.iter().any(|&t| self.is_empty_object_type(t)) {
                    self.union_reduced(&widened_types)
                } else {
                    self.union(&widened_types)
                }
            }
            TypeData::Intersection(types) => match self.get_widened_types(types) {
                Some(widened) => self.intersection(&widened),
                None => ty,
            },
            TypeData::Tuple {
                elems: TypeArguments::Given(elems),
                flags,
                readonly,
            } => match self.get_widened_types(elems) {
                Some(widened) => self.tuple(&widened, flags, *readonly),
                // `createTypeReference` does not return the clone of `createArrayLiteralType`.
                None if self.types().is_array_literal(ty) => self.intern_key(TypeKey::Tuple {
                    elems,
                    flags,
                    readonly: *readonly,
                }),
                None => ty,
            },
            TypeData::Ref {
                target,
                args: TypeArguments::Given(args),
            } if self.is_array(ty) => match self.get_widened_types(args) {
                Some(widened) => self.intern_key(TypeKey::Ref {
                    target: *target,
                    args: &widened,
                }),
                None if self.types().is_array_literal(ty) => self.intern_key(TypeKey::Ref {
                    target: *target,
                    args,
                }),
                None => ty,
            },
            _ => return ty,
        };
        if context.is_none() && before == self.non_cacheable_mark() {
            self.widened_types.insert(ty, result);
        }
        result
    }

    /// `core.SameMap(types, c.getWidenedType)`. `None`: the same.
    fn get_widened_types(&mut self, types: &[TypeId]) -> Option<SmallVec<[TypeId; 8]>> {
        let widened: SmallVec<[TypeId; 8]> =
            types.iter().map(|&t| self.get_widened_type(t)).collect();
        (widened[..] != *types).then_some(widened)
    }

    fn new_widening_context(
        &mut self,
        parent: Option<usize>,
        property_name: Atom,
        siblings: Option<Rc<[TypeId]>>,
    ) -> usize {
        self.widening_contexts.push(WideningContext {
            parent,
            property_name,
            siblings,
            resolved_properties: None,
            child_contexts: FxHashMap::default(),
            widened_types: FxHashMap::default(),
        });
        self.widening_contexts.len() - 1
    }

    /// `undefinedWideningType`
    #[inline]
    pub(super) fn undefined_widening(&self) -> TypeId {
        if self.p.files.options.strict_null_checks {
            TypeId::UNDEFINED
        } else {
            TypeId::UNDEFINED_WIDENING
        }
    }

    /// `nullWideningType`
    #[inline]
    pub(super) fn null_widening(&self) -> TypeId {
        if self.p.files.options.strict_null_checks {
            TypeId::NULL
        } else {
            TypeId::NULL_WIDENING
        }
    }

    /// `getUndefinedProperty`. It is created once per name, from the first property it is requested
    /// for, whose declarations it keeps.
    fn get_undefined_property(&mut self, prop: &Prop) -> Prop<'s> {
        if let Some(cached) = self.undefined_properties.get(&prop.name) {
            return cached.clone_in(self.arena);
        }
        // `undefinedOrMissingType`, which is not widened again wherever it is copied to.
        let missing = if self.p.files.options.exact_optional_property_types {
            TypeId::MISSING
        } else {
            TypeId::UNDEFINED
        };
        let result = Prop {
            name: prop.name,
            // `createSymbolWithType`
            flags: PropFlags::OPTIONAL | (prop.flags & PropFlags::READONLY),
            source: Self::copy_of(missing, &[prop], true, self.arena),
            mapper: MapperId::IDENTITY,
        };
        self.undefined_properties
            .insert(prop.name, result.clone_in(self.arena));
        result
    }

    /// `getWidenedTypeOfObjectLiteral`
    fn get_widened_type_of_object_literal(&mut self, ty: TypeId, context: Option<usize>) -> TypeId {
        if let Some(context) = context
            && let Some(&cached) = self.widening_contexts[context].widened_types.get(&ty)
        {
            return cached;
        }
        // The own properties are widened before `getPropertiesOfContext` resolves those of the
        // siblings.
        if let Some(context) = context
            && self.widening_contexts[context].siblings.is_none()
            && let Some(members) = self.members(ty)
        {
            let mapper = match self.data(ty) {
                TypeData::Anon { mapper, .. } => *mapper,
                _ => members.mapper,
            };
            for prop in &members.shape().props {
                if !prop
                    .flags
                    .intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
                {
                    self.get_widened_type_of_property(prop, mapper, context);
                }
            }
        }
        // Without a sibling literal, no nested widening context has anything to add.
        let context = context.filter(|&context| {
            let siblings = self.get_siblings_of_context(context);
            siblings
                .iter()
                .any(|&t| t != ty && self.is_object_literal_type(t))
        });
        let Some(context) = context else {
            if let Some(&cached) = self.widened_types.get(&ty) {
                return cached;
            }
            let before = self.non_cacheable_mark();
            self.resolve_spread_symbols_of_widened_literal(ty);
            // Each property is widened lazily.
            let widened = match self.data(ty) {
                TypeData::Anon {
                    origin:
                        Origin::ObjectLiteral(file, e, is_js_literal, of_declaration, object_flags, _),
                    mapper,
                } => self.intern(TypeData::Anon {
                    origin: Origin::WidenedLiteral(
                        *file,
                        *e,
                        *is_js_literal,
                        *of_declaration,
                        object_flags.contains(ObjectFlags::NON_INFERRABLE_TYPE),
                    ),
                    mapper: *mapper,
                }),
                TypeData::Synth(shape) => {
                    let mut shape = shape.clone_in(self.arena);
                    (shape.literal, shape.is_regular) = match shape.literal {
                        // `ObjectFlagsNonInferrableType` stays.
                        Literalness::Partial => (Literalness::Partial, true),
                        _ => (Literalness::No, false),
                    };
                    shape.contains_widening_type = false;
                    for prop in &mut shape.props {
                        prop.flags.remove(PropFlags::REGULAR);
                        if !prop
                            .flags
                            .intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
                        {
                            prop.flags |= PropFlags::WIDEN;
                        }
                    }
                    for info in &mut shape.index {
                        info.value = self.get_widened_type(info.value);
                    }
                    self.intern(TypeData::Synth(shape))
                }
                _ => ty,
            };
            if before == self.non_cacheable_mark() {
                self.widened_types.insert(ty, widened);
            }
            return widened;
        };
        let Some(members) = self.members(ty) else {
            return ty;
        };
        // `Types::object_flags` finds the type variables of a property that stays unresolved in its
        // mapper, and `members.mapper` leaves out one that maps every type parameter to itself.
        let mapper = match self.data(ty) {
            TypeData::Anon { mapper, .. } => *mapper,
            _ => members.mapper,
        };
        let mut shape = Shape::new_in(self.arena);
        for prop in &members.shape().props {
            let widened = self.get_widened_property(prop, mapper, context);
            shape.props.push(widened);
        }
        for &prop in self.get_properties_of_context(context).iter() {
            if !shape.props.iter().any(|p| p.name == prop.name) {
                let undefined = self.get_undefined_property(prop);
                shape.props.push(undefined);
            }
        }
        self.get_named_members(&mut shape.props, |_| true, &[]);
        for info in &members.shape().index {
            let value = self.instantiate(info.value, members.mapper);
            let value = self.get_widened_type(value);
            shape.index.push(IndexInfo { value, ..*info });
        }
        shape.symbol_declared_at = self.symbol_declaration_of_object_type(ty);
        shape.mapper = self.mapper_of_object_literal_type(ty);
        if let TypeData::Synth(widened) = self.data(ty) {
            (shape.spread_of, shape.spread_rank) = (widened.spread_of, widened.spread_rank);
            shape.has_no_instantiable_symbol = widened.has_no_instantiable_symbol;
            if widened.literal == Literalness::Partial {
                (shape.literal, shape.is_regular) = (Literalness::Partial, true);
            }
        }
        shape.is_js_literal = self.has_js_literal_flag(ty);
        let result = self.synth(shape);
        if self.widening_contexts[context].parent.is_some() {
            self.widening_contexts[context]
                .widened_types
                .insert(ty, result);
        }
        result
    }

    /// `getWidenedProperty`
    fn get_widened_property(&mut self, prop: &Prop, mapper: MapperId, context: usize) -> Prop<'s> {
        // `prop.Flags&SymbolFlagsProperty == 0`: the symbol stays, and its type is not resolved.
        if prop
            .flags
            .intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
        {
            return Prop {
                mapper: self.compose(prop.mapper, mapper),
                ..prop.clone_in(self.arena)
            };
        }
        let widened = self.get_widened_type_of_property(prop, mapper, context);
        Prop {
            name: prop.name,
            flags: prop.flags,
            source: Self::copy_of(widened, &[prop], true, self.arena),
            mapper: MapperId::IDENTITY,
        }
    }

    /// The type `getWidenedProperty` gives a `prop` that has `SymbolFlagsProperty`.
    fn get_widened_type_of_property(
        &mut self,
        prop: &Prop,
        mapper: MapperId,
        context: usize,
    ) -> TypeId {
        let original = self.type_of_prop(prop, mapper);
        if self.may_require_widening(original) {
            let prop_context = self.get_child_context(context, prop.name);
            self.get_widened_type_with_context(original, Some(prop_context))
        } else {
            original
        }
    }

    /// `WideningContext.getChildContext`
    fn get_child_context(&mut self, context: usize, property_name: Atom) -> usize {
        if let Some(&cached) = self.widening_contexts[context]
            .child_contexts
            .get(&property_name)
        {
            return cached;
        }
        let result = self.new_widening_context(Some(context), property_name, None);
        self.widening_contexts[context]
            .child_contexts
            .insert(property_name, result);
        result
    }

    /// `getPropertiesOfContext`
    fn get_properties_of_context(&mut self, context: usize) -> Rc<[&'p Prop<'p>]> {
        if let Some(resolved) = &self.widening_contexts[context].resolved_properties {
            return Rc::clone(resolved);
        }
        let mut names: Vec<&'p Prop<'p>> = Vec::new();
        let mut places: FxHashMap<Atom, usize> = FxHashMap::default();
        for &t in self.get_siblings_of_context(context).iter() {
            if !self.is_closed_object_literal_type(t)
                && !matches!(self.data(t), TypeData::Synth(shape) if shape.literal == Literalness::Partial)
            {
                continue;
            }
            let Some(members) = self.members(t) else {
                continue;
            };
            for prop in &members.shape().props {
                let place = *places.entry(prop.name).or_insert(names.len());
                match names.get_mut(place) {
                    Some(set) => *set = prop,
                    None => names.push(prop),
                }
            }
        }
        let resolved: Rc<[&'p Prop<'p>]> = names.into();
        self.widening_contexts[context].resolved_properties = Some(Rc::clone(&resolved));
        resolved
    }

    /// `getSiblingsOfContext`
    fn get_siblings_of_context(&mut self, context: usize) -> Rc<[TypeId]> {
        let WideningContext {
            parent,
            property_name,
            ref siblings,
            ..
        } = self.widening_contexts[context];
        let (None, Some(parent)) = (siblings, parent) else {
            return siblings.clone().unwrap_or_default();
        };
        let mut siblings: Vec<TypeId> = Vec::new();
        for &t in self.get_siblings_of_context(parent).iter() {
            if self.is_object_literal_type(t)
                && let Some((prop, mapper)) = self.prop_ref(t, property_name)
            {
                let of_prop = self.type_of_prop(prop, mapper);
                siblings.extend_from_slice(self.parts(of_prop));
            }
        }
        let siblings: Rc<[TypeId]> = siblings.into();
        self.widening_contexts[context].siblings = Some(Rc::clone(&siblings));
        siblings
    }

    // ───────────────────────────── bindings ─────────────────────────────

    /// The type of the value `pat` binds or destructures.
    #[inline]
    pub fn type_of_pat(&mut self, file: FileId, pat: PatId) -> TypeId {
        if pat.is_none() {
            return TypeId::UNRESOLVED;
        }
        if let Some((known, _)) = self.p.pat_types.get(&self.task, &(file, pat)) {
            return known;
        }
        self.resolve_type_of_pat(file, pat, Query::Pat(file, pat))
    }

    /// `query`: `Query::Pat` or `Query::ParameterSymbol` of `pat`.
    #[inline(never)]
    fn resolve_type_of_pat(&mut self, file: FileId, pat: PatId, query: Query) -> TypeId {
        if self.prepare_query_for_pat(file, pat)
            && let Some((known, _)) = self.p.pat_types.get(&self.task, &(file, pat))
        {
            return known;
        }
        if let Some(raw) = self.provisional(query) {
            return TypeId(raw as u32);
        }
        if !self.enter(query) {
            if !self.found_cycle {
                return TypeId::UNRESOLVED;
            }
            let ty = circularity_error_type(self.type_annotation_of_pat(file, pat));
            if self.cache_circularity_error_type_of_pat(file, pat, ty) {
                // The two queries are one resolution in tsgo.
                let symbol = self.bound(file).pat_symbol[pat.idx()];
                if symbol.is_some() {
                    let sym = self.files().sym(file, symbol);
                    self.note_result(Query::Symbol(sym));
                }
            }
            // `reportCircularityError`, as where `popTypeResolution` finds the cycle.
            self.report_circularity_error_of_pat(query, file, pat);
            return ty;
        }
        let ty = self.type_of_pat_uncached(file, pat);
        let left = self.leave(query);
        if self.left_a_cycle {
            let ty = circularity_error_type(self.type_annotation_of_pat(file, pat));
            // `isParameterOfContextSensitiveSignature`: `links.resolvedType` stays nil, for
            // `assignParameterType` or `assignBindingElementTypes`, which is in progress below.
            let mut assigned = self.assigned_parameters.iter();
            if !assigned.any(|&at| self.stack.get(at) == Some(&query)) {
                let stored = self.cycle_result();
                // Overwrites the value of an inner evaluation above a `resolution_start` barrier,
                // if one was stored.
                self.p
                    .pat_types
                    .rewrite(&self.task, (file, pat), (ty, true), stored);
            }
            if self.is_resolution(query) {
                self.report_circularity_error_of_pat(query, file, pat);
            }
            return ty;
        }
        // `getTypeOfVariableOrParameterOrProperty`: `links.resolvedType` is assigned only if it is nil, and the caller gets `t`.
        match left {
            Ok(stored) => {
                self.p
                    .pat_types
                    .insert(&self.task, (file, pat), (ty, false), stored);
            }
            Err(open) => self.cache_provisionally(query, u64::from(ty.0), open),
        }
        ty
    }

    /// Diagnostics reported inside a cycle are dropped with the results that depend on it, and
    /// `pat` has received its result (`reportCircularityError`) without being evaluated again. tsgo
    /// continues through the cycle with `any` and reports what it finds, so the walk evaluates it
    /// once more.
    pub(super) fn report_on_circular_pat(&mut self, file: FileId, pat: PatId) {
        // The caller has just requested the type, so the first read is a hit.
        let key = (file, pat);
        let is_circular = (self.p.pat_types.get(&self.task, &key)).is_some_and(|(_, flag)| flag)
            || self.p.circular_initializers.get(&self.task, &key).is_some();
        if is_circular && self.enter(Query::Pat(file, pat)) {
            self.type_of_pat_uncached(file, pat);
            // The frame stores nothing, so its diagnostics do not belong to the entry of `pat_types`.
            self.settle_reported_without_entry();
            let _ = self.leave(Query::Pat(file, pat));
        }
    }

    /// `checkDeclarationInitializer`, `getTypeOfExpression`: `getQuickTypeOfExpression` comes
    /// first. A call or a `new` with a single, non-generic signature has that signature's return
    /// type. Its arguments are not checked, so nothing in them can re-enter this query.
    pub(super) fn type_of_declaration_initializer(&mut self, file: FileId, e: ExprId) -> TypeId {
        // For an assertion no expression is checked at all: `c.currentNode` stays.
        if e.is_some()
            && matches!(self.hir(file)[e].kind, ExprKind::As { .. })
            && let Some(quick) = self.quick_type_of_expr(file, e)
        {
            return quick;
        }
        if e.is_some()
            && matches!(
                self.hir(file)[e].kind,
                ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Await(_)
            )
            && {
                self.instantiation_count = 0;
                self.enter(Query::Expr(file, e))
            }
        {
            // The resolutions of the declaration itself are right below the frame of `e`.
            let to = self.stack.len() - 1;
            let mut below = self.stack[..to].iter();
            let from = below
                .rposition(|&q| !self.is_resolution(q))
                .map_or(0, |i| i + 1);
            self.quick_initializers.push((from, to));
            let quick = self.quick_type_of_expr(file, e);
            self.quick_initializers.pop();
            let _ = self.leave(Query::Expr(file, e));
            if let Some(quick) = quick {
                return quick;
            }
        }
        self.type_of_expr(file, e)
    }

    /// The tail of `getBindingElementTypeFromParentType`: the type bound to `pat`, an element of a
    /// pattern, when `ty` is the type found for it and `default` is its initializer.
    fn with_default(&mut self, file: FileId, pat: PatId, ty: TypeId, default: ExprId) -> TypeId {
        if default.is_none() {
            return ty;
        }
        // The annotated type is used: the default only removes `undefined` from it. Without
        // strictNullChecks the default is not checked.
        let hir = self.hir(file);
        let root = root_declaration(self.bound(file), pat);
        let is_annotated = match root {
            PatParent::Var(d) => hir[d].ty.is_some(),
            PatParent::Param(p) => hir[p].ty.is_some(),
            _ => false,
        };
        if is_annotated && !self.p.files.options.strict_null_checks {
            return ty;
        }
        let default_ty = self.type_of_declaration_initializer(file, default);
        // `checkDeclarationInitializer`: under a parameter a default is padded with the members its
        // own pattern has defaults for.
        let default_ty = if matches!(root, PatParent::Param(_)) {
            self.padded_for_pattern(file, pat, default_ty)
        } else {
            default_ty
        };
        if is_annotated {
            // An `UNRESOLVED` type might be.
            let may_be_missing =
                default_ty == TypeId::UNRESOLVED || self.is_possibly_undefined(default_ty);
            return if may_be_missing {
                ty
            } else {
                self.non_undefined_type(ty)
            };
        }
        if self.is_any(ty) {
            return ty;
        }
        // `widenTypeInferredFromInitializer` of the union of both: a default that is one of the
        // existing literals is not widened.
        let present = self.non_undefined_type(ty);
        let whole = self.union_reduced(&[present, default_ty]);
        let widened = self.get_widened_literal_type_for_initializer(file, pat, whole);
        if let Some(any) = self.implicit_any_of_empty_literal(file, widened) {
            self.report_implicit_any_of_name(file, pat, any);
            return any;
        }
        widened
    }

    /// `isEmptyArrayLiteralType`
    pub(super) fn is_empty_array_literal_type(&mut self, ty: TypeId) -> bool {
        self.array_element(ty)
            .is_some_and(|element| self.is_empty_literal_type(element))
    }

    /// `isEmptyLiteralType`
    fn is_empty_literal_type(&self, ty: TypeId) -> bool {
        if self.p.files.options.strict_null_checks {
            ty == TypeId::IMPLICIT_NEVER
        } else {
            ty == TypeId::UNDEFINED_WIDENING
        }
    }

    /// The end of `widenTypeInferredFromInitializer`, without the report: the type of a declaration
    /// in `file` whose initializer type is `widened`, if the file is JavaScript and `widened` is an
    /// empty literal type or an empty array literal type.
    pub(super) fn implicit_any_of_empty_literal(
        &mut self,
        file: FileId,
        widened: TypeId,
    ) -> Option<TypeId> {
        if !self.hir(file).is_js {
            None
        } else if self.is_empty_literal_type(widened) {
            Some(TypeId::ANY)
        } else if self.is_empty_array_literal_type(widened) {
            Some(self.array_of(TypeId::ANY))
        } else {
            None
        }
    }

    /// `getNonUndefinedType`: `ty` without `undefined`. If the constraint of some generic member
    /// can be `undefined`, every such member is first replaced by its constraint.
    pub(super) fn non_undefined_type(&mut self, ty: TypeId) -> TypeId {
        let mut type_or_constraint = ty;
        if (self.parts(ty).iter()).any(|&m| self.is_generic_type_with_undefined_constraint(m)) {
            type_or_constraint = self.map_type(ty, |c, m| {
                if c.is_instantiable(m) {
                    c.base_constraint_or_type(m)
                } else {
                    m
                }
            });
        }
        self.type_with_ne_undefined(type_or_constraint)
    }

    /// `isGenericTypeWithUndefinedConstraint`
    fn is_generic_type_with_undefined_constraint(&mut self, ty: TypeId) -> bool {
        self.is_instantiable(ty)
            && self.base_constraint_of(ty).is_some_and(|constraint| {
                self.maybe_type_of_kind(constraint, |_, t| t.is_undefined())
            })
    }

    fn type_of_pat_uncached(&mut self, file: FileId, pat: PatId) -> TypeId {
        let hir = self.hir(file);
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::None => TypeId::UNRESOLVED,
            PatParent::Var(d) => self.type_of_var_decl(file, d),
            PatParent::Param(p) => self.type_of_param_uncached(file, p),
            // `getTypeOfAlias`: a name directly in the pattern of `const { a } = require("m")`.
            PatParent::Prop(..) | PatParent::Elem(..)
                if matches!(hir[pat].kind, PatKind::Ident(_))
                    && self.bound(file).required_by(hir, pat).is_some() =>
            {
                let symbol = self.bound(file).pat_symbol[pat.idx()];
                self.type_of_alias(self.files().sym(file, symbol))
            }
            PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => {
                let parent_ty = self.type_for_binding_element_parent(file, pat, parent);
                let ty = self.type_of_binding_element(file, pat, parent_ty, false);
                // A destructured value is not widened; the elements extracted from it are, once
                // bound to a name.
                if !matches!(hir[pat].kind, PatKind::Ident(_)) {
                    return ty;
                }
                // `assignBindingElementTypes` assigns the type as it is.
                let assigned = self.assigned_parameters.last();
                if assigned.is_some_and(|&at| at + 1 == self.stack.len()) {
                    return ty;
                }
                self.widened_for_declaration(ty, Some((file, pat)))
            }
        }
    }

    /// `getTypeForBindingElementParent`: the type the pattern `parent` destructures, for its
    /// element `pat`.
    pub(super) fn type_for_binding_element_parent(
        &mut self,
        file: FileId,
        pat: PatId,
        parent: PatId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_rest = match bound.pat_parent[pat.idx()] {
            PatParent::Prop(_, prop) => hir[prop].is_rest,
            PatParent::Elem(_, elem) => hir[elem].is_rest,
            _ => false,
        };
        // `getTypeForBindingElement`
        let check_mode = if is_rest {
            CheckMode::REST_BINDING_ELEMENT
        } else {
            CheckMode::empty()
        };
        match bound.pat_parent[parent.idx()] {
            // Without the `undefined` that `?` adds. An annotated `undefined` stays.
            PatParent::Param(p)
                if hir[p].ty.is_some() && hir[p].flags.contains(Flags::OPTIONAL) =>
            {
                self.type_from_node(file, hir[p].ty)
            }
            // `links.resolvedType == nil`. The parameters of function expressions and of object
            // literal methods are typed (`assignParameterType`, widened) before their patterns are
            // checked, any other once something asks for the type of its symbol.
            PatParent::Param(p)
                if self.is_resolved_on_request(file, p)
                    && (is_rest
                        || !self.is_parameter_symbol_resolved(file, p)
                        || self.p.files.options.strict_null_checks
                            && hir[p].flags.contains(Flags::OPTIONAL)) =>
            {
                self.type_for_parameter_of_declaration(file, p, check_mode)
            }
            // `links.resolvedType == nil` while `assignParameterType` widens the type of the
            // parameter: `getTypeForVariableLikeDeclaration`, which does not widen. For `...rest`
            // `links.resolvedType` is not asked.
            PatParent::Param(p)
                if hir[p].ty.is_none()
                    && hir[p].default.is_some()
                    && hir[bound.param_fn[p.idx()]].kind != FnKind::Setter
                    && (is_rest
                        || self.stack.contains(&Query::Pat(file, parent))
                        || self.stack.contains(&Query::ParameterSymbol(file, parent)))
                    && {
                        let func = bound.param_fn[p.idx()];
                        let index = (p.0 - hir[func].params.start) as usize;
                        self.contextual_param_type(file, func, index).is_none()
                    } =>
            {
                self.type_from_param_default(file, p, check_mode)
            }
            // `CheckModeRestBindingElement`: for `...rest` the initializer is checked again,
            // without the pattern causing a type parameter to be abandoned.
            PatParent::Var(d) if is_rest && hir[d].ty.is_none() && hir[d].init.is_some() => {
                match self.type_of_reference_for_rest(file, hir[d].init) {
                    Some(ty) => ty,
                    None => self.type_of_pat(file, parent),
                }
            }
            _ => self.type_of_pat(file, parent),
        }
    }

    /// `getTypeForVariableLikeDeclaration(declaration, false /*includeOptionality*/, checkMode)`,
    /// which does not widen, for the parameter `p`: it has no annotation, its name is a pattern, and
    /// its function is a declaration or a member of a class, which has no contextual type.
    fn type_for_parameter_of_declaration(
        &mut self,
        file: FileId,
        p: ParamId,
        check_mode: CheckMode,
    ) -> TypeId {
        let hir = self.hir(file);
        let func = self.bound(file).param_fn[p.idx()];
        if hir[func].kind == FnKind::Setter
            && let Some((of, getter)) = self.sibling_accessor(file, func, FnKind::Getter)
        {
            return self.return_type_of_fn(of, getter);
        }
        let index = (p.0 - hir[func].params.start) as usize;
        if let Some(ty) = self.param_type_of_full_signature(file, func, index) {
            return ty;
        }
        if hir[p].default.is_some() {
            return self.type_from_param_default(file, p, check_mode);
        }
        self.type_from_binding_pattern_of_param(file, func, p)
            .unwrap_or(TypeId::ANY)
    }

    /// `getTypeFromBindingPattern(declaration.Name(), false /*includePatternInType*/, true
    /// /*reportErrors*/)` for the parameter `p` of `func`. `None` for a plain name.
    fn type_from_binding_pattern_of_param(
        &mut self,
        file: FileId,
        func: FnId,
        p: ParamId,
    ) -> Option<TypeId> {
        let report_errors = if self.is_parameter_type_never_requested(file, func, p) {
            ReportErrors::No
        } else {
            ReportErrors::Yes
        };
        let pat = self.hir(file)[p].pat;
        self.implied_by_pattern(file, pat, IncludePatternInType::No, report_errors)
    }

    /// The head of `getBindingElementTypeFromParentType`: the type `pattern` destructures, given
    /// that its declaration has type `ty`. Under strictNullChecks, a parameter of an ambient
    /// declaration is assumed to be present, and a declaration whose initializer cannot be
    /// `undefined` is not `undefined`.
    pub(super) fn type_pattern_takes_apart(
        &mut self,
        file: FileId,
        pattern: PatId,
        ty: TypeId,
    ) -> TypeId {
        if !self.p.files.options.strict_null_checks {
            return ty;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `IsPartOfParameterDeclaration`
        if matches!(root_declaration(bound, pattern), PatParent::Param(_))
            && hir.is_ambient(hir.node(pattern))
        {
            return self.non_nullable(ty);
        }
        let initializer = bound.pat_parent[pattern.idx()].initializer(hir);
        if initializer.is_none() {
            return ty;
        }
        // `getTypeOfInitializer` is called whatever `ty` is: an initializer that reads a name of
        // the pattern is a cycle.
        let actual = self.type_of_declaration_initializer(file, initializer);
        let there = self.type_with_ne_undefined(ty);
        if there == ty {
            return ty;
        }
        if self.can_equal_undefined(actual) {
            return ty;
        }
        there
    }

    /// `getBindingElementTypeFromParentType`: the type bound to `pat`, an element of a pattern,
    /// when the pattern destructures a value of type `parent_ty`.
    pub(super) fn type_of_binding_element(
        &mut self,
        file: FileId,
        pat: PatId,
        parent_ty: TypeId,
        no_tuple_bounds_check: bool,
    ) -> TypeId {
        // Destructuring `any` yields `any`, and nothing else is checked, not even a default.
        if self.is_any(parent_ty) {
            return parent_ty;
        }
        let hir = self.hir(file);
        let parent_ty = match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => {
                self.type_pattern_takes_apart(file, parent, parent_ty)
            }
            _ => parent_ty,
        };
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::None | PatParent::Var(_) | PatParent::Param(_) => TypeId::UNRESOLVED,
            PatParent::Prop(parent, id) => {
                let prop = &hir[id];
                if prop.is_rest {
                    let PatKind::Object(props) = hir[parent].kind else {
                        return TypeId::UNRESOLVED;
                    };
                    let parent_ty = self.reduced(parent_ty);
                    if self.is_rest_of_invalid_type(parent_ty) {
                        self.error_at(self.place_of_token(file, hir[pat].pos), 2700, &[]);
                        return TypeId::ERROR;
                    }
                    // A name that is not numeric omits the property of that name and no other. Any
                    // other name omits by its type.
                    let (mut omitted, mut keys) = (Vec::new(), Vec::new());
                    for p in props.iter() {
                        let PatProp { key, name_kind, .. } = hir[p];
                        if hir[p].is_rest {
                            continue;
                        }
                        match key {
                            PropKey::Name(name) if !self.is_numeric_name(name) => {
                                omitted.push(name)
                            }
                            _ => keys
                                .extend(self.literal_type_from_property_name(file, key, name_kind)),
                        }
                    }
                    let keys = self.union(&keys);
                    // `declaration.Symbol()`
                    let symbol = matches!(hir[pat].kind, PatKind::Ident(_)).then_some((file, pat));
                    let ty = self.rest_of_object(parent_ty, &omitted, keys, symbol);
                    return self.with_default(file, pat, ty, prop.default);
                }
                let mut access_flags = AccessFlags::EXPRESSION_POSITION;
                let allow_missing = no_tuple_bounds_check || prop.default.is_some();
                access_flags.set(AccessFlags::ALLOW_MISSING, allow_missing);
                let Some(index_type) =
                    self.literal_type_from_property_name(file, prop.key, prop.name_kind)
                else {
                    return TypeId::UNRESOLVED;
                };
                let name = AccessNode::PropertyName(file, id);
                let ty = self
                    .indexed_access_of_binding_element(parent_ty, index_type, access_flags, name)
                    .unwrap_or(TypeId::ERROR);
                let ty = self.narrow_destructured(file, pat, ty);
                self.with_default(file, pat, ty, prop.default)
            }
            PatParent::Elem(parent, elem) => {
                let PatKind::Array(elems) = hir[parent].kind else {
                    return TypeId::UNRESOLVED;
                };
                let index = (elem.0 - elems.start) as usize;
                let e = &hir[elem];
                let allow_missing = no_tuple_bounds_check || e.default.is_some();
                let nodes = Some((parent, AccessNode::BindingName(file, pat), allow_missing));
                let ty = self.element_of_destructured(parent_ty, index, e.is_rest, nodes);
                let ty = self.narrow_destructured(file, pat, ty);
                self.with_default(file, pat, ty, e.default)
            }
        }
    }

    /// `isArrayLikeType`
    pub(super) fn is_array_like(&mut self, ty: TypeId) -> bool {
        if self.is_array_or_tuple(ty) {
            return true;
        }
        if ty.is_undefined() || ty.is_null() {
            return false;
        }
        let any_list = self.readonly_array_of(TypeId::ANY);
        self.is_assignable(ty, any_list)
    }

    /// `getBindingElementTypeFromParentType`, for an array pattern: element `index` of the
    /// destructured type; the elements from `index` on if `rest`.
    /// `nodes`: the pattern, the name of the element and `AccessFlagsAllowMissing`, for error
    /// reporting.
    pub(super) fn element_of_destructured(
        &mut self,
        ty: TypeId,
        index: usize,
        rest: bool,
        nodes: Option<(PatId, AccessNode, bool)>,
    ) -> TypeId {
        if self.is_any(ty) {
            return ty;
        }
        // "This call also checks that the parentType is in fact an iterable or array". An array or
        // a tuple is, so the call is skipped.
        if let Some((pattern, AccessNode::BindingName(file, _), _)) = nodes
            && !self.is_array_or_tuple(ty)
        {
            let pattern = (
                file,
                self.hir(file)[pattern].pos,
                self.end_of_pat(file, pattern),
            );
            let usage = IterationUse::Destructuring;
            self.iterated_type_or_element_type(usage, ty, TypeId::UNDEFINED, Some(pattern));
        }
        // `getReducedType`: an intersection that reduces to `never` is `never`, and drops out of a
        // union.
        let ty = self.reduced(ty);
        // `getReducedApparentType`: a type parameter is replaced by its constraint.
        let apparent = if self.is_deferred(ty) {
            let apparent = self.apparent_type(ty);
            self.reduced(apparent)
        } else {
            ty
        };
        // `never` is not iterable, which is an error and yields `any`. Yet it counts as array-like,
        // and `never[0]` is `never`.
        if apparent.is_never() {
            return if rest {
                self.array_of(TypeId::ANY)
            } else {
                TypeId::NEVER
            };
        }
        if rest {
            // A tuple, or a type constrained to one, is sliced (`sliceTupleType`). Anything else
            // gives an array of the iterated type of the whole.
            let constraint = self.map_type(ty, |c, m| {
                if c.is_deferred(m) {
                    c.base_constraint_of(m).unwrap_or(m)
                } else {
                    m
                }
            });
            if self.every_type(constraint, |c, m| c.is_tuple(m)) {
                return self.map_type(constraint, |c, m| match c.data(m) {
                    TypeData::Tuple { flags, .. } => {
                        let elems = c.type_arguments(m);
                        c.slice_tuple(elems, flags, index, 0)
                    }
                    _ => m,
                });
            }
            let element = self.iterated_type_of_destructuring(ty);
            return self.array_of(element);
        }
        // Elements are looked up by index only in an array-like type: `interface RegExpExecArray
        // extends Array<string> { 0: string }`.
        if self.is_array_like(ty) {
            let key = self.number_literal(index as f64, false);
            let (_, name, allow_missing) = nodes.unwrap_or((PatId::NONE, AccessNode::Other, false));
            let mut access_flags = AccessFlags::EXPRESSION_POSITION;
            access_flags.set(AccessFlags::ALLOW_MISSING, allow_missing);
            return self
                .indexed_access_of_binding_element(ty, key, access_flags, name)
                .unwrap_or(TypeId::ERROR);
        }
        // For anything else it is the iterated type of the whole, if the iteration gets that far
        // (`includeUndefinedInIndexSignature`).
        let element = self.iterated_type_of_destructuring(ty);
        if self.p.files.options.no_unchecked_indexed_access {
            self.optional(element)
        } else {
            element
        }
    }

    /// `getBindingElementTypeFromParentType`: whether `...rest` cannot be applied to a `parent_ty`,
    /// which is 2700: it is `unknown`, or not `isValidSpreadType`.
    pub(super) fn is_rest_of_invalid_type(&mut self, parent_ty: TypeId) -> bool {
        let reduced = self.reduced(parent_ty);
        reduced == TypeId::UNKNOWN || !self.is_valid_spread_type(reduced)
    }

    /// `getLiteralTypeFromPropertyName` of the name `key` of a class member or of a property of an
    /// object literal or a binding pattern. `None`: the name is missing.
    pub(super) fn literal_type_from_property_name(
        &mut self,
        file: FileId,
        key: PropKey,
        name_kind: NameKind,
    ) -> Option<TypeId> {
        match key {
            PropKey::Private(_) => Some(TypeId::NEVER),
            // `0`, `[0]`: the text is `String(n)`.
            PropKey::Name(name)
                if matches!(
                    name_kind,
                    NameKind::NumericLiteral | NameKind::ComputedNumber
                ) =>
            {
                let text = std::str::from_utf8(self.atoms().bytes(name)).ok()?;
                Some(self.number_literal(text.parse::<f64>().ok()?, false))
            }
            PropKey::Name(name) => Some(self.string_literal(name, false)),
            PropKey::Computed(e) => {
                let key = self.check_computed_property_name(file, e);
                Some(self.regular(key))
            }
            PropKey::None => None,
        }
    }

    /// `getGlobalTypeAliasSymbol`: the global type alias `name` that has `arity` type parameters.
    /// Any other declaration of that name counts as missing.
    pub(super) fn get_global_type_alias_symbol(
        &mut self,
        name: Atom,
        arity: usize,
        report_errors: bool,
    ) -> Option<Sym> {
        let diagnostic = report_errors.then_some(2318);
        let symbol = self.get_global_symbol(name, SymFlags::TYPE_ALIAS, diagnostic)?;
        if self.files().type_argument_arity(symbol).1 == arity {
            return Some(symbol);
        }
        let declarations = self.files().decls_of(symbol);
        if report_errors
            && let Some(&(file, declaration)) =
                (declarations.iter()).find(|found| matches!(found.1, Decl::Alias(_)))
            && let Some(error_node) = self.error_place_of_declaration(file, declaration)
        {
            let args = [Arg::Atom(name), Arg::Number(arity)];
            let diagnostic = self.new_diagnostic(error_node, 2317, &args);
            let owner = self.stack.last().copied();
            self.add_diagnostic_of(owner, diagnostic);
        }
        None
    }

    /// `getRestType`, the type of `...rest`: `ty` without the properties `omitted` and without
    /// those whose name is in `omitted_keys`, the types of the names that are omitted by type: the
    /// computed ones that are not the name of a single property, and the numeric ones (`never`:
    /// there are none). `symbol`: the name of the binding element that declares the symbol the type
    /// gets.
    pub fn rest_of_object(
        &mut self,
        ty: TypeId,
        omitted: &[Atom],
        omitted_keys: TypeId,
        symbol: Option<(FileId, PatId)>,
    ) -> TypeId {
        let ty = self.filter(ty, |_, m| !m.is_null() && !m.is_undefined());
        if ty.is_never() {
            return TypeId::EMPTY_OBJECT;
        }
        if self.is_union(ty) {
            return self.map_type(ty, |c, m| {
                c.rest_of_object(m, omitted, omitted_keys, symbol)
            });
        }
        // `getPropertiesOfType`: a type parameter has the properties of its constraint.
        let apparent = self.reduced_apparent_type(ty);
        let members = self.members(apparent);
        // Which properties go into the rest, and the names of the others.
        let (mut kept, mut excluded_keys): (Vec<usize>, Vec<TypeId>) = (Vec::new(), Vec::new());
        if let Some(members) = &members {
            for (i, prop) in members.shape().props.iter().enumerate() {
                // `getLiteralTypeFromProperty`: a property that is not public, or is named `#name`,
                // has no key type to be omitted by.
                if prop
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                {
                    continue;
                }
                let Some(key) = self.key_type_of_prop(apparent, prop) else {
                    continue;
                };
                let is_omitted = omitted.contains(&prop.name)
                    || !omitted_keys.is_never() && self.is_assignable(key, omitted_keys);
                if !is_omitted && self.is_spreadable_property(prop) {
                    kept.push(i);
                } else {
                    excluded_keys.push(key);
                }
            }
        }
        // `isGenericObjectType`, `isGenericIndexType`
        let is_generic =
            self.is_generic_object_type(ty) || self.is_generic_index_type(omitted_keys);
        if is_generic {
            // `Omit<T, "a" | K>`, and the properties that cannot go into the rest are omitted by
            // name as well.
            let mut keys: Vec<TypeId> = Vec::with_capacity(omitted.len() + 1 + excluded_keys.len());
            for &name in omitted {
                keys.extend(self.key_type_of_name(name));
            }
            keys.push(omitted_keys);
            keys.extend(excluded_keys);
            let keys = self.union(&keys);
            if keys.is_never() {
                return ty;
            }
            let Some(omit) = self.get_global_type_alias_symbol(known::Omit, 2, true) else {
                return TypeId::ERROR;
            };
            return self.type_reference(omit, &[ty, keys]);
        }
        let Some(members) = members else {
            return TypeId::EMPTY_OBJECT;
        };
        let mut shape = Shape::new_in(self.arena);
        let options = SpreadSymbolOptions {
            owner_is_generic: self.has_type_variables(apparent),
            readonly: false,
            resolves: false,
        };
        for i in kept {
            let prop = &members.shape().props[i];
            let (source, mapper, read_with) = self.get_spread_symbol(prop, members.mapper, options);
            let anew = prop
                .flags
                .intersects(PropFlags::WRITE_ONLY | PropFlags::READONLY);
            // A copy: a readonly property of the original is writable in it.
            let copied = if anew {
                PropFlags::OPTIONAL | PropFlags::STRING_NAME
            } else {
                // `getSpreadSymbol` returns the symbol itself.
                PropFlags::OPTIONAL | PropFlags::STRING_NAME | PropFlags::METHOD
            };
            shape.props.push(Prop {
                name: prop.name,
                flags: prop.flags & copied | read_with,
                source,
                mapper,
            });
        }
        for info in &members.shape().index {
            let value = self.instantiate(info.value, members.mapper);
            shape.index.push(IndexInfo { value, ..*info });
            // Read by `getApplicableIndexSymbol`: `symbol.Parent = t.symbol`.
            shape.symbol_declared_at =
                symbol.map(|(file, name)| (file, self.hir(file)[name].pos, ExprId::NONE));
        }
        if let Some((file, name)) = symbol {
            let scope = self.enclosing_scope_of_pat(file, name);
            shape.mapper = self.identity_mapper_with_adopted(file, scope);
        }
        self.synth(shape)
    }

    /// `getExtractStringType`
    pub(super) fn get_extract_string_type(&mut self, ty: TypeId) -> TypeId {
        match self.get_global_type_alias_symbol(known::Extract, 2, true) {
            Some(extract) => self.type_reference(extract, &[ty, TypeId::STRING]),
            None => TypeId::STRING,
        }
    }

    /// `getTypeForVariableLikeDeclaration`, followed by `widenTypeForVariableLikeDeclaration` if
    /// the variable has a name: a destructured value is not widened
    /// (`getTypeForBindingElementParent`).
    fn type_of_var_decl(&mut self, file: FileId, d: VarDeclId) -> TypeId {
        let hir = self.hir(file);
        let decl = &hir[d];
        let is_name = matches!(hir[decl.pat].kind, PatKind::Ident(_));
        let is_constant = matches!(
            decl.kind,
            VarKind::Const | VarKind::Using | VarKind::AwaitUsing
        );
        // The statement is the `try` for a catch variable, and the head of the loop for a loop variable.
        let stmt = self.bound(file).var_stmt[d.idx()];
        let around = if stmt.is_some() {
            self.bound(file).stmt_parent[stmt.idx()]
        } else {
            Parent::None
        };
        // The iterated expression decides, regardless of any annotation after the name.
        if let Parent::Stmt(parent) = around {
            match hir[parent].kind {
                StmtKind::ForIn { left, expr, .. } if left == stmt => {
                    // The keys of a generic type are its own keys, restricted to strings.
                    let object = self.type_of_expr(file, expr);
                    let object = self.non_nullable_type_if_needed(object);
                    let keys = self.keyof(object);
                    if matches!(
                        self.data(keys),
                        TypeData::Keyof(_) | TypeData::TypeParam(..)
                    ) {
                        return self.get_extract_string_type(keys);
                    }
                    return TypeId::STRING;
                }
                // `checkRightHandSideOfForOf`
                StmtKind::ForOf {
                    left,
                    expr,
                    is_await,
                    ..
                } if left == stmt => {
                    let element = self.check_right_hand_side_of_for_of(file, expr, is_await);
                    return if is_name {
                        self.widened_for_declaration(element, Some((file, decl.pat)))
                    } else {
                        element
                    };
                }
                _ => {}
            }
        }
        // A catch variable can only be annotated `any` or `unknown`.
        if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. }) {
            if decl.ty.is_none() {
                return if self.p.files.options.use_unknown_in_catch_variables {
                    TypeId::UNKNOWN
                } else {
                    TypeId::ANY
                };
            }
            let declared = self.type_from_node(file, decl.ty);
            return if self.is_any(declared) || declared == TypeId::UNKNOWN {
                declared
            } else {
                TypeId::ERROR
            };
        }
        // `isValidESSymbolDeclaration`: a `const` with a name, in a statement of its own. For
        // anything else a `unique symbol` is a `symbol`.
        let unique_symbol_name = match hir[decl.pat].kind {
            PatKind::Ident(name)
                if decl.kind == VarKind::Const
                    && stmt.is_some()
                    && matches!(hir[stmt].kind, StmtKind::Var(_))
                    && !matches!(around, Parent::Stmt(parent) if matches!(hir[parent].kind, StmtKind::For { init, .. } if init == stmt)) =>
            {
                Some(name)
            }
            _ => None,
        };
        if decl.ty.is_some() {
            if matches!(hir[decl.ty].kind, TypeNodeKind::UniqueSymbol)
                && let Some(name) = unique_symbol_name
            {
                return self.unique_symbol_of_variable(file, decl.pat, name);
            }
            return self.type_from_node(file, decl.ty);
        }
        // Where an implicit `any` is an error, control flow analysis determines the type of the
        // variable at each position. This depends on the syntax of the initializer, not on its
        // type.
        if self.p.files.options.no_implicit_any
            && is_name
            && !decl.flags.intersects(Flags::EXPORT | Flags::AMBIENT)
            && hir.kind != FileKind::Declaration
        {
            match decl.init.is_some().then(|| hir[decl.init].kind) {
                // `isNullOrUndefined`
                None | Some(ExprKind::Null) if !is_constant => return TypeId::AUTO,
                Some(ExprKind::Ident(known::undefined))
                    if !is_constant && self.bound(file).expr_symbol[decl.init.idx()].is_none() =>
                {
                    return TypeId::AUTO;
                }
                // `isEmptyArrayLiteral`, which does not skip parentheses.
                Some(ExprKind::Array(items))
                    if items.is_empty() && !is_parenthesized(hir, decl.init) =>
                {
                    return self.auto_array_type;
                }
                _ => {}
            }
        }
        if decl.init.is_none() {
            // `getTypeFromBindingPattern`: the type implied by the pattern itself.
            if !is_name {
                return self
                    .implied_by_pattern(file, decl.pat, IncludePatternInType::No, ReportErrors::Yes)
                    .unwrap_or(TypeId::ANY);
            }
            // `widenTypeForVariableLikeDeclaration` with no type.
            // `getTypeOfVariableOrParameterOrPropertyWorker` uses `symbol.ValueDeclaration`.
            if self.bound(file).pat_symbol[decl.pat.idx()].is_some()
                && self.value_declaration_of_variable_name(file, decl.pat) == (file, decl.pat)
            {
                self.report_implicit_any_of_name(file, decl.pat, TypeId::ANY);
            }
            return TypeId::ANY;
        }
        // `const s = Symbol()`
        if let Some(name) = unique_symbol_name
            && self.is_symbol_or_symbol_for_call(file, decl.init)
        {
            return self.unique_symbol_of_variable(file, decl.pat, name);
        }
        let ty = self.type_of_declaration_initializer(file, decl.init);
        // `getWidenedLiteralTypeForInitializer`
        let ty = if is_constant {
            ty
        } else {
            self.widen_literal(ty)
        };
        // `widenTypeInferredFromInitializer`
        if let Some(any) = self.implicit_any_of_empty_literal(file, ty) {
            self.report_implicit_any_of_name(file, decl.pat, any);
            return any;
        }
        if is_name {
            self.widened_for_declaration(ty, Some((file, decl.pat)))
        } else {
            ty
        }
    }

    /// Whether `links.resolvedType` of the symbol of the parameter `p` is nil until something asks
    /// for the type of the symbol. Its name is a pattern, for which `checkVariableLikeDeclaration`
    /// asks `getWidenedTypeForVariableLikeDeclaration(node, false /*reportErrors*/)` and stores
    /// nothing. `assignParameterType` has no part in its function. With an annotation nothing
    /// depends on it.
    #[inline]
    pub(super) fn is_resolved_on_request(&self, file: FileId, p: ParamId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        matches!(hir[hir[p].pat].kind, PatKind::Object(_) | PatKind::Array(_))
            && hir[p].ty.is_none()
            && bound.param_fn[p.idx()]
                .some()
                .is_some_and(|func| !matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_)))
    }

    /// `links.resolvedType != nil` for the symbol of `p`, which `is_resolved_on_request`.
    fn is_parameter_symbol_resolved(&self, file: FileId, p: ParamId) -> bool {
        let resolved = (self.p.resolved_parameter_symbols).get(&self.task, &(file, p));
        // `reportCircularityError` has assigned it as well.
        let known = (self.p.pat_types).get(&self.task, &(file, self.hir(file)[p].pat));
        resolved.is_some() || known.is_some_and(|(_, is_circular)| is_circular)
    }

    /// `get_type_of_parameter` for a parameter whose name is no identifier.
    #[inline(never)]
    pub(super) fn resolve_parameter_symbol_on_request(&mut self, file: FileId, p: ParamId) {
        if self.is_resolved_on_request(file, p) {
            self.type_of_param_on_request(file, p);
        }
    }

    /// `getTypeOfSymbol(p.Symbol())` where `is_resolved_on_request`. `pat_types` has what
    /// `getWidenedTypeForVariableLikeDeclaration` returns, with either `reportErrors`.
    #[inline(never)]
    fn type_of_param_on_request(&mut self, file: FileId, p: ParamId) -> TypeId {
        let pat = self.hir(file)[p].pat;
        let known = self.p.pat_types.get(&self.task, &(file, pat));
        if let Some((ty, true)) = known {
            return ty;
        }
        // tsgo does not ask here (`sig_params_of_declaration`), or asks when every file is checked
        // (a baseline writer).
        if self.is_requested_eagerly(self.stack.len()) || self.is_type_checked {
            return self.type_of_pat(file, pat);
        }
        let resolved = (self.p.resolved_parameter_symbols).get(&self.task, &(file, p));
        if resolved.is_some() {
            return self.type_of_pat(file, pat);
        }
        // `reportErrorsFromWidening`. Under strictNullChecks there is no widening type.
        let options = &self.p.files.options;
        let reports = options.no_implicit_any && !options.strict_null_checks;
        // One checker has collected the diagnostics of `file` by now, and has resolved the names
        // in the pattern.
        if reports && self.task.checker_count == 0 && !self.is_reported_in_time(None, file) {
            return self.type_of_pat(file, pat);
        }
        let query = Query::ParameterSymbol(file, pat);
        let ty = match known {
            Some((ty, _)) => ty,
            None => {
                let ty = self.resolve_type_of_pat(file, pat, query);
                let entry = self.p.pat_types.get(&self.task, &(file, pat));
                if !matches!(entry, Some((_, false))) {
                    return ty;
                }
                ty
            }
        };
        let stored = if reports {
            if !self.enter(query) {
                return ty;
            }
            let unwidened = self.type_for_parameter_of_declaration(file, p, CheckMode::empty());
            self.widened_for_declaration(unwidened, Some((file, pat)));
            let Ok(stored) = self.leave(query) else {
                return ty;
            };
            stored
        } else {
            Stored::new()
        };
        (self.p.resolved_parameter_symbols).insert(&self.task, (file, p), (), stored);
        ty
    }

    /// `getTypeOfSymbol(p.Symbol())`
    #[inline]
    pub fn type_of_param(&mut self, file: FileId, p: ParamId) -> TypeId {
        if self.is_resolved_on_request(file, p) {
            return self.type_of_param_on_request(file, p);
        }
        let pat = self.hir(file)[p].pat;
        if let Some((known, _)) = self.p.pat_types.get(&self.task, &(file, pat)) {
            return known;
        }
        let query = match self.hir(file)[pat].kind {
            PatKind::Object(_) | PatKind::Array(_) => Query::ParameterSymbol(file, pat),
            PatKind::Ident(_) | PatKind::Missing => Query::Pat(file, pat),
        };
        self.resolve_type_of_pat(file, pat, query)
    }

    /// `sig_params_up_to` for `compareSignaturesRelated`, after `sig_params(sig)` could not be
    /// stored. `assignParameterType` has given the parameters of a function expression that have no
    /// annotation their types, so `tryGetTypeAtPosition` pushes no resolution for those.
    pub(super) fn sig_params_compared_up_to(
        &mut self,
        sig: SigId,
        count: usize,
    ) -> List<'p, SigParam> {
        if let Some(declared) = self.default_construct_base_sig(sig)
            && let SigData::Decl { file, func, .. } | SigData::Construct { file, func, .. } =
                *self.types().sig(declared)
        {
            let hir = self.hir(file);
            let is_expression = matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Expr(_));
            for p in hir[func].params.iter().take(count) {
                if hir[p].ty.is_some() || !is_expression {
                    self.type_of_param(file, p);
                }
            }
        }
        self.sig_params(sig)
    }

    /// `getNonCircularReturnTypeOfSignature`. FOR SPEED: with `signature.resolvedReturnType != nil`
    /// the return type is not being resolved, and `getReturnTypeOfSignature` pushes no resolution
    /// for `on_reentry` to find. Neither does it where the return type needs no query.
    #[inline]
    pub(super) fn non_circular_return_type_of_signature(&mut self, sig: SigId) -> TypeId {
        match *self.types().sig(sig) {
            SigData::Decl { file, func, mapper } if !self.is_instantiating(mapper) => {
                let key = (file, func);
                if let Some((declared, _)) = self.p.fn_return_types.get(&self.task, &key) {
                    return self.instantiate_result_of_sig(declared, file, func, mapper);
                }
            }
            SigData::Decl { .. } => {
                if let Some(resolved) = self.p.resolved_return_types.get(&self.task, &sig) {
                    return resolved;
                }
            }
            // `signature.composite != nil`
            SigData::Synth {
                ret: TypeId::UNRESOLVED,
                ref of,
                ..
            } if of.len() > 1 => {}
            SigData::Synth { ret, .. } => {
                return if self.is_resolving_return_type(sig) {
                    self.any_for_return_type_in_resolution()
                } else {
                    ret
                };
            }
            SigData::WithReturn { ret, .. } => return ret,
            SigData::Construct { .. } | SigData::DefaultConstruct { .. } => {
                return self.sig_return(sig);
            }
        }
        self.resolve_non_circular_return_type_of_signature(sig)
    }

    /// `anyType` for `isResolvingReturnTypeOfSignature`. If a comparison is waiting for a return
    /// type, it is still in progress, and `r.relation.set` stores its result over the result of this
    /// one. `relations` retains the first entry, so this one is not stored.
    #[cold]
    fn any_for_return_type_in_resolution(&mut self) -> TypeId {
        let height = self.stack.len();
        if self.non_circular_returns.iter().any(|&at| at < height) {
            self.mark_tainted_from(self.frames.len());
        }
        TypeId::ANY
    }

    #[inline(never)]
    fn resolve_non_circular_return_type_of_signature(&mut self, sig: SigId) -> TypeId {
        if self.is_resolving_return_type(sig) {
            return self.any_for_return_type_in_resolution();
        }
        self.non_circular_returns.push(self.stack.len());
        let ty = self.sig_return(sig);
        self.non_circular_returns.pop();
        ty
    }

    fn type_of_param_uncached(&mut self, file: FileId, p: ParamId) -> TypeId {
        let hir = self.hir(file);
        let param = &hir[p];
        if param.ty.is_some() {
            let ty = self.type_from_node(file, param.ty);
            // `isOptionalDeclaration`: the `?` decides, with or without a default.
            if param.flags.contains(Flags::OPTIONAL) {
                return self.optional(ty);
            }
            return ty;
        }
        let func = self.bound(file).param_fn[p.idx()];
        let index = (p.0 - hir[func].params.start) as usize;
        // The getter determines the type.
        if hir[func].kind == FnKind::Setter
            && let Some((of, getter)) = self.sibling_accessor(file, func, FnKind::Getter)
        {
            let ty = self.return_type_of_fn(of, getter);
            return self.widened_for_declaration(ty, Some((file, param.pat)));
        }
        if let Some(ty) = self.param_type_of_full_signature(file, func, index) {
            return ty;
        }
        // `getContextuallyTypedParameterType`, `isContextSensitiveFunctionOrObjectLiteralMethod`: a
        // setter has no contextual type.
        if hir[func].kind != FnKind::Setter
            && let Some(mut ty) = self.contextual_param_type(file, func, index)
        {
            // An immediately invoked function has no contextual signature:
            // `assignNonContextualParameterTypes`, `getWidenedTypeForVariableLikeDeclaration`.
            if self.is_immediately_invoked(file, func) {
                ty = self.widened_for_declaration(ty, Some((file, param.pat)));
            }
            // `assignParameterType`: if the contextual type is just `unknown`, the pattern
            // determines the type.
            if ty == TypeId::UNKNOWN && !matches!(hir[param.pat].kind, PatKind::Ident(_)) {
                return self
                    .implied_by_pattern(file, param.pat, IncludePatternInType::No, ReportErrors::No)
                    .unwrap_or(ty);
            }
            if param.default.is_none() {
                return if param.flags.contains(Flags::OPTIONAL) {
                    self.optional(ty)
                } else {
                    ty
                };
            }
            // `assignContextualParameterTypes`: a default that is not assignable to the contextual
            // type decides, if the contextual type is assignable to the widened type of the
            // default. An immediately invoked function has no contextual signature.
            if !param.flags.contains(Flags::REST) && !self.is_immediately_invoked(file, func) {
                // TypeScript does this when it checks the function, not while it resolves the
                // parameter: a default that refers back to the parameter is not a cycle there.
                self.eager.push(self.stack.len());
                let actual = self.type_of_declaration_initializer(file, param.default);
                let actual = self.padded_for_pattern(file, param.pat, actual);
                if !self.is_assignable(actual, ty) {
                    let widened =
                        self.widen_type_inferred_from_initializer(file, param.pat, actual);
                    if self.is_assignable(ty, widened) {
                        ty = widened;
                    }
                }
                self.eager.pop();
            }
            // The types excluded by the default are removed where the parameter is read or
            // destructured.
            return ty;
        }
        if param.default.is_some() {
            let ty = self.type_from_param_default(file, p, CheckMode::empty());
            // `checkVariableLikeDeclaration` requests the type of a name, `assignParameterType`
            // that of any parameter of a function expression. For a pattern in a declaration
            // `type_of_param_on_request` reports.
            let is_requested_for = matches!(hir[param.pat].kind, PatKind::Ident(_))
                || matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Expr(_));
            let ty =
                self.widened_for_declaration(ty, is_requested_for.then_some((file, param.pat)));
            // `addOptionalityEx`
            return if param.flags.contains(Flags::OPTIONAL) {
                self.optional(ty)
            } else {
                ty
            };
        }
        // `getTypeFromBindingPattern`, for a rest parameter too: `any[]` is only for one with no
        // type information at all.
        if let Some(implied) = self.type_from_binding_pattern_of_param(file, func, p) {
            // As for a pattern with a default.
            let name = matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Expr(_))
                .then_some((file, param.pat));
            return self.widened_for_declaration(implied, name);
        }
        // `widenTypeForVariableLikeDeclaration` with no type.
        let reports = !matches!(hir[param.pat].kind, PatKind::Missing)
            && !self.is_private_within_ambient(file, func);
        if param.flags.contains(Flags::REST) {
            let ty = self.array_of(TypeId::ANY);
            if reports {
                self.report_implicit_any_of_name(file, param.pat, ty);
            }
            // `assignNonContextualParameterTypes`, `assignParameterType`: only a context sensitive function adds the `?`.
            let function = &hir[func];
            return if param.flags.contains(Flags::OPTIONAL)
                && function.type_params.is_empty()
                && matches!(function.kind, FnKind::Expr | FnKind::Arrow | FnKind::Method)
                && matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Expr(_))
            {
                self.optional(ty)
            } else {
                ty
            };
        }
        if reports {
            self.report_implicit_any_of_name(file, param.pat, TypeId::ANY);
        }
        TypeId::ANY
    }

    /// `widenTypeInferredFromInitializer` of `checkDeclarationInitializer`: the type the parameter
    /// `p` gets from its default, when it has no annotation and no contextual type.
    fn type_from_param_default(
        &mut self,
        file: FileId,
        p: ParamId,
        check_mode: CheckMode,
    ) -> TypeId {
        let param = &self.hir(file)[p];
        let for_rest = match check_mode.contains(CheckMode::REST_BINDING_ELEMENT) {
            true => self.type_of_reference_for_rest(file, param.default),
            false => None,
        };
        let ty = match for_rest {
            Some(ty) => ty,
            None => self.type_of_declaration_initializer(file, param.default),
        };
        let ty = self.padded_for_pattern(file, param.pat, ty);
        let widened = self.get_widened_literal_type_for_initializer(file, param.pat, ty);
        if let Some(any) = self.implicit_any_of_empty_literal(file, widened) {
            let func = self.bound(file).param_fn[p.idx()];
            if self.hir(file)[func].kind != FnKind::Setter {
                self.report_implicit_any_of_name(file, param.pat, any);
            }
            return any;
        }
        widened
    }

    /// `widenTypeInferredFromInitializer` for the variable, parameter or binding element whose name
    /// is `pat`.
    fn widen_type_inferred_from_initializer(
        &mut self,
        file: FileId,
        pat: PatId,
        ty: TypeId,
    ) -> TypeId {
        let widened = self.get_widened_literal_type_for_initializer(file, pat, ty);
        match self.implicit_any_of_empty_literal(file, widened) {
            Some(any) => {
                self.report_implicit_any_of_name(file, pat, any);
                any
            }
            None => widened,
        }
    }

    /// `getWidenedLiteralTypeForInitializer` for the variable, parameter or binding element whose
    /// name is `pat`.
    pub(super) fn get_widened_literal_type_for_initializer(
        &mut self,
        file: FileId,
        pat: PatId,
        ty: TypeId,
    ) -> TypeId {
        let hir = self.hir(file);
        let is_constant_or_readonly = match root_declaration(self.bound(file), pat) {
            // `NodeFlagsConstant`
            PatParent::Var(d) => matches!(
                hir[d].kind,
                VarKind::Const | VarKind::Using | VarKind::AwaitUsing
            ),
            // `isDeclarationReadonly`: a binding element is no parameter property.
            PatParent::Param(p) => {
                hir[p].flags.contains(Flags::READONLY)
                    && !(hir[p].pat == pat && hir.is_parameter_property_declaration(hir.node(p)))
            }
            _ => false,
        };
        if is_constant_or_readonly {
            ty
        } else {
            self.widen_literal(ty)
        }
    }

    /// `padObjectLiteralType`, `padTupleType`: `ty`, the type of the default of a parameter or of a
    /// part of one that `pat` destructures, is padded with the members the pattern has its own
    /// defaults for.
    pub(super) fn padded_for_pattern(&mut self, file: FileId, pat: PatId, ty: TypeId) -> TypeId {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Object(props) if self.is_object_literal_type(ty) => {
                let mut missing_elements = Vec::new();
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.default.is_none() {
                        continue;
                    }
                    // `getPropertyNameFromBindingElement`: `PropertyNameOrName` of a rest element
                    // is the name it binds.
                    let name = match (prop.key, hir[prop.value].kind) {
                        (PropKey::None, PatKind::Ident(name)) => Some(name),
                        // `getLiteralTypeFromPropertyName` is `never`.
                        (PropKey::Private(_), _) => None,
                        (key, _) => self.member_name(file, key),
                    };
                    if let Some(name) = name
                        && self.get_property_of_type(ty, name).is_none()
                    {
                        missing_elements.push((name, prop.value, prop.default));
                    }
                }
                if missing_elements.is_empty() {
                    return ty;
                }
                let Some(members) = self.members(ty) else {
                    return ty;
                };
                // `result.objectFlags = t.objectFlags`
                let (literal, mapper) = match self.data(ty) {
                    TypeData::Synth(shape) => (shape.literal, members.mapper),
                    // See `get_widened_type_of_object_literal`.
                    TypeData::Anon { mapper, .. } => (Literalness::Literal, *mapper),
                    _ => (Literalness::Literal, members.mapper),
                };
                let mut shape = Shape {
                    literal,
                    is_regular: !self.is_fresh_object_literal_type(ty),
                    contains_widening_type: self.contains_widening_type(ty),
                    is_js_literal: self.has_js_literal_flag(ty),
                    symbol_declared_at: self.symbol_declaration_of_object_type(ty),
                    mapper: self.mapper_of_object_literal_type(ty),
                    ..Shape::new_in(self.arena)
                };
                for prop in &members.shape().props {
                    let mapper = self.compose(prop.mapper, mapper);
                    shape.props.push(Prop {
                        mapper,
                        ..prop.clone_in(self.arena)
                    });
                }
                for (name, value, default) in missing_elements {
                    let ty = self.type_from_binding_element(
                        file,
                        value,
                        default,
                        IncludePatternInType::No,
                        ReportErrors::No,
                    );
                    shape.props.push(Prop {
                        name,
                        flags: PropFlags::OPTIONAL,
                        source: PropSource::Type(ty),
                        mapper: MapperId::IDENTITY,
                    });
                }
                for info in &members.shape().index {
                    let value = self.instantiate(info.value, members.mapper);
                    shape.index.push(IndexInfo { value, ..*info });
                }
                self.synth(shape)
            }
            PatKind::Array(elems) => {
                let TypeData::Tuple {
                    flags, readonly, ..
                } = self.data(ty)
                else {
                    return ty;
                };
                let types = self.type_arguments(ty);
                if flags
                    .iter()
                    .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                    || types.len() >= elems.len()
                {
                    return ty;
                }
                let (mut types, mut flags) = (types.to_vec(), flags.to_vec());
                for (i, e) in elems.iter().enumerate().skip(types.len()) {
                    let elem = &hir[e];
                    if i + 1 == elems.len() && elem.is_rest {
                        break;
                    }
                    types.push(if elem.default.is_some() {
                        self.type_from_binding_element(
                            file,
                            elem.pat,
                            elem.default,
                            IncludePatternInType::No,
                            ReportErrors::No,
                        )
                    } else {
                        // A hole is an element without a name, and is reported like the others.
                        self.report_implicit_any_of_name(file, elem.pat, TypeId::ANY);
                        TypeId::ANY
                    });
                    flags.push(ElemFlags::OPTIONAL);
                }
                self.tuple(&types, &flags, *readonly)
            }
            _ => ty,
        }
    }

    /// `GetDeclarationOfKind(getSymbolOfDeclaration(accessor), kind)`: the getter, or the setter if
    /// that is `expected`, that shares one symbol with the accessor `func`, in a class, an interface,
    /// a type literal or an object literal.
    pub(super) fn sibling_accessor(
        &mut self,
        file: FileId,
        func: FnId,
        expected: FnKind,
    ) -> Option<(FileId, FnId)> {
        let bound = self.bound(file);
        let accessor = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => Decl::Member(m),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => Decl::Property(p),
                _ => return None,
            },
            _ => return None,
        };
        self.declarations_of_member(file, accessor)
            .into_iter()
            .find_map(|(of, declaration)| {
                let hir = self.hir(of);
                let other = match declaration {
                    Decl::Member(m) => hir[m].func,
                    Decl::Property(p) if hir[p].value.is_some() => match hir[hir[p].value].kind {
                        ExprKind::Fn(f) => f,
                        _ => FnId::NONE,
                    },
                    _ => FnId::NONE,
                };
                (other.is_some() && hir[other].kind == expected).then_some((of, other))
            })
    }

    // ───────────────────────────── return types of functions ─────────────────────────────

    /// The return type of `func` as declared or as inferred from its body, in terms of the type
    /// parameters in scope.
    #[inline]
    pub fn return_type_of_fn(&mut self, file: FileId, func: FnId) -> TypeId {
        if let Some((known, _)) = self.p.fn_return_types.get(&self.task, &(file, func)) {
            return known;
        }
        self.resolve_return_type_of_fn(file, func)
    }

    #[inline(never)]
    fn resolve_return_type_of_fn(&mut self, file: FileId, func: FnId) -> TypeId {
        loop {
            let ty = self.resolve_return_type_of_fn_once(file, func);
            if self.unwind_to != self.stack.len() || !self.resolve_what_was_too_deep() {
                return ty;
            }
            if let Some((known, _)) = self.p.fn_return_types.get(&self.task, &(file, func)) {
                return known;
            }
        }
    }

    /// Inlined: see `resolve_type_of_symbol_once`.
    #[inline(always)]
    fn resolve_return_type_of_fn_once(&mut self, file: FileId, func: FnId) -> TypeId {
        if self.prepare_query_for_fn(file, func)
            && let Some((known, _)) = self.p.fn_return_types.get(&self.task, &(file, func))
        {
            return known;
        }
        // tsgo has the signature of a function expression from `checkFunctionExpressionOrObjectLiteralMethod`.
        if self.hir(file)[func].ret.is_none()
            && let Some(e) = self.takes_context(file, func)
        {
            self.contextually_check_function_expression_or_object_literal_method(
                file,
                e,
                func,
                CheckMode::empty(),
            );
            if let Some((known, _)) = self.p.fn_return_types.get(&self.task, &(file, func)) {
                return known;
            }
        }
        if let Some(raw) = self.provisional(Query::Return(file, func)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::Return(file, func)) {
            // `getReturnTypeOfSignature`
            return if self.found_cycle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.return_type_of_fn_uncached(file, func, CheckMode::empty());
        let left = self.leave(Query::Return(file, func));
        if self.left_a_cycle {
            let stored = self.cycle_result();
            // Overwrites the value of an inner evaluation above a `resolution_start` barrier, if
            // one was stored.
            let any = (TypeId::ANY, true);
            self.p
                .fn_return_types
                .rewrite(&self.task, (file, func), any, stored);
            self.report_circular_return_type(Some(Query::Return(file, func)), file, func);
            return TypeId::ANY;
        }
        // `getReturnTypeOfSignature`: `sig.resolvedReturnType` is assigned only if it is nil, and
        // the caller gets that value.
        if let Some((known, _)) = self.p.fn_return_types.get(&self.task, &(file, func)) {
            return known;
        }
        match left {
            Ok(stored) => {
                self.p
                    .fn_return_types
                    .insert(&self.task, (file, func), (ty, false), stored);
            }
            Err(open) => self.cache_provisionally(Query::Return(file, func), u64::from(ty.0), open),
        }
        ty
    }

    /// `getReturnTypeFromAnnotation`, then `getReturnTypeFromBody`. It pushes no resolution and caches nothing.
    pub(super) fn return_type_of_fn_uncached(
        &mut self,
        file: FileId,
        func: FnId,
        check_mode: CheckMode,
    ) -> TypeId {
        let check_mode = check_mode - CheckMode::SKIP_GENERIC_FUNCTIONS;
        let hir = self.hir(file);
        let f = &hir[func];
        if let Some(ty) = self.return_type_from_annotation(file, func) {
            return ty;
        }
        match f.kind {
            FnKind::Setter | FnKind::StaticBlock => return TypeId::VOID,
            FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType => {
                return TypeId::ANY;
            }
            _ => {}
        }
        // `getReturnTypeOfSignature`: `NodeIsMissing(body)`, a block whose `{` is missing.
        if f.flags.contains(Flags::MISSING_BODY) {
            return TypeId::ANY;
        }
        let is_async = f.flags.contains(Flags::ASYNC);
        let is_generator = f.flags.contains(Flags::GENERATOR);
        let info = self.bound(file).fns[func.idx()];
        let mut ret = match f.body {
            // `getReturnTypeOfSignature`
            FnBody::None => return TypeId::ANY,
            FnBody::Expr(e) => {
                let ty = self.check_expression_cached_ex(file, e, check_mode);
                let ty = self.regular_in_const_context(file, e, ty);
                if is_async {
                    let error_node = self.place_of_signature_declaration(file, func);
                    let ty = self.check_awaited_type(ty, false, error_node, 1058);
                    self.unwrap_awaited_type(ty)
                } else {
                    ty
                }
            }
            FnBody::Block(_) => {
                let (types, is_never_returning) =
                    self.check_and_aggregate_return_expression_types(file, func, check_mode);
                let returns_promise = is_async && !is_generator;
                if is_never_returning {
                    // "For an async function, the return type will not be never, but rather a Promise for never."
                    if returns_promise {
                        let error_node = self.place_of_signature_declaration(file, func);
                        return self.create_promise_return_type(error_node, false, TypeId::NEVER);
                    }
                    TypeId::NEVER
                } else if types.is_empty() {
                    // `undefinedType` if the contextual return type includes `undefined`. A
                    // generator that returns nothing returns `void`, whatever the contextual type.
                    let expected = if is_generator {
                        None
                    } else {
                        self.declared_or_contextual_return_type(file, func, ContextFlags::empty())
                    };
                    let expected = expected.map(|t| self.unwrap_return_type(file, func, t));
                    let returned =
                        if expected.is_some_and(|t| self.some_type(t, |_, m| m.is_undefined())) {
                            TypeId::UNDEFINED
                        } else {
                            TypeId::VOID
                        };
                    if returns_promise {
                        let error_node = self.place_of_signature_declaration(file, func);
                        return self.create_promise_return_type(error_node, false, returned);
                    }
                    returned
                } else {
                    self.union_reduced(&types)
                }
            }
        };
        if !is_generator {
            self.report_errors_from_widening_of_function(
                file,
                func,
                ret,
                WideningKind::FunctionReturn,
            );
            // `getWidenedLiteralLikeTypeForContextualReturnTypeIfNeeded`
            if self.is_unit(ret) {
                let mut contextual = if self.is_own_contextual_signature(file, func) {
                    Some(ret)
                } else {
                    self.return_type_of_contextual_signature(file, func)
                };
                if is_async {
                    // `GetPromisedTypeOfPromise`
                    contextual = contextual.and_then(|t| self.thenable_value(t));
                }
                ret = self.widen_literal_for_context(ret, contextual);
            }
            ret = self.get_widened_type(ret);
            if is_async {
                return self.promise_of(ret);
            }
            return ret;
        }
        // `checkAndAggregateYieldOperandTypes`
        let (mut yields, mut nexts) = (Vec::new(), Vec::new());
        for e in self.bound(file).ids(info.yields) {
            let ExprKind::Yield { value, star } = hir[e].kind else {
                continue;
            };
            if self.is_yield_in_parameter(file, e) {
                continue;
            }
            let operand = if value.is_none() {
                self.undefined_widening()
            } else {
                let ty = self.check_expression_cached_ex(file, value, check_mode);
                self.regular_in_const_context(file, value, ty)
            };
            let yielded =
                self.get_yielded_type_of_yield_expression(file, e, operand, TypeId::ANY, is_async);
            if let Some(ty) = yielded
                && !yields.contains(&ty)
            {
                yields.push(ty);
            }
            // The next type: the contextual types of the `yield` expressions.
            let next = if star {
                let usage = IterationUse::yield_star(is_async);
                let error_node = value
                    .is_some()
                    .then(|| self.span_of_parenthesized_expr(file, value));
                self.iterable_types(operand, usage, error_node).n
            } else {
                self.contextual_type(file, e, ContextFlags::empty())
            };
            if let Some(next) = next
                && !nexts.contains(&next)
            {
                nexts.push(next);
            }
        }
        let mut yielded = self.union_reduced(&yields);
        let mut next = if nexts.is_empty() {
            None
        } else {
            Some(self.intersection(&nexts))
        };
        for (ty, kind) in [
            (Some(yielded), WideningKind::GeneratorYield),
            (Some(ret), WideningKind::FunctionReturn),
            (next, WideningKind::GeneratorNext),
        ] {
            if let Some(ty) = ty {
                self.report_errors_from_widening_of_function(file, func, ty, kind);
            }
        }
        // `getWidenedLiteralLikeTypeForContextualIterationTypeIfNeeded`: only a unit type is
        // widened, and only where no literal type is expected. A union of literals is preserved.
        if self.is_unit(ret) || self.is_unit(yielded) || next.is_some_and(|t| self.is_unit(t)) {
            // `getIterationTypeOfGeneratorFunctionReturnType`: `any` says nothing.
            // `contextualSignature == getSignatureFromDeclaration(fn)`: nothing is expected of a generator.
            let expected = match self.is_own_contextual_signature(file, func) {
                true => None,
                false => self.return_type_of_contextual_signature(file, func),
            };
            let expected = expected.filter(|&t| !self.has_any_flag(t));
            let expected = expected.and_then(|t| self.iteration_types(t, is_async));
            if self.is_unit(yielded) {
                yielded = self.widen_literal_for_context(yielded, expected.map(|t| t.yielded));
            }
            if self.is_unit(ret) {
                ret = self.widen_literal_for_context(ret, expected.map(|t| t.returned));
            }
            if let Some(ty) = next
                && self.is_unit(ty)
            {
                next = Some(self.widen_literal_for_context(ty, expected.map(|t| t.next)));
            }
        }
        // `getWidenedType`
        let yielded = self.get_widened_type(yielded);
        let ret = self.get_widened_type(ret);
        let next = match next {
            Some(next) => self.get_widened_type(next),
            // `getContextualIterationType`, for which `any` provides no contextual type either.
            None => {
                let expected = self
                    .declared_or_contextual_return_type(file, func, ContextFlags::empty())
                    .filter(|&t| !self.has_any_flag(t));
                expected
                    .and_then(|t| self.iteration_types(t, is_async))
                    .map_or(TypeId::UNKNOWN, |t| t.next)
            }
        };
        self.generator_of(yielded, ret, next, is_async)
    }

    /// `forEachYieldExpression` visits only the body: whether the `yield` `e` is in a parameter of
    /// its function instead.
    fn is_yield_in_parameter(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let around = hir.find_ancestor(hir.node(e), |n| {
            hir.kind(n) == Kind::Parameter || hir.kind(n).is_function_like()
        });
        hir.kind(around) == Kind::Parameter
    }

    /// The type `ty` of `e`, which is returned or yielded: `getRegularTypeOfLiteralType` of it if `isConstContext(e)`.
    fn regular_in_const_context(&mut self, file: FileId, e: ExprId, ty: TypeId) -> TypeId {
        if !self.some_type(ty, |c, m| c.is_fresh_literal(m)) {
            return ty;
        }
        if self.is_valid_const_assertion_argument(file, e) && self.is_const_context(file, e) {
            self.regular(ty)
        } else {
            ty
        }
    }

    /// The return type of the contextual signature of `func`, which determines whether a literal it
    /// returns is preserved (`getReturnTypeFromBody`). An immediately invoked function has no
    /// contextual signature.
    fn return_type_of_contextual_signature(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let owner = self.takes_context(file, func)?;
        let sig = self.contextual_signature(file, func)?;
        let returned = self.sig_return(sig);
        Some(self.instantiate_contextual_type(returned, file, owner, ContextFlags::empty()))
    }

    /// `checkAndAggregateReturnExpressionTypes`: the types of the returned expressions, and whether
    /// the function never returns.
    fn check_and_aggregate_return_expression_types(
        &mut self,
        file: FileId,
        func: FnId,
        check_mode: CheckMode,
    ) -> (SmallVec<[TypeId; 4]>, bool) {
        let hir = self.hir(file);
        let f = &hir[func];
        let info = self.bound(file).fns[func.idx()];
        let is_async = f.flags.contains(Flags::ASYNC);
        let mut aggregated_types: SmallVec<[TypeId; 4]> = SmallVec::new();
        // `functionHasImplicitReturn`
        let mut has_return_with_no_expression =
            info.end != UNREACHABLE && self.is_reachable(file, info.end);
        let mut has_return_of_type_never = false;
        for stmt in self.bound(file).ids(info.returns) {
            let StmtKind::Return(expr) = hir[stmt].kind else {
                continue;
            };
            if expr.is_none() {
                has_return_with_no_expression = true;
                continue;
            }
            // "`return await` is also safe to unwrap here"
            let expr = match hir[expr].kind {
                ExprKind::Await(operand) if is_async => operand,
                _ => expr,
            };
            if self.is_call_of_the_function_itself(file, func, expr) {
                has_return_of_type_never = true;
                continue;
            }
            let mut ty = self.check_expression_cached_ex(file, expr, check_mode);
            if is_async {
                let error_node = self.place_of_signature_declaration(file, func);
                ty = self.check_awaited_type(ty, false, error_node, 1058);
                ty = self.unwrap_awaited_type(ty);
            }
            if ty.is_never() {
                has_return_of_type_never = true;
            }
            ty = self.regular_in_const_context(file, expr, ty);
            if !aggregated_types.contains(&ty) {
                aggregated_types.push(ty);
            }
        }
        // `mayReturnNever`
        let may_return_never = matches!(f.kind, FnKind::Expr | FnKind::Arrow)
            || (f.kind == FnKind::Method && matches!(info.owner, FnOwner::Expr(_)));
        if aggregated_types.is_empty()
            && !has_return_with_no_expression
            && (has_return_of_type_never || may_return_never)
        {
            return (aggregated_types, true);
        }
        if self.p.files.options.strict_null_checks
            && !aggregated_types.is_empty()
            && has_return_with_no_expression
            && !aggregated_types.contains(&TypeId::UNDEFINED)
        {
            aggregated_types.push(TypeId::UNDEFINED);
        }
        (aggregated_types, false)
    }

    /// `checkAndAggregateReturnExpressionTypes`: "Bare calls to this same function don't contribute
    /// to inference". `checkExpressionCached(expr.Expression())` runs for any callee that is an
    /// identifier, outside `getResolvedSignature`, which resets the resolution stack: a resolution
    /// in progress that the callee re-enters is a cycle.
    fn is_call_of_the_function_itself(&mut self, file: FileId, func: FnId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let callee = hir[call].callee;
        if !matches!(hir[callee].kind, ExprKind::Ident(_)) || is_parenthesized(hir, callee) {
            return false;
        }
        let ty = self.check_expression_cached_ex(file, callee, CheckMode::empty());
        self.is_type_of_function_symbol(ty, file, func)
            && (!matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow) || {
                let reference = self.reference_of(file, callee);
                self.is_constant_reference(&reference)
            })
    }

    /// `ty.symbol == getMergedSymbol(fn.Symbol())`
    fn is_type_of_function_symbol(&mut self, ty: TypeId, file: FileId, func: FnId) -> bool {
        match self.data(ty) {
            TypeData::Anon {
                origin: Origin::Function(symbol),
                ..
            } => {
                let own = self.bound(file).fn_symbol[func.idx()];
                own.is_some() && *symbol == self.files().sym(file, own)
            }
            TypeData::Fns { decls, .. } => {
                if decls.contains(&(file, func)) {
                    return true;
                }
                // The implementation of an overloaded method is not among `decls`.
                let (FnOwner::Member(member), Some(&(first_file, first))) =
                    (self.bound(file).fns[func.idx()].owner, decls.first())
                else {
                    return false;
                };
                let FnOwner::Member(first) = self.bound(first_file).fns[first.idx()].owner else {
                    return false;
                };
                self.symbol_of_member(file, member) == self.symbol_of_member(first_file, first)
            }
            _ => false,
        }
    }

    /// `getWidenedLiteralLikeTypeForContextualType`: a literal type is preserved where a literal
    /// type is expected.
    pub fn widen_literal_for_context(&mut self, ty: TypeId, contextual: Option<TypeId>) -> TypeId {
        match contextual {
            // The regular literal type from here on: it is not widened later.
            Some(contextual) if self.is_literal_context(ty, contextual) => self.regular(ty),
            _ => {
                let ty = self.widen_literal(ty);
                // `getWidenedUniqueESSymbolType`
                if !self.some_type(ty, |c, m| {
                    matches!(c.data(m), TypeData::UniqueSymbol { .. })
                }) {
                    return ty;
                }
                self.map_type(ty, |c, m| {
                    if matches!(c.data(m), TypeData::UniqueSymbol { .. }) {
                        TypeId::SYMBOL
                    } else {
                        m
                    }
                })
            }
        }
    }

    /// `isLiteralOfContextualType`: whether `contextual` accepts the literal type `candidate`, as
    /// opposed to its base type only.
    pub fn is_literal_context(&mut self, candidate: TypeId, contextual: TypeId) -> bool {
        // `TypeFlagsStringLiteral`, `TypeFlagsNumberLiteral`: an enum member has the flag of its
        // value, a computed member neither.
        let is_string_literal = |c: &Self, m: TypeId| {
            matches!(
                c.data(m),
                TypeData::StringLit { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::String(_),
                        ..
                    }
            )
        };
        let is_number_literal = |c: &Self, m: TypeId| {
            matches!(
                c.data(m),
                TypeData::NumberLit { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::Number(_),
                        ..
                    }
            )
        };
        let is_bigint_literal =
            |c: &Self, m: TypeId| matches!(c.data(m), TypeData::BigIntLit { .. });
        let is_unique_symbol =
            |c: &Self, m: TypeId| matches!(c.data(m), TypeData::UniqueSymbol { .. });
        if let TypeData::Union(parts) | TypeData::Intersection(parts) = self.data(contextual) {
            return parts.iter().any(|&p| self.is_literal_context(candidate, p));
        }
        // `TypeFlagsInstantiableNonPrimitive`, which `keyof T` is not.
        if self.is_deferred(contextual) && !matches!(self.data(contextual), TypeData::Keyof(_)) {
            // A type parameter constrained to a primitive requests the literal type, even if the
            // constraint is `string & {}`.
            let constraint = self.base_constraint(contextual);
            let extends =
                |c: &Self, kind: fn(&Self, TypeId) -> bool| c.maybe_type_of_kind(constraint, kind);
            return (extends(self, |_: &Self, m: TypeId| m == TypeId::STRING)
                && self.maybe_type_of_kind(candidate, is_string_literal))
                || (extends(self, |_: &Self, m: TypeId| m == TypeId::NUMBER)
                    && self.maybe_type_of_kind(candidate, is_number_literal))
                || (extends(self, |_: &Self, m: TypeId| m == TypeId::BIGINT)
                    && self.maybe_type_of_kind(candidate, is_bigint_literal))
                || (extends(self, |_: &Self, m: TypeId| m == TypeId::SYMBOL)
                    && self.maybe_type_of_kind(candidate, is_unique_symbol))
                || (!self.is_deferred(constraint)
                    && self.is_literal_context(candidate, constraint));
        }
        match self.data(contextual) {
            TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
            | TypeData::Keyof(_)
            | TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => self.maybe_type_of_kind(candidate, is_string_literal),
            TypeData::NumberLit { .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(_),
                ..
            } => self.maybe_type_of_kind(candidate, is_number_literal),
            TypeData::BigIntLit { .. } => self.maybe_type_of_kind(candidate, is_bigint_literal),
            TypeData::BoolLit { .. } => self.maybe_type_of_kind(candidate, Self::is_boolean_like),
            TypeData::UniqueSymbol { .. } => self.maybe_type_of_kind(candidate, is_unique_symbol),
            _ => false,
        }
    }

    // ───────────────────────────── promises and iterables ─────────────────────────────

    /// `X`, if `ty` is an `Awaited<X>` that is deferred because `X` is generic.
    pub(super) fn awaited_argument(&mut self, ty: TypeId) -> Option<TypeId> {
        let TypeData::Cond {
            file, node, mapper, ..
        } = *self.data(ty)
        else {
            return None;
        };
        // `getGlobalAwaitedSymbolOrNil`
        let alias = self.get_global_type_alias_symbol(known::Awaited, 1, false)?;
        if alias.file != file {
            return None;
        }
        let &Decl::Alias(a) = self.files().symbol(alias).decls.first()? else {
            return None;
        };
        let hir = self.hir(file);
        if hir[a].ty != node {
            return None;
        }
        let param = self.type_param(file, hir[a].type_params.iter().next()?);
        Some(self.instantiate(param, mapper))
    }

    /// `unwrapAwaitedType`
    pub(super) fn unwrap_awaited_type(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| c.awaited_argument(m).unwrap_or(m))
    }

    /// `checkAwaitedType`: the type of `await` applied to a value of type `ty`. `message`: the
    /// error reported at `error_node` for a type that has a callable `then` and is not a promise.
    pub(super) fn check_awaited_type(
        &mut self,
        ty: TypeId,
        with_alias: bool,
        error_node: Place,
        message: u32,
    ) -> TypeId {
        let error = Some((error_node, message));
        let awaited = if with_alias {
            self.awaited_type_ex(ty, error)
        } else {
            self.awaited_no_alias_ex(ty, error)
        };
        awaited.unwrap_or(TypeId::ERROR)
    }

    /// The same, without reporting.
    pub fn awaited(&mut self, ty: TypeId) -> TypeId {
        self.awaited_or_none(ty).unwrap_or(TypeId::ERROR)
    }

    /// `getAwaitedType`. `None`: awaiting a `ty` is an error.
    pub(super) fn awaited_or_none(&mut self, ty: TypeId) -> Option<TypeId> {
        self.awaited_type_ex(ty, None)
    }

    /// `getAwaitedTypeEx`. `error`: `errorNode` and `diagnosticMessage`.
    fn awaited_type_ex(&mut self, ty: TypeId, error: Option<(Place, u32)>) -> Option<TypeId> {
        let awaited = self.awaited_no_alias_ex(ty, error)?;
        // `createAwaitedTypeIfNeeded`, applied to the whole: `T | U` is `Awaited<T | U>` if either
        // may turn out to be a promise.
        if self.is_awaited_type_needed(awaited) {
            // `getGlobalAwaitedSymbol`
            let Some(alias) = self.get_global_type_alias_symbol(known::Awaited, 1, true) else {
                return Some(awaited);
            };
            // `Awaited<T | U>` does for `Awaited<Awaited<T> | U>`.
            let unwrapped = self.unwrap_awaited_type(awaited);
            return Some(self.type_reference(alias, &[unwrapped]));
        }
        Some(awaited)
    }

    /// `getAwaitedTypeNoAlias`: the same, but a type that may turn out to be a promise is left as
    /// is, not wrapped in `Awaited`.
    pub(super) fn awaited_no_alias(&mut self, ty: TypeId) -> Option<TypeId> {
        self.awaited_no_alias_ex(ty, None)
    }

    /// `getAwaitedTypeNoAliasEx`
    fn awaited_no_alias_ex(&mut self, ty: TypeId, error: Option<(Place, u32)>) -> Option<TypeId> {
        if self.is_any(ty) || self.is_primitive(ty) || self.awaited_argument(ty).is_some() {
            return Some(ty);
        }
        if self.has_type_variables(ty) || !self.is_no_type_resolution_in_progress() {
            return self.awaited_no_alias_uncached(ty, error);
        }
        // `c.cachedTypes[key]`, which holds no nil. A caller that finds a result reports nothing,
        // not even what the first caller found in a member of a union.
        let cached = self.p.awaited_types.get(&self.task, &ty);
        if let Some(awaited) = cached
            && (awaited.is_some() || error.is_none())
        {
            return awaited;
        }
        let (scope, reported) = (self.begin_scope(), self.reported.len());
        let awaited = self.awaited_no_alias_uncached(ty, error);
        if let Ok(stored) = self.end_scope_by_counters(scope)
            && cached.is_none()
            // A result that depends on one of these is not cacheable, and `non_cacheable_mark` does not always show it.
            && self.inference_contexts.is_empty()
            && self.provisional.is_empty()
            // It is set for the current caller, every time.
            && !self.relation_too_complex
            && self.reliability == 0
            // A frame that drops its diagnostics reports them when it is evaluated again.
            && !(self.reported.len() > reported
                && self.frames.last().is_some_and(|frame| frame.drops_reported))
        {
            self.p.awaited_types.insert(&self.task, ty, awaited, stored);
        }
        awaited
    }

    /// A resolution in progress for a type is silently skipped by any caller that re-enters it.
    /// Returns whether there is none: in that case a result computed from a type now is valid at
    /// any time.
    fn is_no_type_resolution_in_progress(&self) -> bool {
        self.awaiting.is_empty()
            && self.instantiation_depth == 0
            && self.never_in_progress.is_empty()
            && self.variances_in_progress.is_empty()
            && self.constraint_stack.is_empty()
            && self.reverse_mapped_source_stack.is_empty()
            && self.stack.iter().all(|q| {
                matches!(
                    q,
                    Query::Expr(..)
                        | Query::Call(..)
                        | Query::LiteralProp(..)
                        | Query::Pat(..)
                        | Query::ParameterSymbol(..)
                        | Query::Symbol(_)
                        | Query::Return(..)
                        | Query::ReturnOfSignature(_)
                        | Query::ReturnAtFirstLook(..)
                )
            })
    }

    /// For a `ty` that is not `any`, not a primitive, and not a deferred `Awaited<T>`.
    fn awaited_no_alias_uncached(
        &mut self,
        ty: TypeId,
        error: Option<(Place, u32)>,
    ) -> Option<TypeId> {
        if self.is_union(ty) {
            // `type S = string | Promise<S>` never terminates.
            if self.awaiting.contains(&ty) {
                if let Some((error_node, _)) = error {
                    self.error_at(error_node, 1062, &[]);
                }
                return None;
            }
            self.awaiting.push(ty);
            let parts = self.parts(ty);
            let mut mapped: SmallVec<[TypeId; 8]> = SmallVec::new();
            for &part in parts {
                mapped.extend(self.awaited_no_alias_ex(part, error));
            }
            self.awaiting.pop();
            // `mapType`: a member with no result is omitted, and if none is left there is no
            // result.
            if mapped[..] == parts[..] {
                return Some(ty);
            }
            return if mapped.is_empty() {
                None
            } else {
                Some(self.union(&mapped))
            };
        }
        if self.is_awaited_type_needed(ty) {
            return Some(ty);
        }
        let mut this_type_for_error = None;
        if let Some(promised) = self.thenable_value_ex(ty, &mut this_type_for_error) {
            // A promise of itself, or of a promise of itself, is never settled.
            if promised == ty || self.awaiting.contains(&promised) {
                if let Some((error_node, _)) = error {
                    self.error_at(error_node, 1062, &[]);
                }
                return None;
            }
            if self.is_stack_low() {
                return Some(TypeId::UNRESOLVED);
            }
            self.awaiting.push(ty);
            let awaited = self.awaited_no_alias_ex(promised, error);
            self.awaiting.pop();
            return awaited;
        }
        // A type that has a callable `then` and is not a promise would never be settled either.
        if !self.is_thenable(ty) {
            return Some(ty);
        }
        if let Some((error_node, message)) = error {
            let chain = this_type_for_error.map(|this| {
                self.new_diagnostic(error_node, 2684, &[Arg::Type(ty), Arg::Type(this)])
            });
            let diagnostic = self.new_diagnostic_chain(chain, error_node, message, &[]);
            self.add_diagnostic(diagnostic);
        }
        None
    }

    /// `isAwaitedTypeNeeded`: whether `ty` is a generic type that may turn out to be a promise.
    fn is_awaited_type_needed(&mut self, ty: TypeId) -> bool {
        if self.is_any(ty)
            || self.awaited_argument(ty).is_some()
            || !self.is_generic_object_type(ty)
        {
            return false;
        }
        match self.base_constraint_of(ty) {
            Some(constraint) => {
                self.is_any(constraint)
                    || constraint == TypeId::UNKNOWN
                    || self.is_empty_object_type(constraint)
                    || self.parts(constraint).iter().any(|&m| self.is_thenable(m))
            }
            None => self.maybe_type_of_kind(ty, Self::is_type_variable),
        }
    }

    /// `allTypesAssignableToKind(getBaseConstraintOrType(ty), TypeFlagsPrimitive | TypeFlagsNever)`
    fn is_all_primitive_or_never(&mut self, ty: TypeId) -> bool {
        let base = self.base_constraint_of(ty).unwrap_or(ty);
        base.is_never()
            || self.every_type(base, |c, m| match c.data(m) {
                // `string & { tag: 1 }` is a string.
                TypeData::Intersection(parts) => parts.iter().any(|&p| c.is_primitive(p)),
                _ => c.is_primitive(m),
            })
    }

    /// `getPropertyOfType`, and `getTypeOfSymbol` of that: the type of the property `name` of `ty`,
    /// and whether it is optional.
    fn declared_property(&mut self, ty: TypeId, name: Atom) -> Option<(TypeId, bool)> {
        let (prop, mapper) = self.get_property_of_type(ty, name)?;
        let found = self.type_of_prop(prop, mapper);
        let is_optional = prop.flags.contains(PropFlags::OPTIONAL);
        Some((
            if is_optional {
                self.optional_property(found)
            } else {
                found
            },
            is_optional,
        ))
    }

    /// `getTypeOfFirstParameterOfSignature`
    pub(super) fn type_of_first_parameter(&mut self, sig: SigId) -> TypeId {
        self.type_of_first_parameter_with_fallback(sig, TypeId::NEVER)
    }

    /// `getTypeOfFirstParameterOfSignatureWithFallback`
    pub(super) fn type_of_first_parameter_with_fallback(
        &mut self,
        sig: SigId,
        fallback_type: TypeId,
    ) -> TypeId {
        let params = self.sig_params(sig);
        if params.is_empty() {
            fallback_type
        } else {
            self.param_type_at(&params, 0).unwrap_or(TypeId::ANY)
        }
    }

    /// `isThenableType`: whether a `ty` has a callable `then`.
    pub(super) fn is_thenable(&mut self, ty: TypeId) -> bool {
        if self.is_all_primitive_or_never(ty) {
            return false;
        }
        let Some((then, _)) = self.declared_property(ty, known::then) else {
            return false;
        };
        // `TypeFactsNEUndefinedOrNull`
        let then = self.filter(then, |c, m| !c.is_nullish(m));
        !self.signatures(then, false).is_empty()
    }

    /// `getPromisedTypeOfPromise`: the parameter type of the callback passed to `ty.then`. `None`:
    /// a `ty` is not a promise.
    pub(super) fn thenable_value(&mut self, ty: TypeId) -> Option<TypeId> {
        self.thenable_value_ex(ty, &mut None)
    }

    /// `getPromisedTypeOfPromiseEx`. `this_type_for_error_out`: the `this` type that a `then`
    /// requires, if no `then` accepts a `ty` as `this`.
    /// (No caller passes an `errorNode`.)
    fn thenable_value_ex(
        &mut self,
        ty: TypeId,
        this_type_for_error_out: &mut Option<TypeId>,
    ) -> Option<TypeId> {
        if self.is_any(ty) {
            return None;
        }
        if let Some(args) = self.is_global_ref(ty, known::Promise, 1) {
            return args.first().copied();
        }
        // A type that is not an object is never treated as a promise, regardless of its `then`
        // member.
        if self.is_all_primitive_or_never(ty) {
            return None;
        }
        let (then, _) = self.declared_property(ty, known::then)?;
        // `then` is unresolved, so the promised type is unresolved too.
        if then == TypeId::UNRESOLVED {
            return Some(then);
        }
        if self.is_any(then) {
            return None;
        }
        // The call signatures of `then` on a `ty`.
        let mut callbacks: SmallVec<[TypeId; 4]> = SmallVec::new();
        let mut this_type_for_error = None;
        for sig in self.signatures(then, false) {
            if let Some(this) = self.sig_this_type(sig)
                && this != TypeId::VOID
                && !self.is_subtype(ty, this)
            {
                this_type_for_error = Some(this);
                continue;
            }
            callbacks.push(self.type_of_first_parameter(sig));
        }
        if callbacks.is_empty() {
            *this_type_for_error_out = this_type_for_error;
            return None;
        }
        let on_fulfilled = self.union(&callbacks);
        // `TypeFactsNEUndefinedOrNull`
        let on_fulfilled = self.filter(on_fulfilled, |c, m| !c.is_nullish(m));
        if on_fulfilled == TypeId::UNRESOLVED {
            return Some(on_fulfilled);
        }
        if self.is_any(on_fulfilled) {
            return None;
        }
        let mut values: SmallVec<[TypeId; 4]> = SmallVec::new();
        for callback in self.signatures(on_fulfilled, false) {
            values.push(self.type_of_first_parameter(callback));
        }
        if values.is_empty() {
            return None;
        }
        Some(self.union_reduced(&values))
    }

    /// `checkIteratedTypeOrElementType`: the type that `for (const x of ty)` binds `x` to (`for
    /// await` if `is_async`), and the element type that `...ty` and `yield* ty` produce. A type
    /// that is not iterable, such as `never`, is an error, and the result of an error is any.
    pub fn iterated_type(&mut self, ty: TypeId, is_async: bool) -> TypeId {
        match self.iterated_type_if_any(ty, is_async) {
            Some(element) => element,
            None => TypeId::ANY,
        }
    }

    /// `checkIteratedTypeOrElementType(IterationUseSpread, ..)`
    pub(super) fn check_iterated_type_of_spread(
        &mut self,
        ty: TypeId,
        error_node: Place,
    ) -> TypeId {
        let usage = IterationUse::Spread;
        self.iterated_type_or_element_type(usage, ty, TypeId::UNDEFINED, Some(error_node))
            .unwrap_or(TypeId::ANY)
    }

    /// `checkIteratedTypeOrElementType(IterationUseSpread, ..)` without reporting.
    pub(super) fn iterated_type_of_spread(&mut self, ty: TypeId) -> TypeId {
        self.iterated_type_or_element_type(IterationUse::Spread, ty, TypeId::UNDEFINED, None)
            .unwrap_or(TypeId::ANY)
    }

    /// `checkIteratedTypeOrElementType(IterationUseDestructuring, ..)` without reporting.
    pub(super) fn iterated_type_of_destructuring(&mut self, ty: TypeId) -> TypeId {
        let usage = IterationUse::Destructuring;
        self.iterated_type_or_element_type(usage, ty, TypeId::UNDEFINED, None)
            .unwrap_or(TypeId::ANY)
    }

    /// `iterated_type`
    pub(super) fn checked_iterated_type(&mut self, ty: TypeId, is_async: bool) -> TypeId {
        self.iterated_type(ty, is_async)
    }

    /// `getIteratedTypeOrElementType` without reporting. `None`: `ty` is not iterable. Only
    /// `for..of` allows strings (`IterationUseAllowsStringInputFlag`), but callers are not
    /// distinguished here.
    pub(super) fn iterated_type_if_any(&mut self, ty: TypeId, is_async: bool) -> Option<TypeId> {
        let usage = if is_async {
            IterationUse::ForAwaitOf
        } else {
            IterationUse::ForOf
        };
        self.iterated_type_or_element_type(usage, ty, TypeId::UNDEFINED, None)
    }

    /// `getIteratedTypeOrElementType`. `sent`: the type that will be passed to `next`. An
    /// `error_node` also implies `checkAssignability`.
    pub(super) fn iterated_type_or_element_type(
        &mut self,
        usage: IterationUse,
        ty: TypeId,
        sent: TypeId,
        error_node: Option<Place>,
    ) -> Option<TypeId> {
        if self.is_any(ty) {
            return Some(ty);
        }
        let allows_async = usage.allows_async();
        if ty.is_never() {
            if let Some(error_node) = error_node {
                let is_for_of = usage.is_for_of();
                let diagnostic =
                    self.type_not_iterable_error(error_node, ty, allows_async, is_for_of);
                self.add_diagnostic(diagnostic);
            }
            return None;
        }
        let iterable_exists = self.global_type_of_arity(known::Iterable, 3).is_some();
        if iterable_exists || allows_async {
            let types = self.iterable_types(ty, usage, error_node.filter(|_| iterable_exists));
            let head_message = usage.code_for_sent_type();
            if error_node.is_some()
                && head_message.is_some()
                && let Some(next) = types.n
            {
                self.check_type_assignable_to(sent, next, error_node, head_message);
            }
            if types.y.is_some() || iterable_exists {
                return types.y;
            }
        }
        // Without `Iterable`, only strings (where allowed) and array-like types are iterable.
        let mut arrays = ty;
        if usage.is_for_of() {
            if self.is_union(ty) {
                let members = self.parts(ty);
                let is_other = |t: &TypeId| !self.is_string_like(*t);
                let filtered: SmallVec<[TypeId; 8]> =
                    members.iter().copied().filter(is_other).collect();
                if filtered.len() != members.len() {
                    arrays = self.union_reduced(&filtered);
                }
            } else if self.is_string_like(ty) {
                arrays = TypeId::NEVER;
            }
            if arrays != ty && arrays.is_never() {
                return Some(TypeId::STRING);
            }
        }
        let has_string = arrays != ty;
        if !self.is_array_like(arrays) {
            if let Some(error_node) = error_node {
                let allows_strings = usage.is_for_of() && !has_string;
                let (code, maybe_missing_await) =
                    self.get_iteration_diagnostic_details(usage, ty, allows_strings);
                // `getAwaitedTypeOfPromise`
                let is_missing_await = maybe_missing_await
                    && (self.thenable_value(arrays))
                        .and_then(|promised| self.awaited_or_none(promised))
                        .is_some();
                let args = [Arg::Type(arrays)];
                self.error_and_maybe_suggest_await(error_node, is_missing_await, code, &args);
            }
            return has_string.then_some(TypeId::STRING);
        }
        let element = self.index_type_of_type(arrays, TypeId::NUMBER)?;
        Some(if !has_string {
            element
        } else if self.is_string_like(element) && !self.p.files.options.no_unchecked_indexed_access
        {
            TypeId::STRING
        } else {
            self.union_reduced(&[element, TypeId::STRING])
        })
    }

    /// `getIterationDiagnosticDetails`: the message, and `maybeMissingAwait`.
    fn get_iteration_diagnostic_details(
        &mut self,
        usage: IterationUse,
        input_type: TypeId,
        allows_strings: bool,
    ) -> (u32, bool) {
        if self.iterable_types(input_type, usage, None).y.is_some() {
            return (2802, false);
        }
        // `isES2015OrLaterIterable(inputType.symbol.Name)`
        let is_later_iterable = matches!(self.data(input_type), TypeData::Ref { target, .. } if matches!(
            self.atoms().bytes(self.files().symbol(*target).name),
            b"Float32Array" | b"Float64Array" | b"Int16Array" | b"Int32Array" | b"Int8Array" | b"NodeList" | b"Uint16Array" | b"Uint32Array" | b"Uint8Array" | b"Uint8ClampedArray"
        ));
        if is_later_iterable {
            (2802, true)
        } else if allows_strings {
            (2495, true)
        } else {
            (2461, true)
        }
    }

    /// `reportTypeNotIterableError`. The diagnostic is not added yet. `is_of_for_of`: `error_node`
    /// is the iterated expression of a `for..of`.
    fn type_not_iterable_error(
        &mut self,
        error_node: Place,
        ty: TypeId,
        allows_async: bool,
        is_of_for_of: bool,
    ) -> Reported {
        // `getAwaitedTypeOfPromise`
        let mut suggests_await = self
            .thenable_value(ty)
            .and_then(|promised| self.awaited_or_none(promised))
            .is_some();
        if !suggests_await
            && !allows_async
            && is_of_for_of
            && self.global_type_of_arity(known::AsyncIterable, 3).is_some()
        {
            let any_async_iterable = self.global_ref(known::AsyncIterable, &[TypeId::ANY; 3]);
            suggests_await = self.is_assignable(ty, any_async_iterable);
        }
        let code = type_not_iterable_code(allows_async);
        let mut diagnostic = self.new_diagnostic(error_node, code, &[Arg::Type(ty)]);
        if suggests_await {
            diagnostic.add_related_info(Reported::bare(error_node, 2773));
        }
        diagnostic
    }

    /// `checkYieldExpression`
    pub(super) fn type_of_yield(
        &mut self,
        file: FileId,
        e: ExprId,
        value: ExprId,
        star: bool,
    ) -> TypeId {
        let Some(func) = self.containing_generator(file, e) else {
            return TypeId::ANY;
        };
        let is_async = self.hir(file)[func].flags.contains(Flags::ASYNC);
        // "There is no point in doing an assignability check if the function has no explicit return type"
        let mut return_type = self.return_type_from_annotation(file, func);
        if let Some(declared) = return_type
            && self.is_union(declared)
        {
            return_type = Some(self.filter(declared, |c, t| {
                c.check_generator_instantiation_assignability_to_return_type(t, is_async, None)
            }));
        }
        let iteration_types = match return_type {
            Some(declared) if !self.is_any(declared) => {
                self.generator_return_types(declared, is_async)
            }
            _ => Iter3::default(),
        };
        let yield_expression_type = if value.is_some() {
            self.type_of_expr(file, value)
        } else {
            self.undefined_widening()
        };
        let yielded_type = self.get_yielded_type_of_yield_expression(
            file,
            e,
            yield_expression_type,
            iteration_types.n.unwrap_or(TypeId::ANY),
            is_async,
        );
        if return_type.is_some()
            && let Some(yielded_type) = yielded_type
        {
            let error_node = self.error_node_of_yield(file, e, value);
            self.check_type_assignable_to_and_optionally_elaborate(
                yielded_type,
                iteration_types.y.unwrap_or(TypeId::ANY),
                Some(error_node),
                value.is_some().then_some((file, value)),
                false,
                None,
                None,
            );
        }
        if star {
            let usage = IterationUse::yield_star(is_async);
            let error_node = value
                .is_some()
                .then(|| self.span_of_parenthesized_expr(file, value));
            let types = self.iterable_types(yield_expression_type, usage, error_node);
            return types.r.unwrap_or(TypeId::ANY);
        }
        if return_type.is_some() {
            return iteration_types.n.unwrap_or(TypeId::ANY);
        }
        // `getContextualIterationType`
        match self.declared_or_contextual_return_type(file, func, ContextFlags::empty()) {
            Some(contextual) => {
                let types = self.generator_return_types(contextual, is_async);
                types.n.unwrap_or(TypeId::ANY)
            }
            None => TypeId::ANY,
        }
    }

    /// `getYieldedTypeOfYieldExpression`
    fn get_yielded_type_of_yield_expression(
        &mut self,
        file: FileId,
        node: ExprId,
        expression_type: TypeId,
        sent_type: TypeId,
        is_async: bool,
    ) -> Option<TypeId> {
        let ExprKind::Yield { value, star } = self.hir(file)[node].kind else {
            return None;
        };
        if !star && !is_async {
            return Some(expression_type);
        }
        let error_node = self.error_node_of_yield(file, node, value);
        // "A `yield*` expression effectively yields everything that its operand yields"
        let yielded_type = if star {
            // `checkIteratedTypeOrElementType`
            let usage = IterationUse::yield_star(is_async);
            self.iterated_type_or_element_type(usage, expression_type, sent_type, Some(error_node))
                .unwrap_or(TypeId::ANY)
        } else {
            expression_type
        };
        if !is_async {
            return Some(yielded_type);
        }
        let message = if star { 1322 } else { 1321 };
        self.awaited_type_ex(yielded_type, Some((error_node, message)))
    }

    /// `core.OrElse(node.Expression(), node)` of the `yield` expression `node`.
    fn error_node_of_yield(&self, file: FileId, node: ExprId, value: ExprId) -> Place {
        if value.is_some() {
            self.span_of_parenthesized_expr(file, value)
        } else {
            self.place_of_token(file, self.hir(file)[node].pos)
        }
    }

    /// The generator function that contains the `yield` expression `e`. Without one,
    /// `checkYieldExpression` returns `any` immediately.
    pub(super) fn containing_generator(&self, file: FileId, e: ExprId) -> Option<FnId> {
        self.get_containing_function(file, e)
            .filter(|&func| self.hir(file)[func].flags.contains(Flags::GENERATOR))
    }

    /// `checkGeneratorInstantiationAssignabilityToReturnType`
    pub(super) fn check_generator_instantiation_assignability_to_return_type(
        &mut self,
        return_type: TypeId,
        is_async: bool,
        error_node: Option<Place>,
    ) -> bool {
        let types = self.iteration_type_of_generator_function_return_type(return_type, is_async);
        let yielded = types.y.unwrap_or(TypeId::ANY);
        let generator = self.generator_of(
            yielded,
            types.r.unwrap_or(yielded),
            types.n.unwrap_or(TypeId::UNKNOWN),
            is_async,
        );
        self.check_type_assignable_to(generator, return_type, error_node, None)
    }

    /// `getIterationTypesOfGeneratorFunctionReturnType`: the yield, return and next types of a
    /// generator function whose declared return type is `ty`. `None`: `ty` is neither an iterable
    /// nor an iterator. If only some of the three exist, callers get any for a missing one, and
    /// `unknown` for a missing next type.
    pub fn iteration_types(&mut self, ty: TypeId, is_async: bool) -> Option<IterationTypes> {
        let types = self.generator_return_types(ty, is_async);
        types.has_types().then(|| IterationTypes {
            yielded: types.y.unwrap_or(TypeId::ANY),
            returned: types.r.unwrap_or(TypeId::ANY),
            next: types.n.unwrap_or(TypeId::UNKNOWN),
        })
    }

    /// `getIterationTypeOfGeneratorFunctionReturnType`, for the three kinds at once: `any` says
    /// nothing.
    pub(super) fn iteration_type_of_generator_function_return_type(
        &mut self,
        return_type: TypeId,
        is_async: bool,
    ) -> Iter3 {
        if self.is_any(return_type) {
            Iter3::default()
        } else {
            self.generator_return_types(return_type, is_async)
        }
    }

    /// `getIterationTypesOfGeneratorFunctionReturnType`: missing types stay missing.
    pub(super) fn generator_return_types(&mut self, ty: TypeId, is_async: bool) -> Iter3 {
        let usage = if is_async {
            IterationUse::AsyncGeneratorReturnType
        } else {
            IterationUse::GeneratorReturnType
        };
        let types = self.iterable_types(ty, usage, None);
        if types.has_types() {
            types
        } else {
            self.iterator_types(ty, is_async, None, None)
        }
    }

    /// `getIterationTypesOfIterable`: the iteration types of `ty`, through its
    /// `[Symbol.asyncIterator]` if `usage` allows async iterables, otherwise through its
    /// `[Symbol.iterator]` if it allows sync ones.
    pub(super) fn iterable_types(
        &mut self,
        ty: TypeId,
        usage: IterationUse,
        error_node: Option<Place>,
    ) -> Iter3 {
        let ty = self.reduced(ty);
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        let key = (ty, usage.cache_flags());
        let cached = self.iteration_types_cache.get(&key).copied();
        // Some callers compute a type without an error node where tsgo passes one, and report
        // from another pass. Such a request reads and writes the table as a memo only.
        let is_request = error_node.is_some() || usage.has_no_error_node();
        if let Some((types, is_requested)) = cached
            && (error_node.is_none() || is_requested && types.has_types())
        {
            if is_request && !is_requested {
                self.iteration_types_cache.insert(key, (types, true));
            }
            return types;
        }
        let (before, reported) = (self.non_cacheable_mark(), self.reported.len());
        let types = self.iterable_types_worker(ty, usage, error_node);
        // `noCache`
        if !matches!(cached, Some((_, true)))
            && before == self.non_cacheable_mark()
            // A frame that drops its diagnostics reports them when it is evaluated again.
            && !(self.reported.len() > reported
                && self.frames.last().is_some_and(|frame| frame.drops_reported))
        {
            self.iteration_types_cache.insert(key, (types, is_request));
        }
        types
    }

    /// `getIterationTypesOfIterableWorker`
    fn iterable_types_worker(
        &mut self,
        ty: TypeId,
        usage: IterationUse,
        error_node: Option<Place>,
    ) -> Iter3 {
        let (sync, asynchronous) = (usage.allows_sync(), usage.allows_async());
        let for_of = usage.is_for_of();
        // Every member must be iterable. No error is reported for an individual member.
        if self.is_union(ty) {
            let parts = self.parts(ty);
            let mut all = Vec::with_capacity(parts.len());
            for &part in parts {
                let types = self.iterable_types_worker(part, usage, None);
                if !types.has_types() {
                    self.report_type_not_iterable(error_node, ty, asynchronous, for_of, Vec::new());
                    return Iter3::default();
                }
                all.push(types);
            }
            return self.combine_iteration_types(&all);
        }
        if sync && let Some(element) = self.yield_type_by_default_library(ty) {
            let types = Iter3 {
                y: Some(element),
                r: Some(self.builtin_iterator_return()),
                n: Some(TypeId::UNKNOWN),
            };
            return if asynchronous {
                self.async_from_sync(types, error_node)
            } else {
                types
            };
        }
        let mut diags = Vec::new();
        if asynchronous {
            let names = [
                known::AsyncIterable,
                known::AsyncIteratorObject,
                known::AsyncIterableIterator,
                known::AsyncGenerator,
            ];
            let types = self.iteration_types_of_global_reference(ty, names, true);
            if types.has_types() {
                return if for_of {
                    self.async_from_sync(types, error_node)
                } else {
                    types
                };
            }
            let types = self.iterable_types_slow(ty, true, error_node, &mut diags);
            if types.has_types() {
                self.reported.append(&mut diags);
                return types;
            }
        }
        if sync {
            let names = [
                known::Iterable,
                known::IteratorObject,
                known::IterableIterator,
                known::Generator,
            ];
            let mut types = self.iteration_types_of_global_reference(ty, names, false);
            if !types.has_types() {
                types = self.iterable_types_slow(ty, false, error_node, &mut diags);
                if types.has_types() {
                    self.reported.append(&mut diags);
                }
            }
            if types.has_types() {
                return if asynchronous {
                    self.async_from_sync(types, error_node)
                } else {
                    types
                };
            }
        }
        self.report_type_not_iterable(error_node, ty, asynchronous, for_of, diags);
        Iter3::default()
    }

    /// FOR SPEED: the yield type of `ty`, an array, a tuple or a string-like type, as
    /// lib.es2015.iterable.d.ts declares the `[Symbol.iterator]` of `Array`, `ReadonlyArray` and
    /// `String`. `None`: `ty` is something else, or the members of its interface decide.
    fn yield_type_by_default_library(&mut self, ty: TypeId) -> Option<TypeId> {
        let (interface, arity, element) = match self.data(ty) {
            TypeData::Tuple {
                flags, readonly, ..
            } => {
                let interface = if *readonly {
                    known::ReadonlyArray
                } else {
                    known::Array
                };
                let elems = self.type_arguments(ty);
                (interface, 1, self.tuple_element_union(elems, flags))
            }
            TypeData::Ref { target, .. } => (
                self.files().symbol(*target).name,
                1,
                self.array_element(ty)?,
            ),
            _ if self.is_string_like(ty) => (known::String, 0, TypeId::STRING),
            _ => return None,
        };
        self.has_iteration_methods_of_default_library(interface, arity)
            .then_some(element)
    }

    /// Whether the default library alone declares the `[Symbol.iterator]` of the global interface
    /// `getGlobalType(name, arity)`, and nothing a `[Symbol.asyncIterator]`: that library declares
    /// `Iterable`, and no other file adds a member with a computed name to the interface.
    fn has_iteration_methods_of_default_library(&self, name: Atom, arity: usize) -> bool {
        let files = self.files();
        // A library can be any file.
        if files.options.lib_replacement {
            return false;
        }
        let is_lib = |file: FileId| files.module(file).is_lib;
        let (Some(iterable), Some(interface)) = (
            files.global_type_of_arity(known::Iterable, 3),
            files.global_type_of_arity(name, arity),
        ) else {
            return false;
        };
        files.decls_of(iterable).iter().any(|it| is_lib(it.0))
            && files
                .decls_of(interface)
                .iter()
                .all(|&(file, declaration)| {
                    let hir = files.hir(file);
                    is_lib(file)
                        || declaration
                            .members_of_class_or_interface(hir)
                            .is_none_or(|members| {
                                !members
                                    .iter()
                                    .any(|m| matches!(hir[m].key, PropKey::Computed(_)))
                            })
                })
    }

    /// The end of `getIterationTypesOfIterableWorker`: `ty` is not iterable, and `diags` becomes
    /// the related information of that error. "We defer the diagnostic because TypeToString may
    /// attempt to resolve symbols that are already being resolved".
    fn report_type_not_iterable(
        &mut self,
        error_node: Option<Place>,
        ty: TypeId,
        allows_async: bool,
        for_of: bool,
        diags: Vec<Reported>,
    ) {
        if let Some(error_node) = error_node {
            let mut callback = Reported::bare(error_node, type_not_iterable_code(allows_async));
            callback.deferred = Some(super::sink::TypeNotIterable {
                ty,
                allows_async,
                is_of_for_of: for_of,
            });
            callback.related_information = diags;
            self.add_deferred_diagnostic(callback);
        }
    }

    /// `produceDeferredDiagnostics`, for the callbacks of `report_type_not_iterable`. No query is
    /// in progress: those of the task are in `reported`, those of queries in `task.diagnostics`.
    /// `logged`: the length of `task.diagnostics` when `save_deferred_diagnostics` was set.
    pub(super) fn produce_type_not_iterable_errors(&mut self, logged: usize) {
        self.save_deferred_diagnostics = false;
        for i in 0..self.reported.len() {
            if self.reported[i].deferred.is_some() {
                let diagnostic = self.call_deferred_diagnostic(self.reported[i].clone());
                self.reported[i] = diagnostic;
            }
        }
        for i in logged..self.task.diagnostics.len() {
            if self.task.diagnostics[i].1.deferred.is_some() {
                let diagnostic = self.call_deferred_diagnostic(self.task.diagnostics[i].1.clone());
                self.task.diagnostics[i].1 = diagnostic;
            }
        }
    }

    /// Calls `callback`, and returns it as the diagnostic.
    fn call_deferred_diagnostic(&mut self, mut callback: Reported) -> Reported {
        let Some(deferred) = callback.deferred.take() else {
            return callback;
        };
        let diagnostic = self.type_not_iterable_error(
            (callback.file, callback.start, callback.end),
            deferred.ty,
            deferred.allows_async,
            deferred.is_of_for_of,
        );
        callback.args = diagnostic.args;
        let diags = std::mem::replace(
            &mut callback.related_information,
            diagnostic.related_information,
        );
        callback.related_information.extend(diags);
        callback
    }

    /// `getBuiltinIteratorReturnType`
    fn builtin_iterator_return(&self) -> TypeId {
        if self.p.files.options.strict_builtin_iterator_return {
            TypeId::UNDEFINED
        } else {
            TypeId::ANY
        }
    }

    /// `getIterationTypesOfIterableFast`, `getIterationTypesOfIteratorFast`: for an instantiation
    /// of one of the global types `names`, or of one of the library's iterators for its built-in
    /// collections, the iteration types are read from the type arguments.
    fn iteration_types_of_global_reference(
        &mut self,
        ty: TypeId,
        names: [Atom; 4],
        is_async: bool,
    ) -> Iter3 {
        if !matches!(self.data(ty), TypeData::Ref { .. }) {
            return Iter3::default();
        }
        for name in names {
            if let Some(&[y, r, n]) = self.is_global_ref(ty, name, 3) {
                return self.resolved_iteration_types(y, r, n, is_async);
            }
        }
        const BUILTIN: [&[u8]; 4] = [
            b"ArrayIterator",
            b"MapIterator",
            b"SetIterator",
            b"StringIterator",
        ];
        const BUILTIN_ASYNC: [&[u8]; 1] = [b"ReadableStreamAsyncIterator"];
        let builtin: &[&[u8]] = if is_async { &BUILTIN_ASYNC } else { &BUILTIN };
        for &name in builtin {
            if let Some(name) = self.atoms().lookup(name)
                && let Some(&[y]) = self.is_global_ref(ty, name, 1)
            {
                let r = self.builtin_iterator_return();
                return self.resolved_iteration_types(y, r, TypeId::UNKNOWN, is_async);
            }
        }
        Iter3::default()
    }

    /// `getResolvedIterationTypes`: an async iterator awaits its yield type and its return type. A
    /// type that cannot be awaited is left unchanged.
    fn resolved_iteration_types(
        &mut self,
        y: TypeId,
        r: TypeId,
        n: TypeId,
        is_async: bool,
    ) -> Iter3 {
        if !is_async {
            return Iter3 {
                y: Some(y),
                r: Some(r),
                n: Some(n),
            };
        }
        let y = self.awaited_or_none(y).unwrap_or(y);
        let r = self.awaited_or_none(r).unwrap_or(r);
        Iter3 {
            y: Some(y),
            r: Some(r),
            n: Some(n),
        }
    }

    /// `combineIterationTypes`: for each kind, the union of the types that are present.
    fn combine_iteration_types(&mut self, all: &[Iter3]) -> Iter3 {
        let (mut y, mut r, mut n) = (Vec::new(), Vec::new(), Vec::new());
        for types in all {
            y.extend(types.y);
            r.extend(types.r);
            n.extend(types.n);
        }
        let mut union_of = |types: Vec<TypeId>| {
            if types.is_empty() {
                None
            } else {
                Some(self.union(&types))
            }
        };
        Iter3 {
            y: union_of(y),
            r: union_of(r),
            n: union_of(n),
        }
    }

    /// `getAsyncFromSyncIterationTypes`
    fn async_from_sync(&mut self, types: Iter3, error_node: Option<Place>) -> Iter3 {
        let any = Some(TypeId::ANY);
        if !types.has_types() || (types.y == any && types.r == any && types.n == any) {
            return types;
        }
        // "if we're requesting diagnostics, report errors for a missing `Awaited<T>`."
        if error_node.is_some() {
            self.get_global_type_alias_symbol(known::Awaited, 1, true);
        }
        // tsgo passes no message, and panics for a type that has a callable `then` and is not a
        // promise. The message is that of `resolveIterationType`.
        let error = error_node.map(|error_node| (error_node, 1320));
        let y = types.y.and_then(|y| self.awaited_type_ex(y, error));
        let r = types.r.and_then(|r| self.awaited_type_ex(r, error));
        let (y, r) = (y.unwrap_or(TypeId::ANY), r.unwrap_or(TypeId::ANY));
        Iter3 {
            y: Some(y),
            r: Some(r),
            n: types.n,
        }
    }

    /// `getIterationTypesOfIterableSlow`
    fn iterable_types_slow(
        &mut self,
        ty: TypeId,
        is_async: bool,
        error_node: Option<Place>,
        diagnostic_output: &mut Vec<Reported>,
    ) -> Iter3 {
        // `getPropertyNameForKnownSymbolName`
        let name = if is_async {
            self.resolve_known_symbol(b"asyncIterator");
            known::sym_async_iterator
        } else {
            self.resolve_known_symbol(b"iterator");
            known::sym_iterator
        };
        let Some((method, false)) = self.declared_property(ty, name) else {
            return Iter3::default();
        };
        if self.is_any(method) {
            return Iter3::all(method);
        }
        // The intersection of the return types of its call signatures that accept zero arguments.
        let mut iterators = Vec::new();
        let all_signatures = self.signatures(method, false);
        for &sig in &all_signatures {
            let params = self.sig_params(sig);
            if self.min_argument_count(&params) == 0 {
                iterators.push(self.sig_return(sig));
            }
        }
        if iterators.is_empty() {
            let iterable = if is_async {
                known::AsyncIterable
            } else {
                known::Iterable
            };
            // `getGlobalIterableTypeChecked`
            if error_node.is_some()
                && !all_signatures.is_empty()
                && let Some(iterable) = self.global_type_of_arity(iterable, 3)
            {
                let iterable = self.declared_type(iterable);
                let output = Some(diagnostic_output);
                self.check_type_assignable_to_ex(ty, iterable, error_node, None, output);
            }
            return Iter3::default();
        }
        let iterator = self.intersection(&iterators);
        self.iterator_types(iterator, is_async, error_node, Some(diagnostic_output))
    }

    /// `getIterationTypesOfIterator`
    pub(super) fn iterator_types(
        &mut self,
        ty: TypeId,
        is_async: bool,
        error_node: Option<Place>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> Iter3 {
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        let names = if is_async {
            [
                known::AsyncIterator,
                known::AsyncIteratorObject,
                known::AsyncIterableIterator,
                known::AsyncGenerator,
            ]
        } else {
            [
                known::Iterator,
                known::IteratorObject,
                known::IterableIterator,
                known::Generator,
            ]
        };
        let types = self.iteration_types_of_global_reference(ty, names, is_async);
        if types.has_types() {
            return types;
        }
        // `getIterationTypesOfIteratorSlow`
        let all = [
            IteratorMethod::Next,
            IteratorMethod::Return,
            IteratorMethod::Throw,
        ]
        .map(|which| {
            let output = diagnostic_output.as_deref_mut();
            self.iteration_types_of_method(ty, is_async, which, error_node, output)
        });
        self.combine_iteration_types(&all)
    }

    /// `getIterationTypesOfMethod`: the iteration types implied by the `next`, `return` or `throw`
    /// method of the iterator `ty`.
    fn iteration_types_of_method(
        &mut self,
        ty: TypeId,
        is_async: bool,
        which: IteratorMethod,
        error_node: Option<Place>,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> Iter3 {
        let is_next = which == IteratorMethod::Next;
        let name = match which {
            IteratorMethod::Next => known::next,
            IteratorMethod::Return => self.atoms().intern(b"return"),
            IteratorMethod::Throw => self.atoms().intern(b"throw"),
        };
        let found = self.declared_property(ty, name);
        // `return` and `throw` may be missing.
        if found.is_none() && !is_next {
            return Iter3::default();
        }
        let mut method = TypeId::NEVER;
        if let Some((declared, is_optional)) = found
            && !(is_next && is_optional)
        {
            // `TypeFactsNEUndefinedOrNull`
            method = if is_next {
                declared
            } else {
                self.filter(declared, |c, m| !c.is_nullish(m))
            };
            if self.is_any(method) {
                return Iter3::all(method);
            }
        }
        let signatures = self.signatures(method, false);
        if signatures.is_empty() {
            if let Some(error_node) = error_node {
                let code = match (is_next, is_async) {
                    (true, false) => 2489,
                    (true, true) => 2519,
                    (false, false) => 2767,
                    (false, true) => 2768,
                };
                let diagnostic = self.new_diagnostic(error_node, code, &[Arg::Atom(name)]);
                self.report_diagnostic(diagnostic, diagnostic_output);
            }
            return Iter3::default();
        }
        // The method of that name declared by the global `Generator` or `Iterator` itself uses
        // their type arguments, which do not include the `undefined` of an optional parameter.
        if let TypeData::Fns { decls, mapper } = self.data(method)
            && let [(of, func)] = decls[..]
            && let FnOwner::Member(member) = self.bound(of).fns[func.idx()].owner
            && let crate::bind::MemberOwner::Interface(interface) =
                self.bound(of).member_owner[member.idx()]
            && self.hir(of)[member].key.name() == Some(name)
        {
            let mapper = *mapper;
            let owner = self
                .files()
                .sym(of, self.bound(of).interface_symbol[interface.idx()]);
            let (generator, iterator) = if is_async {
                (known::AsyncGenerator, known::AsyncIterator)
            } else {
                (known::Generator, known::Iterator)
            };
            // A method's mapper maps the type parameters of its enclosing declaration.
            let own = self.hir(of)[interface].type_params;
            if own.len() == 3
                && (self.global_type_of_arity(generator, 3) == Some(owner)
                    || self.global_type_of_arity(iterator, 3) == Some(owner))
            {
                let (y, r, n) = (
                    self.type_param(of, own.at(0)),
                    self.type_param(of, own.at(1)),
                    self.type_param(of, own.at(2)),
                );
                return Iter3 {
                    y: Some(self.instantiate(y, mapper)),
                    r: Some(self.instantiate(r, mapper)),
                    n: if is_next {
                        Some(self.instantiate(n, mapper))
                    } else {
                        None
                    },
                };
            }
        }
        let (mut parameters, mut results) = (Vec::new(), Vec::new());
        for &sig in &signatures {
            let params = self.sig_params(sig);
            if which != IteratorMethod::Throw && !params.is_empty() {
                // `getTypeAtPosition`
                parameters.push(self.param_type_at(&params, 0).unwrap_or(TypeId::ANY));
            }
            results.push(self.sig_return(sig));
        }
        // `resolveIterationType`
        let awaiting = error_node.map(|error_node| (error_node, 1320));
        let mut returned = Vec::new();
        let mut next = None;
        if which != IteratorMethod::Throw {
            let parameter = if parameters.is_empty() {
                TypeId::UNKNOWN
            } else {
                self.union(&parameters)
            };
            if is_next {
                // The parameter type of `next` is not awaited. That of `return` is.
                next = Some(parameter);
            } else {
                returned.push(if is_async {
                    self.awaited_type_ex(parameter, awaiting)
                        .unwrap_or(TypeId::ANY)
                } else {
                    parameter
                });
            }
        }
        let result = self.intersection(&results);
        let result = if is_async {
            self.awaited_type_ex(result, awaiting)
                .unwrap_or(TypeId::ANY)
        } else {
            result
        };
        let types = self.iteration_types_of_iterator_result(result);
        let mut yielded = types.y;
        if types.has_types() {
            returned.extend(types.r);
        } else {
            if let Some(error_node) = error_node {
                let code = if is_async { 2547 } else { 2490 };
                let diagnostic = self.new_diagnostic(error_node, code, &[Arg::Atom(name)]);
                self.report_diagnostic(diagnostic, diagnostic_output);
            }
            yielded = Some(TypeId::ANY);
            returned.push(TypeId::ANY);
        }
        Iter3 {
            y: yielded,
            r: if returned.is_empty() {
                None
            } else {
                Some(self.union(&returned))
            },
            n: next,
        }
    }

    /// `getIterationTypesOfIteratorResult`: the yield and return types implied by `ty`, the return
    /// type of `next`.
    fn iteration_types_of_iterator_result(&mut self, ty: TypeId) -> Iter3 {
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        if let Some(name) = self.atoms().lookup(b"IteratorYieldResult")
            && let Some(&[value]) = self.is_global_ref(ty, name, 1)
        {
            return Iter3 {
                y: Some(value),
                ..Iter3::default()
            };
        }
        if let Some(name) = self.atoms().lookup(b"IteratorReturnResult")
            && let Some(&[value]) = self.is_global_ref(ty, name, 1)
        {
            return Iter3 {
                r: Some(value),
                ..Iter3::default()
            };
        }
        let yielded = self.value_of_iterator_results(ty, TypeId::FALSE);
        let returned = self.value_of_iterator_results(ty, TypeId::TRUE);
        if yielded.is_none() && returned.is_none() {
            return Iter3::default();
        }
        // An iterator that returns no value may omit `value` in its final result.
        Iter3 {
            y: yielded,
            r: Some(returned.unwrap_or(TypeId::VOID)),
            n: None,
        }
    }

    /// The `value` type of the members of `ty` whose `done` can be `done`, which is `false` while
    /// iteration continues and `true` at the end (`isIteratorResult`). An omitted `done` counts as
    /// `false`.
    fn value_of_iterator_results(&mut self, ty: TypeId, done: TypeId) -> Option<TypeId> {
        let results = self.filter(ty, |c, m| {
            let declared = c
                .declared_property(m, known::done)
                .map_or(TypeId::FALSE, |found| found.0);
            c.is_assignable(done, declared)
        });
        if results.is_never() {
            None
        } else {
            self.declared_property(results, known::value)
                .map(|found| found.0)
        }
    }
}
