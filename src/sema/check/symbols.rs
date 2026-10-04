//! The types of named values: variables, parameters, functions, classes, imports; and the return
//! types of functions.

use super::decl::declarations_of;
use super::mapped::AccessNode;
use super::related::Place;
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeId, ScopeKind, UNREACHABLE};
use smallvec::SmallVec;
use std::rc::Rc;

/// `WideningContext`
pub(super) struct WideningContext<'p> {
    parent: Option<usize>,
    property_name: Atom,
    siblings: Option<Rc<[TypeId]>>,
    resolved_properties: Option<Rc<[&'p Prop]>>,
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
    ForOf,
    ForAwaitOf,
    Spread,
    Destructuring,
    YieldStar,
    AsyncYieldStar,
}

impl IterationUse {
    /// `IterationUseAllowsAsyncIterablesFlag`
    pub(super) fn allows_async(self) -> bool {
        matches!(
            self,
            IterationUse::ForAwaitOf | IterationUse::AsyncYieldStar
        )
    }

    /// `IterationUseForOfFlag`, which always comes with `IterationUseAllowsStringInputFlag`.
    fn is_for_of(self) -> bool {
        matches!(self, IterationUse::ForOf | IterationUse::ForAwaitOf)
    }

    /// The error code reported when `next` does not accept the sent type.
    fn code_for_sent_type(self) -> u32 {
        match self {
            IterationUse::ForOf | IterationUse::ForAwaitOf => 2763,
            IterationUse::Spread => 2764,
            IterationUse::Destructuring => 2765,
            IterationUse::YieldStar | IterationUse::AsyncYieldStar => 2766,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum IteratorMethod {
    Next,
    Return,
    Throw,
}

impl<'p> Checker<'p> {
    /// The type of `sym` as a value.
    #[inline]
    pub fn type_of_symbol(&mut self, sym: Sym) -> TypeId {
        if let Some(known) = self.p.symbol_types.get(&mut self.task, &sym) {
            return known;
        }
        self.resolve_type_of_symbol(sym)
    }

    #[inline(never)]
    fn resolve_type_of_symbol(&mut self, sym: Sym) -> TypeId {
        let value_declaration = self.files().value_declaration(sym);
        // A parameter property has the type of its parameter, which is a separate query.
        if let Some((file, Decl::ParameterProperty(p))) = value_declaration {
            let scope = self.begin_scope();
            let ty = self.type_of_param(file, p);
            // Cached here once it is cached there, because every `this.x` queries it. The cached value is copied: `ty` can be
            // provisional while the final type is stored.
            let pat = self.hir(file)[p].pat;
            let cached = (self.p.pat_types.get(&mut self.task, &(file, pat))).map(|(ty, _)| ty);
            if let (Ok(stored), Some(cached)) = (self.end_scope(scope), cached) {
                self.p
                    .symbol_types
                    .insert(&mut self.task, sym, cached, stored);
            }
            return ty;
        }
        // Before the query is entered: `lateBindMember` resolves the names of the other members,
        // which may re-enter this query.
        let mut members = SmallVec::new();
        if self.files().flags(sym).intersects(SymFlags::CLASS_MEMBER) {
            members = self.members_of_symbol(sym);
            if let Some(known) = self.p.symbol_types.get(&mut self.task, &sym) {
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
            return self.type_of_circular_symbol(sym, None);
        }
        if let Some(raw) = self.provisional(Query::Symbol(sym)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::Symbol(sym)) {
            if !self.found_cycle {
                return TypeId::UNRESOLVED;
            }
            let ty = self.type_of_circular_symbol(sym, None);
            // `getTypeOfVariableOrParameterOrProperty` caches what `reportCircularityError`
            // returns: the next caller gets that result.
            return match value_declaration {
                Some((_, Decl::Expando(_) | Decl::ThisProperty(_))) => {
                    let stored = self.cycle_result();
                    self.p.symbol_types.insert(&mut self.task, sym, ty, stored)
                }
                _ => ty,
            };
        }
        // `checkExpressionCached` has no guard against re-entry: the descriptor is checked again from the start.
        let resolution_start = self.resolution_start;
        if in_report {
            self.resolution_start = self.stack.len() - 1;
        }
        let ty = match members.is_empty() {
            true => self.type_of_symbol_uncached(sym),
            false => self.type_of_members_uncached(&members),
        };
        self.resolution_start = resolution_start;
        let left = self.leave(Query::Symbol(sym));
        if self.left_a_cycle {
            let ty = self.type_of_circular_symbol(sym, Some(ty));
            let stored = self.cycle_result();
            let kept = self.p.symbol_types.insert(&mut self.task, sym, ty, stored);
            let flags = self.files().flags(sym);
            if let Some((file, Decl::Member(first))) = value_declaration {
                if flags.intersects(SymFlags::ACCESSOR) {
                    self.report_circular_accessors(sym, &members);
                } else {
                    let (hir, end) = (self.hir(file), self.end_of_member_name(file, first));
                    let start = hir[first].name_pos;
                    let name = Arg::Bytes(&hir.text[start as usize..end as usize]);
                    let at = (file, start, end);
                    self.report_circularity_error(Query::Symbol(sym), at, name, ty, false);
                }
            } else if let Some((
                file,
                Decl::Expando(declaration) | Decl::ThisProperty(declaration),
            )) = value_declaration
            {
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
                self.report_circularity_error(Query::Symbol(sym), at, name, ty, false);
            // `getTypeOfAlias` reports a cycle through a symbol that is only an alias at the target
            // of the alias.
            } else if flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY)
                && let Some(at) = self.place_of_export_value_declaration(sym)
            {
                self.report_circularity_error(Query::Symbol(sym), at, Arg::Sym(sym), ty, false);
            }
            return kept;
        }
        match left {
            Ok(stored) => {
                self.p.symbol_types.insert(&mut self.task, sym, ty, stored);
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

    /// `report_circularity_error` for the variable, parameter or binding element whose name is
    /// `pat`.
    pub(super) fn report_circularity_error_of_pat(
        &mut self,
        owner: Query,
        file: FileId,
        pat: PatId,
    ) {
        let hir = self.hir(file);
        let PatKind::Ident(name) = hir[pat].kind else {
            return;
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
        let (at, name) = ((file, start, end), Arg::Atom(name));
        self.report_circularity_error(owner, at, name, ty, is_bare_parameter);
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

    /// The type of `sym` when the resolution of its type depends on itself. `resolved`: the
    /// resolved type, if `popTypeResolution` found the cycle. `None`: `pushTypeResolution` found
    /// it.
    fn type_of_circular_symbol(&self, sym: Sym, resolved: Option<TypeId>) -> TypeId {
        let flags = self.files().flags(sym);
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
                let value = self.files().module_value(module);
                return self.type_of_symbol(value);
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
                props: vec![prop],
                ..Shape::default()
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
                        return self.intern(TypeData::Fns {
                            decls: Box::new([(file, f)]),
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
                    let ty = self.type_of_expr(file, e);
                    return if self.hir(file).kind == FileKind::Json {
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
        let (mut expandos, mut exports) = (Vec::new(), Vec::new());
        // Every class, function and enum reaches this point: late binding only adds to symbols that
        // assignments declare.
        let declarations = match self.files().flags(sym).contains(SymFlags::ASSIGNMENT) {
            true => self.declarations_of_property(sym),
            false => self.files().decls_of(sym),
        };
        for &(file, decl) in declarations.iter() {
            match decl {
                Decl::Expando(e) | Decl::ThisProperty(e) if file == sym.file => expandos.push(e),
                Decl::ModuleExports(e) | Decl::ExportsProperty(e) if file == sym.file => {
                    exports.push(e)
                }
                _ => {}
            }
        }
        let name = self.files().symbol(sym).name;
        // `SetValueDeclaration`: an assignment yields to any other value declaration.
        let others = SymFlags::VALUE.difference(SymFlags::PROPERTY);
        if !expandos.is_empty() && !self.files().flags(sym).intersects(others) {
            let first = expandos[0];
            return Some(
                self.get_widened_type_for_assignment_declaration(sym.file, name, &expandos, first),
            );
        }
        let value_declaration = self
            .commonjs_value_declaration(self.files().symbol(sym))
            .or_else(|| exports.first().copied())?;
        Some(self.get_widened_type_for_assignment_declaration(
            sym.file,
            name,
            &exports,
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
        for _ in 0..32 {
            if !files.flags(at).contains(SymFlags::ALIAS) {
                return AliasTarget::Symbol(at);
            }
            // `resolveESModuleSymbol`. No symbol is created for the copy of a target that has none
            // itself: `export = a`, where `a` resolves to a property.
            if let Some(ty) = self.type_of_namespace_import(at) {
                return match files.module_clone(at) {
                    Some(clone) => AliasTarget::Symbol(clone),
                    None => AliasTarget::Property(TypeId::NEVER, files.symbol(at).name, ty),
                };
            }
            let links = files.alias_links(at);
            if links.is_circular {
                return AliasTarget::Unknown;
            }
            let Some(next) = links.immediate_target else {
                return match self.symbol_from_variable(at) {
                    Some((object, name, ty)) => AliasTarget::Property(object, name, ty),
                    None => self.resolved_symbol_of_alias_like_expression(at),
                };
            };
            if let Some(combined) = self.combined_symbol_of_alias(at) {
                return AliasTarget::Symbol(combined);
            }
            // As in `aliasTarget` of the symbol links: a target resolved while symbols were merged is the symbol that
            // existed at that time.
            if next == at || !files.is_non_local_alias(next) {
                return AliasTarget::Symbol(next);
            }
            at = next;
        }
        AliasTarget::Unknown
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
    /// not resolve aliases the `resolvedSymbol` that checking `e` records.
    fn resolved_symbol_of_alias_like_expression(&mut self, sym: Sym) -> AliasTarget {
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
                    && let Some((prop, mapper)) = self.property_of_type(&members, name)
                {
                    return AliasTarget::Property(object, name, self.type_of_prop(&prop, mapper));
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
        let lookup = &mut |_, held, meaning| self.get_symbol(held, meaning);
        let found = files.resolve_entity_with(file, scope, &texts, meaning, !ignore_errors, lookup);
        if found.is_none() && !ignore_errors {
            self.report_unresolved_entity_name(file, scope, names, meaning);
        }
        found
    }

    /// `resolveAlias` of `sym`, where it resolves to a property.
    pub(super) fn property_of_alias(&mut self, sym: Sym) -> Option<&'p Prop> {
        let AliasTarget::Property(object, name, _) = self.resolve_alias(sym) else {
            return None;
        };
        // `getReducedApparentType`
        let apparent = self.reduced_apparent_type(object);
        Some(self.prop_ref(apparent, name)?.0)
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
        let mode = self.files().mode_of_import(file, import.mode);
        let module = self
            .files()
            .module_of_specifier_as(file, import.spec, mode)?;
        let value = self.files().module_value(module);
        let ty = self.type_of_symbol(value);
        let files = self.files();
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
        if is_file_to_node
            && (files.hir(module.file).kind == FileKind::Json
                || files.module(module.file).path.ends_with(b".d.json.ts"))
        {
            let default = Prop {
                name: known::default,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            };
            return Some(self.synth(Shape {
                props: vec![default],
                default_of: Some(module),
                ..Shape::default()
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
            && self.prop_ref(ty, known::default).is_none()
            && !files.is_commonjs_to_node(file, module)
        {
            return None;
        }
        let with_default = self.can_have_synthetic_default(file, module);
        Some(self.intern(TypeData::Anon {
            origin: Origin::Namespace {
                module: value,
                with_default,
                originating_import: sym,
            },
            mapper: MapperId::IDENTITY,
        }))
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
        let value = files.module_value(module);
        let resolve_export_by_name = &mut |name| {
            let ty = self.type_of_symbol(value);
            let apparent = self.reduced_apparent_type(ty);
            let (prop, _) = self.prop_ref(apparent, name)?;
            Some(
                matches!(prop.source, PropSource::Symbol(symbol) if files.has_syntactic_default(symbol)),
            )
        };
        files
            .synthetic_default_with(usage, module, resolve_export_by_name)
            .is_some()
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
        let (ty, name) = self.imported_from_export_equals(sym)?;
        Some((ty, name, self.type_of_own_property(ty, name)?))
    }

    /// `getPropertyOfTypeEx(ty, name, skipObjectFunctionPropertyAugment)`, and its type: the
    /// properties of every object and every function do not count, nor does an index signature.
    /// `any` has none.
    pub(super) fn type_of_own_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        if self.is_any(ty) {
            return None;
        }
        let (prop, mapper) = self.get_property_of_type_ex(ty, name, true)?;
        Some(self.type_of_prop(prop, mapper))
    }

    /// The type of the value and the name `a`, for the same.
    fn imported_from_export_equals(&mut self, sym: Sym) -> Option<(TypeId, Atom)> {
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
            let value = files.module_value(module);
            if value == module {
                continue;
            }
            return Some((self.type_of_symbol(value), name));
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
    fn widened_for_declaration(&mut self, ty: TypeId, name: Option<(FileId, PatId)>) -> TypeId {
        let ty = if matches!(self.data(ty), TypeData::UniqueSymbol { .. }) {
            TypeId::SYMBOL
        } else {
            ty
        };
        let widened = self.get_widened_type(ty);
        // `getTypeOfVariableOrParameterOrPropertyWorker` goes by `symbol.ValueDeclaration`.
        if let Some((file, pat)) = name
            && self.contains_widening_type(ty, 0)
            && self.value_declaration_of_variable_name(file, pat) == (file, pat)
            && self.report_errors_from_widening(ty)
        {
            self.report_implicit_any_of_name(file, pat, widened);
        }
        widened
    }

    /// `t.objectFlags&ObjectFlagsContainsWideningType != 0`. No type has it under strictNullChecks.
    pub(super) fn contains_widening_type(&self, ty: TypeId, depth: u32) -> bool {
        if self.p.files.options.strict_null_checks || depth > 8 {
            return false;
        }
        match self.data(ty) {
            // `createWideningType`
            _ if ty == TypeId::NULL_WIDENING || ty == TypeId::UNDEFINED_WIDENING => true,
            // `getPropagatingFlagsOfTypes`
            TypeData::Union(list)
            | TypeData::Intersection(list)
            | TypeData::Tuple {
                elems: TypeArguments::Given(list),
                ..
            }
            | TypeData::Ref {
                args: TypeArguments::Given(list),
                ..
            } => list
                .iter()
                .any(|&t| self.contains_widening_type(t, depth + 1)),
            TypeData::Anon {
                origin: Origin::ObjectLiteral(.., object_flags, _),
                ..
            } => object_flags.contains(ObjectFlags::CONTAINS_WIDENING_TYPE),
            TypeData::Synth(shape) => shape.contains_widening_type,
            _ => false,
        }
    }

    /// `reportErrorsFromWidening`. Returns whether `reportImplicitAny` remains to be called, which
    /// is left to the caller that knows the declaration.
    pub(super) fn report_errors_from_widening(&mut self, ty: TypeId) -> bool {
        self.p.files.options.no_implicit_any
            && self.contains_widening_type(ty, 0)
            && !self.report_widening_errors_in_type(ty)
    }

    /// `reportWideningErrorsInType`: 7018
    fn report_widening_errors_in_type(&mut self, ty: TypeId) -> bool {
        if !self.contains_widening_type(ty, 0) {
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
                    if !self.contains_widening_type(of_prop, 0) {
                        continue;
                    }
                    error_reported = self.report_widening_errors_in_type(of_prop);
                    if error_reported {
                        continue;
                    }
                    // "we need to account for property types coming from object literal type normalization in unions"
                    let written = Self::declared_properties(&[prop])
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
        if !self.p.files.options.no_implicit_any || !self.contains_widening_type(ty, 0) {
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
                WideningKind::FunctionReturn if is_async => Some(self.awaited(returned)),
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

    /// `reportImplicitAny` for the variable, the parameter or the binding element whose name is
    /// `pat` and whose type resolves to `ty`: 7005, 7006 7019 7051, 7031. Not where
    /// `declarationBelongsToPrivateAmbientMember`.
    pub(super) fn report_implicit_any_of_name(&mut self, file: FileId, pat: PatId, ty: TypeId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.p.files.options.no_implicit_any || hir.is_js && !self.is_check_js(file) {
            return;
        }
        if let PatParent::Param(root) = root_declaration(bound, pat) {
            let func = bound.param_fn[root.idx()];
            if self.is_private_within_ambient(file, func) {
                return;
            }
        }
        let start = hir[pat].pos;
        let is_missing = matches!(
            hir[pat].kind,
            PatKind::Missing | PatKind::Ident(known::empty)
        );
        let (name_end, name) = match hir[pat].kind {
            _ if is_missing => (start, Arg::Bytes(b"(Missing)")),
            PatKind::Ident(name) => (self.end_of_name_at(file, start), Arg::Atom(name)),
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
            let array_name = [atoms.bytes(written), b"[]"].concat();
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
        match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                ..
            } => true,
            TypeData::Synth(shape) => shape.literal.is_of_expression(),
            _ => false,
        }
    }

    /// `isObjectLiteralType(t) && t.objectFlags&ObjectFlagsFreshLiteral != 0`
    #[inline]
    pub fn is_fresh_object_literal_type(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(.., is_fresh),
                ..
            } => *is_fresh,
            TypeData::Synth(shape) => shape.literal.is_of_expression() && !shape.is_regular,
            _ => false,
        }
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

    /// `false`: `t.objectFlags&ObjectFlagsRequiresWidening == 0`. A union has the flags of its
    /// `undefined` and `null` too, which `getPropagatingFlagsOfTypes` leaves out.
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
                None => ty,
            },
            TypeData::Ref {
                target,
                args: TypeArguments::Given(args),
            } if self.is_array(ty) => match self.get_widened_types(args) {
                Some(widened) => self.intern(TypeData::Ref {
                    target: *target,
                    args: widened.to_vec().into(),
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
    fn get_undefined_property(&mut self, prop: &Prop) -> Prop {
        if let Some(cached) = self.undefined_properties.get(&prop.name) {
            return cached.clone();
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
            source: Self::copy_of(missing, &[prop], true),
            mapper: MapperId::IDENTITY,
        };
        self.undefined_properties.insert(prop.name, result.clone());
        result
    }

    /// `getWidenedTypeOfObjectLiteral`
    fn get_widened_type_of_object_literal(&mut self, ty: TypeId, context: Option<usize>) -> TypeId {
        if let Some(context) = context
            && let Some(&cached) = self.widening_contexts[context].widened_types.get(&ty)
        {
            return cached;
        }
        // Without a sibling literal, no nested widening context has anything to add.
        let context = context.filter(|&context| {
            let siblings = self.get_siblings_of_context(context);
            siblings
                .iter()
                .any(|&t| t != ty && self.is_object_literal_type(t))
        });
        let Some(context) = context else {
            // Each property is widened lazily.
            return match self.data(ty) {
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
                    let mut shape = Shape::clone(shape);
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
                    self.synth(shape)
                }
                _ => ty,
            };
        };
        let Some(members) = self.members(ty) else {
            return ty;
        };
        let mut shape = Shape::default();
        for prop in &members.shape().props {
            let widened = self.get_widened_property(prop, members.mapper, context);
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
        if let TypeData::Synth(widened) = self.data(ty) {
            (shape.spread_of, shape.spread_rank) = (widened.spread_of, widened.spread_rank);
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
    fn get_widened_property(&mut self, prop: &Prop, mapper: MapperId, context: usize) -> Prop {
        let original = self.type_of_prop(prop, mapper);
        let stays = prop
            .flags
            .intersects(PropFlags::METHOD | PropFlags::ACCESSOR);
        let widened = if stays || !self.may_require_widening(original) {
            original
        } else {
            let prop_context = self.get_child_context(context, prop.name);
            self.get_widened_type_with_context(original, Some(prop_context))
        };
        Prop {
            name: prop.name,
            flags: prop.flags,
            source: Self::copy_of(widened, &[prop], true),
            mapper: MapperId::IDENTITY,
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
    fn get_properties_of_context(&mut self, context: usize) -> Rc<[&'p Prop]> {
        if let Some(resolved) = &self.widening_contexts[context].resolved_properties {
            return Rc::clone(resolved);
        }
        let mut names: Vec<&'p Prop> = Vec::new();
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
        let resolved: Rc<[&'p Prop]> = names.into();
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
        if let Some((known, _)) = self.p.pat_types.get(&mut self.task, &(file, pat)) {
            return known;
        }
        self.resolve_type_of_pat(file, pat)
    }

    #[inline(never)]
    fn resolve_type_of_pat(&mut self, file: FileId, pat: PatId) -> TypeId {
        if self.prepare_query_for_pat(file, pat)
            && let Some((known, _)) = self.p.pat_types.get(&mut self.task, &(file, pat))
        {
            return known;
        }
        if let Some(raw) = self.provisional(Query::Pat(file, pat)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::Pat(file, pat)) {
            return if self.found_cycle {
                circularity_error_type(self.type_annotation_of_pat(file, pat))
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.type_of_pat_uncached(file, pat);
        let left = self.leave(Query::Pat(file, pat));
        if self.left_a_cycle {
            let stored = self.cycle_result();
            let ty = circularity_error_type(self.type_annotation_of_pat(file, pat));
            // Overwrites the value of an inner evaluation above a `resolution_start` barrier, if
            // one was stored.
            self.p
                .pat_types
                .rewrite(&mut self.task, (file, pat), (ty, true), stored);
            self.report_circularity_error_of_pat(Query::Pat(file, pat), file, pat);
            return ty;
        }
        // `getTypeOfVariableOrParameterOrProperty`: `links.resolvedType` is assigned only if it is nil, and the caller gets `t`.
        match left {
            Ok(stored) => {
                self.p
                    .pat_types
                    .insert(&mut self.task, (file, pat), (ty, false), stored);
            }
            Err(open) => self.cache_provisionally(Query::Pat(file, pat), u64::from(ty.0), open),
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
        let is_circular = (self.p.pat_types.get(&mut self.task, &key))
            .is_some_and(|(_, flag)| flag)
            || self
                .p
                .circular_initializers
                .get(&mut self.task, &key)
                .is_some();
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
        if let Some(any) = self.implicit_any_of_empty_literal(file, whole) {
            self.report_implicit_any_of_name(file, pat, any);
            return any;
        }
        if matches!(root, PatParent::Var(d) if matches!(hir[d].kind, VarKind::Const | VarKind::Using | VarKind::AwaitUsing))
        {
            whole
        } else {
            self.widen_literal(whole)
        }
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
        // `isGenericTypeWithUndefinedConstraint`
        let mut gives_way = false;
        for &m in self.parts(ty) {
            if self.is_deferred(m)
                && let Some(constraint) = self.base_constraint_of(m)
                && self.contains_undefined(constraint)
            {
                gives_way = true;
                break;
            }
        }
        let ty = if gives_way {
            self.map_type(ty, |c, m| {
                if c.is_deferred(m) {
                    c.base_constraint_of(m).unwrap_or(m)
                } else {
                    m
                }
            })
        } else {
            ty
        };
        self.type_with_ne_undefined(ty)
    }

    fn type_of_pat_uncached(&mut self, file: FileId, pat: PatId) -> TypeId {
        let hir = self.hir(file);
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::None => TypeId::UNRESOLVED,
            PatParent::Var(d) => self.type_of_var_decl(file, d),
            PatParent::Param(p) => self.type_of_param_uncached(file, p),
            PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => {
                let parent_ty = self.type_for_binding_element_parent(file, pat, parent);
                let ty = self.type_of_binding_element(file, pat, parent_ty, false);
                // A destructured value is not widened; the elements extracted from it are, once
                // bound to a name.
                if !matches!(hir[pat].kind, PatKind::Ident(_)) {
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
        match bound.pat_parent[parent.idx()] {
            // Without the `undefined` that `?` adds. An annotated `undefined` stays.
            PatParent::Param(p)
                if hir[p].ty.is_some() && hir[p].flags.contains(Flags::OPTIONAL) =>
            {
                self.type_from_node(file, hir[p].ty)
            }
            // The default as it is, not widened. Only the parameters of function expressions and of
            // object literal methods are typed (`assignParameterType`, widened) before their
            // patterns are checked. For a setter the getter determines the type.
            PatParent::Param(p)
                if hir[p].ty.is_none()
                    && hir[p].default.is_some()
                    && hir[bound.param_fn[p.idx()]].kind != FnKind::Setter
                    && !matches!(
                        bound.fns[bound.param_fn[p.idx()].idx()].owner,
                        FnOwner::Expr(_)
                    ) =>
            {
                self.type_from_param_default(file, p)
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
        if let PatParent::Param(p) = root_declaration(bound, pattern) {
            // `NodeFlagsAmbient`
            let mut is_ambient = hir.kind == FileKind::Declaration;
            let mut scope = bound.fns[bound.param_fn[p.idx()].idx()].scope;
            while !is_ambient && scope.is_some() {
                let s = &bound.scopes[scope.idx()];
                is_ambient = match s.kind {
                    ScopeKind::Module(m) => hir[m].flags.contains(Flags::AMBIENT),
                    ScopeKind::Fn(f) => hir[f].flags.contains(Flags::AMBIENT),
                    ScopeKind::Class(c) => hir[c].flags.contains(Flags::AMBIENT),
                    _ => false,
                };
                scope = s.parent;
            }
            if is_ambient {
                return self.non_nullable(ty);
            }
        }
        let initializer = match bound.pat_parent[pattern.idx()] {
            PatParent::Var(d) => hir[d].init,
            PatParent::Param(p) => hir[p].default,
            PatParent::Prop(_, prop) => hir[prop].default,
            PatParent::Elem(_, elem) => hir[elem].default,
            PatParent::None => ExprId::NONE,
        };
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
                    // `getLiteralTypeFromPropertyName`: a computed name that is not the name of a
                    // single property represents every key its type allows. A numeric name is the
                    // number or the string literal type, whichever is in the source, and omits a
                    // property named the same way.
                    let (mut omitted, mut keys) = (Vec::new(), Vec::new());
                    for p in props.iter() {
                        if hir[p].is_rest {
                            continue;
                        }
                        match self.member_name(file, hir[p].key) {
                            Some(name) if self.is_numeric_name(name) => match hir[p].key {
                                PropKey::Computed(e) => {
                                    let key = self.type_of_expr(file, e);
                                    keys.push(self.regular(key));
                                }
                                _ if self.is_numeric_literal_name_in_source(file, hir[p].pos) => {
                                    keys.extend(self.key_type_of_name(name))
                                }
                                _ => keys.push(self.string_literal(name, false)),
                            },
                            Some(name) => omitted.push(name),
                            None => {
                                if let PropKey::Computed(e) = hir[p].key {
                                    let key = self.type_of_expr(file, e);
                                    keys.push(self.regular(key));
                                }
                            }
                        }
                    }
                    let keys = self.union(&keys);
                    // `declaration.Symbol()`
                    let symbol =
                        matches!(hir[pat].kind, PatKind::Ident(_)).then(|| (file, hir[pat].pos));
                    let ty = self.rest_of_object(parent_ty, &omitted, keys, symbol);
                    return self.with_default(file, pat, ty, prop.default);
                }
                let mut access_flags = AccessFlags::EXPRESSION_POSITION;
                let allow_missing = no_tuple_bounds_check || prop.default.is_some();
                access_flags.set(AccessFlags::ALLOW_MISSING, allow_missing);
                // `getLiteralTypeFromPropertyName`
                let index_type = match prop.key {
                    PropKey::Name(name) => self.string_literal(name, false),
                    PropKey::Computed(e) => {
                        let key = self.type_of_expr(file, e);
                        self.regular(key)
                    }
                    PropKey::Private(_) | PropKey::None => return TypeId::UNRESOLVED,
                };
                // An identifier directly in the pattern of `const { a } = require("m")` is an alias
                // (`getTypeOfAlias`): tsgo never looks it up in the initializer, so nothing is
                // reported.
                let is_alias = hir.is_js
                    && matches!(hir[pat].kind, PatKind::Ident(_))
                    && matches!(self.bound(file).pat_parent[parent.idx()], PatParent::Var(d) if self.external_module_require_argument(file, d).is_some());
                let name = if is_alias {
                    AccessNode::Other
                } else {
                    AccessNode::PropertyName(file, id)
                };
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
            let element = self.iterated_type(ty, false);
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
        let element = self.iterated_type(ty, false);
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

    /// Whether the property name that starts at `pos` of `file` is a numeric literal in the source:
    /// `0`, `.5`, `[0]`.
    pub(super) fn is_numeric_literal_name_in_source(&self, file: FileId, pos: u32) -> bool {
        let text = &self.hir(file).text;
        let at = pos as usize;
        let first = match text.get(at) {
            // A computed name starts with its bracket.
            Some(b'[') => text[at + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace() && **b != b'('),
            first => first,
        };
        matches!(first, Some(b'0'..=b'9' | b'.'))
    }

    /// `getRestType`, the type of `...rest`: `ty` without the properties `omitted` and without
    /// those whose name is in `omitted_keys`, the types of the names that are omitted by type: the
    /// computed ones that are not the name of a single property, and the numeric ones (`never`:
    /// there are none). `symbol`: the position of the first declaration of the symbol the type
    /// gets.
    pub fn rest_of_object(
        &mut self,
        ty: TypeId,
        omitted: &[Atom],
        omitted_keys: TypeId,
        symbol: Option<(FileId, u32)>,
    ) -> TypeId {
        if self.is_any(ty) {
            return ty;
        }
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
        let mut is_generic = self.is_generic(ty);
        for &key in self.parts(omitted_keys) {
            is_generic |= !self.is_pattern_literal(key) && self.is_generic(key);
        }
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
            let Some(omit) = self.global_type_symbol(known::Omit) else {
                return TypeId::ERROR;
            };
            return self.type_reference(omit, &[ty, keys]);
        }
        let Some(members) = members else {
            return TypeId::EMPTY_OBJECT;
        };
        let mut shape = Shape::default();
        for i in kept {
            let prop = &members.shape().props[i];
            // `getSpreadSymbol`: a write-only property reads as `undefined`.
            let ty = if prop.flags.contains(PropFlags::WRITE_ONLY) {
                TypeId::UNDEFINED
            } else {
                self.type_of_prop(prop, members.mapper)
            };
            let anew = prop
                .flags
                .intersects(PropFlags::WRITE_ONLY | PropFlags::READONLY);
            shape.props.push(Prop {
                name: prop.name,
                // A copy: a readonly property of the original is writable in it.
                flags: prop.flags
                    & if anew {
                        PropFlags::OPTIONAL | PropFlags::STRING_NAME
                    } else {
                        // `getSpreadSymbol` returns the symbol itself.
                        PropFlags::OPTIONAL | PropFlags::STRING_NAME | PropFlags::METHOD
                    },
                source: Self::copy_of(ty, &[prop], !anew),
                mapper: MapperId::IDENTITY,
            });
        }
        for info in &members.shape().index {
            let value = self.instantiate(info.value, members.mapper);
            shape.index.push(IndexInfo { value, ..*info });
            // Read by `getApplicableIndexSymbol`: `symbol.Parent = t.symbol`.
            shape.symbol_declared_at = symbol.map(|(file, pos)| (file, pos, ExprId::NONE));
        }
        self.synth(shape)
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
                    ) && let Some(name) = self.atoms().lookup(b"Extract")
                        && let Some(extract) = self.files().global(name, SymFlags::TYPE_ALIAS)
                    {
                        return self.type_reference(extract, &[keys, TypeId::STRING]);
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
                    .implied_by_pattern(file, decl.pat, false, true)
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
            && let ExprKind::Call(c) = hir[decl.init].kind
        {
            let callee = match hir[hir[c].callee].kind {
                ExprKind::Dot { obj, name, .. } if self.atoms().bytes(name) == b"for" => obj,
                _ => hir[c].callee,
            };
            // `isSymbolOrSymbolForCall`: it must resolve to the global value of that name, which
            // must exist.
            if matches!(hir[callee].kind, ExprKind::Ident(known::Symbol))
                && self.bound(file).expr_symbol[callee.idx()].is_none()
                && self
                    .files()
                    .global(known::Symbol, SymFlags::VALUE)
                    .is_some()
            {
                return self.unique_symbol_of_variable(file, decl.pat, name);
            }
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

    #[inline]
    pub fn type_of_param(&mut self, file: FileId, p: ParamId) -> TypeId {
        self.type_of_pat(file, self.hir(file)[p].pat)
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
            && let Some(getter) = self.sibling_accessor(file, func, FnKind::Getter)
        {
            let ty = self.return_type_of_fn(file, getter);
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
            // `assignParameterType`: if the contextual type is just `unknown`, the pattern
            // determines the type.
            if ty == TypeId::UNKNOWN && !matches!(hir[param.pat].kind, PatKind::Ident(_)) {
                return self
                    .implied_by_pattern(file, param.pat, false, false)
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
                    let widened = self.widen_literal(actual);
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
            let ty = self.type_from_param_default(file, p);
            // `checkVariableLikeDeclaration` requests the type of a name, `assignParameterType`
            // that of any parameter of a function expression. The type of a pattern in a
            // declaration is requested only by callers that compare the signature.
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
        let report_errors = !self.is_parameter_type_never_requested(file, func, p);
        if let Some(implied) = self.implied_by_pattern(file, param.pat, false, report_errors) {
            return implied;
        }
        // `widenTypeForVariableLikeDeclaration` with no type. `hasBindableName`: the property a
        // setter belongs to may not be known.
        let reports = !matches!(hir[param.pat].kind, PatKind::Missing)
            && (hir[func].kind != FnKind::Setter
                || self.start_of_accessor_name(file, func).is_some());
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
    fn type_from_param_default(&mut self, file: FileId, p: ParamId) -> TypeId {
        let param = &self.hir(file)[p];
        let ty = self.type_of_declaration_initializer(file, param.default);
        let ty = self.padded_for_pattern(file, param.pat, ty);
        if let Some(any) = self.implicit_any_of_empty_literal(file, ty) {
            let func = self.bound(file).param_fn[p.idx()];
            if self.hir(file)[func].kind != FnKind::Setter {
                self.report_implicit_any_of_name(file, param.pat, any);
            }
            return any;
        }
        self.widen_literal(ty)
    }

    /// `padObjectLiteralType`, `padTupleType`: `ty`, the type of the default of a parameter or of a
    /// part of one that `pat` destructures, is padded with the members the pattern has its own
    /// defaults for.
    pub(super) fn padded_for_pattern(&mut self, file: FileId, pat: PatId, ty: TypeId) -> TypeId {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Object(props) if self.is_object_literal_type(ty) => {
                let Some(members) = self.members(ty) else {
                    return ty;
                };
                let mut missing = Vec::new();
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.default.is_some()
                        && !prop.is_rest
                        && let Some(name) = self.member_name(file, prop.key)
                        && members.shape().prop(name).is_none()
                    {
                        missing.push((name, prop.value, prop.default));
                    }
                }
                if missing.is_empty() {
                    return ty;
                }
                // It keeps its kind of literal: with a spread in it, its other properties are still
                // unknown.
                let literal = match self.data(ty) {
                    TypeData::Synth(shape) => shape.literal,
                    _ => Literalness::Literal,
                };
                let mut shape = Shape {
                    literal,
                    is_regular: !self.is_fresh_object_literal_type(ty),
                    contains_widening_type: self.contains_widening_type(ty, 0),
                    symbol_declared_at: self.symbol_declaration_of_object_type(ty),
                    ..Shape::default()
                };
                for prop in &members.shape().props {
                    let ty = self.type_of_prop(prop, members.mapper);
                    shape.props.push(Prop {
                        name: prop.name,
                        flags: prop.flags,
                        source: Self::copy_of(ty, &[prop], true),
                        mapper: MapperId::IDENTITY,
                    });
                }
                for (name, value, default) in missing {
                    let ty = self.type_from_defaulted_element(file, value, default);
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
                        self.type_from_defaulted_element(file, elem.pat, elem.default)
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

    /// `getTypeFromBindingElement` for an element under a parameter that has a default: the type of
    /// the default, padded in turn for `pat`, which the element binds. Only its literals are
    /// widened, and it is optional.
    fn type_from_defaulted_element(&mut self, file: FileId, pat: PatId, default: ExprId) -> TypeId {
        // `checkDeclarationInitializer`
        let contextual_type = self
            .implied_by_pattern(file, pat, true, false)
            .unwrap_or(TypeId::UNKNOWN);
        let ty = self.check_expression_with_contextual_type(
            file,
            default,
            contextual_type,
            None,
            CheckMode::empty(),
        );
        let ty = self.padded_for_pattern(file, pat, ty);
        // `getWidenedLiteralTypeForInitializer`, `addOptionality`
        let ty = self.widen_literal(ty);
        self.optional(ty)
    }

    /// `GetDeclarationOfKind(getSymbolOfDeclaration(accessor), kind)`: the getter, or the setter if
    /// that is `expected`, that shares one symbol with the accessor `func`, in a class, an interface,
    /// a type literal or an object literal.
    pub(super) fn sibling_accessor(
        &mut self,
        file: FileId,
        func: FnId,
        expected: FnKind,
    ) -> Option<FnId> {
        let bound = self.bound(file);
        let accessor = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => Decl::Member(m),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => Decl::Property(p),
                _ => return None,
            },
            _ => return None,
        };
        let hir = self.hir(file);
        self.declarations_of_member(file, accessor)
            .into_iter()
            .filter(|declaration| declaration.0 == file)
            .find_map(|(_, declaration)| {
                let other = match declaration {
                    Decl::Member(m) => hir[m].func,
                    Decl::Property(p) if hir[p].value.is_some() => match hir[hir[p].value].kind {
                        ExprKind::Fn(f) => f,
                        _ => FnId::NONE,
                    },
                    _ => FnId::NONE,
                };
                (other.is_some() && hir[other].kind == expected).then_some(other)
            })
    }

    // ───────────────────────────── return types of functions ─────────────────────────────

    /// The return type of `func` as declared or as inferred from its body, in terms of the type
    /// parameters in scope.
    #[inline]
    pub fn return_type_of_fn(&mut self, file: FileId, func: FnId) -> TypeId {
        if let Some((known, _)) = self.p.fn_return_types.get(&mut self.task, &(file, func)) {
            return known;
        }
        self.resolve_return_type_of_fn(file, func)
    }

    #[inline(never)]
    fn resolve_return_type_of_fn(&mut self, file: FileId, func: FnId) -> TypeId {
        if self.prepare_query_for_fn(file, func)
            && let Some((known, _)) = self.p.fn_return_types.get(&mut self.task, &(file, func))
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
            if let Some((known, _)) = self.p.fn_return_types.get(&mut self.task, &(file, func)) {
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
                .rewrite(&mut self.task, (file, func), any, stored);
            self.report_circular_return_type(Some(Query::Return(file, func)), file, func);
            return TypeId::ANY;
        }
        // `getReturnTypeOfSignature`: `sig.resolvedReturnType` is assigned only if it is nil, and
        // the caller gets that value.
        if let Some((known, _)) = self.p.fn_return_types.get(&mut self.task, &(file, func)) {
            return known;
        }
        match left {
            Ok(stored) => {
                self.p
                    .fn_return_types
                    .insert(&mut self.task, (file, func), (ty, false), stored);
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
        if f.ret.is_some() {
            return self.type_from_node(file, f.ret);
        }
        // `getReturnTypeFromAnnotation`: a getter without an annotation uses the annotated
        // parameter type of its setter.
        if f.kind == FnKind::Getter
            && let Some(ty) = self.annotated_setter_type(file, func)
        {
            return ty;
        }
        if let Some(ty) = self.return_type_of_full_signature(file, func) {
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
                    self.check_awaited_type(
                        ty,
                        true,
                        self.place_of_signature_declaration(file, func),
                        1058,
                    )
                } else {
                    ty
                }
            }
            // `checkAndAggregateReturnExpressionTypes`
            FnBody::Block(_) => {
                let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                let mut without_expression =
                    info.end != UNREACHABLE && self.is_reachable(file, info.end);
                let mut returns_never = false;
                for stmt in self.bound(file).ids(info.returns) {
                    let StmtKind::Return(e) = hir[stmt].kind else {
                        continue;
                    };
                    if e.is_none() {
                        without_expression = true;
                        continue;
                    }
                    // "`return await` is also safe to unwrap here"
                    let e = match hir[e].kind {
                        ExprKind::Await(operand) if is_async => operand,
                        _ => e,
                    };
                    if self.is_call_of_the_function_itself(file, func, e, is_async) {
                        returns_never = true;
                        continue;
                    }
                    let mut ty = self.check_expression_cached_ex(file, e, check_mode);
                    if is_async {
                        let error_node = self.place_of_signature_declaration(file, func);
                        ty = self.check_awaited_type(ty, true, error_node, 1058);
                    }
                    if ty.is_never() {
                        returns_never = true;
                    }
                    ty = self.regular_in_const_context(file, e, ty);
                    if !types.contains(&ty) {
                        types.push(ty);
                    }
                }
                let may_return_never = matches!(f.kind, FnKind::Expr | FnKind::Arrow)
                    || (f.kind == FnKind::Method && matches!(info.owner, FnOwner::Expr(_)));
                if types.is_empty() && !without_expression && (returns_never || may_return_never) {
                    TypeId::NEVER
                } else if types.is_empty() {
                    // `undefinedType` if the contextual return type includes `undefined`. A
                    // generator that returns nothing returns `void`, whatever the contextual type.
                    let expected = if is_generator {
                        None
                    } else {
                        self.contextual_return_type(file, func, ContextFlags::empty())
                    };
                    let expected = expected.map(|t| if is_async { self.awaited(t) } else { t });
                    if expected.is_some_and(|t| self.some_type(t, |_, m| m.is_undefined())) {
                        TypeId::UNDEFINED
                    } else {
                        TypeId::VOID
                    }
                } else {
                    if without_expression && self.p.files.options.strict_null_checks {
                        types.push(TypeId::UNDEFINED);
                    }
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
                // `unwrapAwaitedType`: a promise of `Awaited<T>` is a promise of `T`.
                let ret = self.map_type(ret, |c, m| c.awaited_argument(m).unwrap_or(m));
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
            // `getYieldedTypeOfYieldExpression`: an async generator awaits what it yields, `yield*` or not.
            let mut ty = if star {
                self.iterated_type(operand, is_async)
            } else {
                operand
            };
            if is_async {
                ty = self.awaited(ty);
            }
            if !yields.contains(&ty) {
                yields.push(ty);
            }
            // The next type: the contextual types of the `yield` expressions.
            let next = if star {
                self.iterable_types(operand, true, is_async, false, None).n
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
            let expected = self
                .return_type_of_contextual_signature(file, func)
                .filter(|&t| !self.has_any_flag(t));
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
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = bound.expr_parent[e.idx()];
        loop {
            at = match at {
                Parent::ParamDefault(_) => return true,
                // A `yield` in a static block belongs to the enclosing function.
                Parent::FnBody(f) if hir[f].kind != FnKind::StaticBlock => return false,
                Parent::None | Parent::File | Parent::Module(_) => return false,
                Parent::Expr(x) if x.is_none() => return false,
                Parent::PropKey(literal, _) if literal.is_some() => Parent::Expr(literal),
                _ => self.outward(file, at),
            };
        }
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

    /// `return f(..)` in `f`, or `return await f(..)`: its type is that of the other return
    /// statements.
    fn is_call_of_the_function_itself(
        &mut self,
        file: FileId,
        func: FnId,
        mut e: ExprId,
        is_async: bool,
    ) -> bool {
        let hir = self.hir(file);
        if is_async && let ExprKind::Await(operand) = hir[e].kind {
            e = operand;
        }
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let callee = hir[call].callee;
        if !matches!(hir[callee].kind, ExprKind::Ident(_)) {
            return false;
        }
        let symbol = self.bound(file).expr_symbol[callee.idx()];
        if symbol.is_none() {
            return false;
        }
        match hir[func].kind {
            FnKind::Decl => self.bound(file).symbols[symbol.idx()]
                .decls
                .contains(&Decl::Fn(func)),
            FnKind::Expr | FnKind::Arrow => {
                if !self.is_constant_name(file, symbol) {
                    return false;
                }
                // The function expression's own name.
                if self.bound(file).symbols[symbol.idx()]
                    .decls
                    .contains(&Decl::Fn(func))
                {
                    return true;
                }
                let ty = self.type_of_expr(file, callee);
                matches!(self.data(ty), TypeData::Fns { decls, .. } if decls.len() == 1 && decls[0] == (file, func))
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
        let alias = self.files().global(known::Awaited, SymFlags::TYPE_ALIAS)?;
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
            let Some(alias) = self.files().global(known::Awaited, SymFlags::TYPE_ALIAS) else {
                self.report_global_error(2318, vec![b"Awaited".to_vec()]);
                return Some(awaited);
            };
            // `unwrapAwaitedType`: `Awaited<T | U>` does for `Awaited<Awaited<T> | U>`.
            let unwrapped = self.map_type(awaited, |c, m| c.awaited_argument(m).unwrap_or(m));
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
        // `awaitedTypeOfType`. With a node to report on the cache is bypassed: errors found while
        // computing a result are not cached with it. tsgo caches the result in each checker and
        // reports only the first time, which depends on which caller is first.
        if error.is_some()
            || self.has_type_variables(ty)
            || !self.is_no_type_resolution_in_progress()
        {
            return self.awaited_no_alias_uncached(ty, error);
        }
        if let Some(kept) = self.p.awaited_types.get(&mut self.task, &ty) {
            return kept;
        }
        let scope = self.begin_scope();
        let awaited = self.awaited_no_alias_uncached(ty, None);
        if let Ok(stored) = self.end_scope_by_counters(scope)
            // A result that depends on one of these is not cacheable, and `non_cacheable_mark` does not always show it.
            && self.inference_contexts.is_empty()
            && self.provisional.is_empty()
            // These are set for the current caller, every time.
            && !(self.relation_too_complex
                || !self.relations_too_deep.is_empty())
            && self.reliability == 0
        {
            self.p
                .awaited_types
                .insert(&mut self.task, ty, awaited, stored);
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
            if self.depth > 40 {
                return Some(TypeId::UNRESOLVED);
            }
            self.depth += 1;
            self.awaiting.push(ty);
            let awaited = self.awaited_no_alias_ex(promised, error);
            self.awaiting.pop();
            self.depth -= 1;
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
        let params = self.sig_params(sig);
        if params.is_empty() {
            TypeId::NEVER
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
        // The `then` of a `PromiseLike` gives the same result.
        if let Some(args) = self
            .is_global_ref(ty, known::Promise)
            .or_else(|| self.is_global_ref(ty, known::PromiseLike))
        {
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
            let types = self.iterable_types(
                ty,
                true,
                allows_async,
                usage.is_for_of(),
                error_node.filter(|_| iterable_exists),
            );
            if error_node.is_some()
                && let Some(next) = types.n
            {
                let head_message = Some(usage.code_for_sent_type());
                self.check_type_assignable_to(sent, next, error_node, head_message);
            }
            if types.y.is_some() || iterable_exists {
                return types.y;
            }
        }
        // Without `Iterable`, only strings (where allowed) and array-like types are iterable.
        let mut arrays = ty;
        if usage.is_for_of() {
            arrays = self.filter(ty, |c, m| !c.is_string_like(m));
            if arrays.is_never() {
                return Some(TypeId::STRING);
            }
        }
        let has_string = arrays != ty;
        if !self.is_array_like(arrays) {
            if let Some(error_node) = error_node {
                // `getIterationDiagnosticDetails`
                let yielded = self.iterable_types(ty, true, allows_async, usage.is_for_of(), None);
                let is_later_iterable = matches!(self.data(ty), TypeData::Ref { target, .. } if matches!(
                    self.atoms().bytes(self.files().symbol(*target).name),
                    b"Float32Array" | b"Float64Array" | b"Int16Array" | b"Int32Array" | b"Int8Array" | b"NodeList" | b"Uint16Array" | b"Uint32Array" | b"Uint8Array" | b"Uint8ClampedArray"
                ));
                let code = if yielded.y.is_some() || is_later_iterable {
                    2802
                } else if usage.is_for_of() && !has_string {
                    2495
                } else {
                    2461
                };
                self.error_at(error_node, code, &[Arg::Type(arrays)]);
            }
            return has_string.then_some(TypeId::STRING);
        }
        let element = self.index_type_of_type(arrays, TypeId::NUMBER)?;
        Some(if has_string {
            self.union_reduced(&[element, TypeId::STRING])
        } else {
            element
        })
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
        let code = if allows_async { 2504 } else { 2488 };
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
        let f = &self.hir(file)[func];
        let is_async = f.flags.contains(Flags::ASYNC);
        // "There is no point in doing an assignability check if the function has no explicit return type"
        let mut return_type = f.ret.is_some().then(|| self.type_from_node(file, f.ret));
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
        // `getYieldedTypeOfYieldExpression`
        let error_node = |c: &Self| {
            if value.is_some() {
                (
                    file,
                    c.error_start_of(file, value),
                    c.error_end_of(file, value),
                )
            } else {
                c.place_of_token(file, c.hir(file)[e].pos)
            }
        };
        let mut yielded_type = Some(yield_expression_type);
        if star && !self.is_any(yield_expression_type) {
            let usage = if is_async {
                IterationUse::AsyncYieldStar
            } else {
                IterationUse::YieldStar
            };
            let sent = iteration_types.n.unwrap_or(TypeId::ANY);
            let error_node = Some(error_node(self));
            yielded_type =
                self.iterated_type_or_element_type(usage, yield_expression_type, sent, error_node);
        }
        if is_async {
            yielded_type = yielded_type.map(|yielded| self.awaited(yielded));
        }
        if return_type.is_some()
            && let Some(yielded_type) = yielded_type
        {
            self.check_type_assignable_to_and_optionally_elaborate(
                yielded_type,
                iteration_types.y.unwrap_or(TypeId::ANY),
                Some(error_node(self)),
                (value.is_some() && !star).then_some((file, value)),
                false,
                None,
                None,
            );
        }
        if star {
            let types = self.iterable_types(yield_expression_type, true, is_async, false, None);
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
        // `getIterationTypeOfGeneratorFunctionReturnType`: `any` says nothing.
        let types = if self.is_any(return_type) {
            Iter3::default()
        } else {
            self.generator_return_types(return_type, is_async)
        };
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

    /// The same, but missing types stay missing.
    fn generator_return_types(&mut self, ty: TypeId, is_async: bool) -> Iter3 {
        let types = self.iterable_types(ty, !is_async, is_async, false, None);
        if types.has_types() {
            types
        } else {
            self.iterator_types(ty, is_async, None, None)
        }
    }

    /// `getIterationTypesOfIterable`: the iteration types of `ty`, through its
    /// `[Symbol.asyncIterator]` if `asynchronous`, otherwise through its `[Symbol.iterator]` if
    /// `sync`. `for_of`: the use is a `for..of`, with or without `await` (`IterationUseForOfFlag`).
    /// tsgo caches the result per checker, so errors found while computing it are reported only on
    /// the first request, which depends on which caller is first. Here they are reported for every
    /// `error_node`.
    pub(super) fn iterable_types(
        &mut self,
        ty: TypeId,
        sync: bool,
        asynchronous: bool,
        for_of: bool,
        error_node: Option<Place>,
    ) -> Iter3 {
        let ty = self.reduced(ty);
        if self.is_any(ty) {
            return Iter3::all(ty);
        }
        // Every member must be iterable. No error is reported for an individual member.
        if self.is_union(ty) {
            let parts = self.parts(ty);
            let mut all = Vec::with_capacity(parts.len());
            for &part in parts {
                let types = self.iterable_types(part, sync, asynchronous, for_of, None);
                if !types.has_types() {
                    self.report_type_not_iterable(error_node, ty, asynchronous, for_of, Vec::new());
                    return Iter3::default();
                }
                all.push(types);
            }
            return self.combine_iteration_types(&all);
        }
        // A type parameter has the iteration types of its constraint, and the error names the type
        // parameter itself.
        if self.is_deferred(ty) {
            let apparent = self.apparent_type(ty);
            let types = if apparent == ty || self.is_any(apparent) {
                Iter3::default()
            } else {
                self.iterable_types(apparent, sync, asynchronous, for_of, None)
            };
            if !types.has_types() {
                self.report_type_not_iterable(error_node, ty, asynchronous, for_of, Vec::new());
            }
            return types;
        }
        // For arrays, tuples and strings this equals the result from the declarations of a library
        // that has `Iterable`.
        if sync && self.global_type_of_arity(known::Iterable, 3).is_some() {
            let element = match self.data(ty) {
                TypeData::Tuple { flags, .. } => {
                    let elems = self.type_arguments(ty);
                    Some(self.tuple_element_union(elems, flags))
                }
                _ if self.is_string_like(ty) => Some(TypeId::STRING),
                _ => self.array_element(ty),
            };
            if let Some(element) = element {
                let types = Iter3 {
                    y: Some(element),
                    r: Some(self.builtin_iterator_return()),
                    n: Some(TypeId::UNKNOWN),
                };
                return if asynchronous {
                    self.async_from_sync(types)
                } else {
                    types
                };
            }
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
                    self.async_from_sync(types)
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
                    self.async_from_sync(types)
                } else {
                    types
                };
            }
        }
        self.report_type_not_iterable(error_node, ty, asynchronous, for_of, diags);
        Iter3::default()
    }

    /// The end of `getIterationTypesOfIterableWorker`: `ty` is not iterable, and `diags` becomes
    /// the related information of that error. tsgo defers it (`addDeferredDiagnostic`) so that
    /// printing the type cannot cause a cycle: nothing is being resolved by then.
    fn report_type_not_iterable(
        &mut self,
        error_node: Option<Place>,
        ty: TypeId,
        allows_async: bool,
        for_of: bool,
        diags: Vec<Reported>,
    ) {
        if let Some(error_node) = error_node {
            let reprinting = std::mem::replace(&mut self.reprinting, true);
            let mut diagnostic = self.type_not_iterable_error(error_node, ty, allows_async, for_of);
            self.reprinting = reprinting;
            diagnostic.related_information.extend(diags);
            self.add_diagnostic(diagnostic);
        }
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
            if let Some(&[y, r, n]) = self.is_global_ref(ty, name) {
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
                && let Some(&[y]) = self.is_global_ref(ty, name)
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
    fn async_from_sync(&mut self, types: Iter3) -> Iter3 {
        let any = Some(TypeId::ANY);
        if !types.has_types() || (types.y == any && types.r == any && types.n == any) {
            return types;
        }
        let y = types.y.and_then(|y| self.awaited_or_none(y));
        let r = types.r.and_then(|r| self.awaited_or_none(r));
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
        let name = if is_async {
            known::sym_async_iterator
        } else {
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
            && let Some(&[value]) = self.is_global_ref(ty, name)
        {
            return Iter3 {
                y: Some(value),
                ..Iter3::default()
            };
        }
        if let Some(name) = self.atoms().lookup(b"IteratorReturnResult")
            && let Some(&[value]) = self.is_global_ref(ty, name)
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
