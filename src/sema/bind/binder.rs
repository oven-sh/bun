use super::*;
use crate::atom::known;

/// What `getInitializerSymbol` finds.
enum ExpandoFunction {
    /// `function f() {}`
    Declared(SymbolId),
    /// `const f = function () {}`, `const f = () => {}`
    Expr(FnId),
    /// `var o = {}`, in JavaScript
    Object(ExprId),
}

pub(super) struct Binder<'f> {
    f: &'f File,
    options: BindOptions,
    /// What spells a number as a name, if the caller has it.
    atoms: Option<&'f Interner>,
    b: Bound,
    tables: Vec<FxHashMap<Atom, SymbolId>>,
    scope: ScopeId,
    /// Identifiers to look up once everything is declared.
    idents: Vec<(ExprId, ScopeId)>,
    /// Identifiers that are assigned to.
    assigned: Vec<ExprId>,
    /// `bindExpandoPropertyAssignment`: `a.b = c`, `a[b] = c` and, in JavaScript, `Object.defineProperty(a, "b", c)`, each with the
    /// scope it is written in.
    expando_assignments: Vec<(ExprId, ScopeId)>,

    flow: FlowId,
    /// `bindChildren`: control gets to where the statement, declaration or expression being bound starts. What that does to the flow
    /// of control is then noted, be control lost inside it, as in `x = (() => { throw e })()`.
    is_reached: bool,
    label_edges: FxHashMap<u32, Vec<FlowId>>,
    break_target: FlowId,
    continue_target: FlowId,
    return_target: FlowId,
    /// Where the `infer`s of the `extends` type being gone through are declared.
    infer_scope: ScopeId,
    exception_target: FlowId,
    /// `hasFlowEffects`: something was assigned to, or control went elsewhere, since this was last reset.
    has_flow_effects: bool,
    /// `inAssignmentPattern`: what is about to be bound is part of the left side of a destructuring assignment.
    in_assignment_pattern: bool,
    true_target: FlowId,
    false_target: FlowId,
    pre_switch: FlowId,
    /// The name, where `break` and `continue` with it go, and whether either has been seen.
    labels: Vec<(Atom, FlowId, FlowId, bool)>,

    cur_fn: FnId,
    /// The member of a class whose type or initializer is being gone through, with no function and no type literal in between.
    cur_member: MemberId,
    returns: Vec<u32>,
    yields: Vec<u32>,
    /// `seenThisKeyword`
    seen_this: bool,
    /// There is a `this` in the computed name of the method or accessor about to be bound.
    this_in_name: bool,
    /// Where control is after the computed name of the method or accessor about to be bound. `NONE`: it has none.
    flow_after_name: FlowId,
    /// `isResolvedByTypeAlias`, of the type node about to be bound.
    by_alias: bool,
    /// How many type literals the type being bound is inside of.
    type_literal_depth: u32,
    /// The function whose parameters are being gone through, with nothing in between that `requiresScopeChangeWorker` does not enter.
    scope_change_of: FnId,
}

impl<'f> Binder<'f> {
    pub(super) fn run(f: &'f File, options: BindOptions, atoms: Option<&'f Interner>) -> Bound {
        let mut b = Bound::default();
        b.expr_symbol = vec![SymbolId::NONE; f.exprs.len()];
        b.expr_parent = vec![Parent::None; f.exprs.len()];
        b.expr_flow = vec![UNREACHABLE; f.exprs.len()];
        b.stmt_parent = vec![Parent::None; f.stmts.len()];
        b.stmt_flow = vec![UNREACHABLE; f.stmts.len()];
        b.case_fallthrough = vec![FlowId::NONE; f.cases.len()];
        b.type_scope = vec![ScopeId::NONE; f.types.len()];
        b.type_by_alias = vec![false; f.types.len()];
        b.pat_parent = vec![PatParent::None; f.pats.len()];
        b.pat_symbol = vec![SymbolId::NONE; f.pats.len()];
        b.prop_owner = vec![ExprId::NONE; f.props.len()];
        b.member_owner = vec![MemberOwner::None; f.members.len()];
        b.param_fn = vec![FnId::NONE; f.params.len()];
        b.type_param_symbol = vec![SymbolId::NONE; f.type_params.len()];
        b.type_param_scope = vec![ScopeId::NONE; f.type_params.len()];
        b.fns = vec![
            FnInfo {
                owner: FnOwner::None,
                scope: ScopeId::NONE,
                enclosing: FnId::NONE,
                returns: IdList::EMPTY,
                yields: IdList::EMPTY,
                end: UNREACHABLE,
                exit: FlowId::NONE,
                contains_this: false,
            };
            f.fns.len()
        ];
        b.requires_scope_change = vec![false; f.fns.len()];
        b.fn_symbol = vec![SymbolId::NONE; f.fns.len()];
        b.class_symbol = vec![SymbolId::NONE; f.classes.len()];
        b.class_owner = vec![ClassOwner::Stmt(StmtId::NONE); f.classes.len()];
        b.class_scope = vec![ScopeId::NONE; f.classes.len()];
        b.interface_symbol = vec![SymbolId::NONE; f.interfaces.len()];
        b.alias_symbol = vec![SymbolId::NONE; f.aliases.len()];
        b.alias_scope = vec![ScopeId::NONE; f.aliases.len()];
        b.enum_symbol = vec![SymbolId::NONE; f.enums.len()];
        b.enum_member_symbol = vec![SymbolId::NONE; f.enum_members.len()];
        b.enum_member_owner = vec![EnumId::NONE; f.enum_members.len()];
        b.module_symbol = vec![SymbolId::NONE; f.modules.len()];
        b.module_instantiated = vec![false; f.modules.len()];
        b.var_stmt = vec![StmtId::NONE; f.var_decls.len()];
        b.case_stmt = vec![StmtId::NONE; f.cases.len()];
        b.import_equals_scope = vec![ScopeId::NONE; f.import_equals.len()];
        b.export_scope = vec![ScopeId::NONE; f.exports.len()];
        b.flow.push(Flow::Unreachable);

        let mut this = Binder {
            f,
            options,
            atoms,
            b,
            tables: Vec::new(),
            scope: ScopeId::NONE,
            idents: Vec::new(),
            assigned: Vec::new(),
            expando_assignments: Vec::new(),
            flow: UNREACHABLE,
            is_reached: false,
            label_edges: FxHashMap::default(),
            break_target: FlowId::NONE,
            continue_target: FlowId::NONE,
            return_target: FlowId::NONE,
            infer_scope: ScopeId::NONE,
            exception_target: FlowId::NONE,
            has_flow_effects: false,
            in_assignment_pattern: false,
            true_target: FlowId::NONE,
            false_target: FlowId::NONE,
            pre_switch: UNREACHABLE,
            labels: Vec::new(),
            cur_fn: FnId::NONE,
            cur_member: MemberId::NONE,
            returns: Vec::new(),
            yields: Vec::new(),
            seen_this: false,
            this_in_name: false,
            flow_after_name: FlowId::NONE,
            by_alias: false,
            type_literal_depth: 0,
            scope_change_of: FnId::NONE,
        };
        this.file();
        this.finish()
    }

    // ───────────────────────────── symbols and scopes ─────────────────────────────

    fn new_table(&mut self) -> TableId {
        self.tables.push(FxHashMap::default());
        TableId(self.tables.len() as u32 - 1)
    }

    fn new_symbol(
        &mut self,
        name: Atom,
        flags: SymFlags,
        decl: Decl,
        parent: SymbolId,
    ) -> SymbolId {
        self.b.symbols.push(Symbol {
            name,
            flags,
            decls: vec![decl],
            parent,
            exports: TableId::NONE,
        });
        SymbolId(self.b.symbols.len() as u32 - 1)
    }

    /// `symbol.Flags&excludes != 0` of `declareSymbolEx`: whether what goes by a name, which is `there`, refuses a declaration of it.
    fn is_refused(there: SymFlags, flags: SymFlags, decl: Decl) -> bool {
        let value = SymFlags::VALUE;
        let both = SymFlags::VALUE | SymFlags::TYPE;
        // The `SymbolFlags..Excludes`.
        let excludes = match decl {
            Decl::Var(_) if flags.contains(SymFlags::FUNCTION_SCOPED_VARIABLE) => {
                value.difference(SymFlags::FUNCTION_SCOPED_VARIABLE)
            }
            Decl::Var(_) | Decl::Param(_) => value,
            Decl::Fn(_) => {
                value.difference(SymFlags::FUNCTION | SymFlags::VALUE_MODULE | SymFlags::CLASS)
            }
            Decl::Class(_) => {
                both.difference(SymFlags::VALUE_MODULE | SymFlags::INTERFACE | SymFlags::FUNCTION)
            }
            Decl::Interface(_) => SymFlags::TYPE.difference(SymFlags::INTERFACE | SymFlags::CLASS),
            Decl::Alias(_) => SymFlags::TYPE,
            Decl::Enum(_) if flags.contains(SymFlags::CONST_ENUM) => {
                both.difference(SymFlags::ENUM)
            }
            Decl::Enum(_) => both.difference(SymFlags::ENUM | SymFlags::VALUE_MODULE),
            Decl::EnumMember(_) => both,
            Decl::Module(_) if flags.contains(SymFlags::VALUE_MODULE) => value.difference(
                SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM | SymFlags::VALUE_MODULE,
            ),
            Decl::TypeParam(_) => SymFlags::TYPE.difference(SymFlags::TYPE_PARAMETER),
            Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_) => SymFlags::ALIAS,
            _ => SymFlags::empty(),
        };
        if there.intersects(excludes) {
            return true;
        }
        // One flag stands for both kinds of enum.
        there.contains(SymFlags::ENUM)
            && match decl {
                Decl::Enum(_) => {
                    there.contains(SymFlags::CONST_ENUM) != flags.contains(SymFlags::CONST_ENUM)
                }
                Decl::Module(_) => {
                    flags.contains(SymFlags::VALUE_MODULE) && there.contains(SymFlags::CONST_ENUM)
                }
                _ => false,
            }
    }

    /// `declareSymbolEx`: the declarations of one name in one table are one symbol if they go together. One that is refused gets a
    /// symbol of its own, which no name leads to.
    fn declare_in(
        &mut self,
        table: TableId,
        name: Atom,
        flags: SymFlags,
        decl: Decl,
        parent: SymbolId,
    ) -> SymbolId {
        if let Some(&existing) = self.tables[table.idx()].get(&name) {
            let there = &self.b.symbols[existing.idx()];
            // `Resolve`: the name of a class expression comes after what is declared in the class, and refuses none of it.
            let is_own_name = matches!(there.decls[0], Decl::Class(c) if matches!(self.b.class_owner[c.idx()], ClassOwner::Expr(_)));
            let is_refused = !is_own_name && Self::is_refused(there.flags, flags, decl);
            let symbol = &mut self.b.symbols[existing.idx()];
            symbol.decls.push(decl);
            if is_refused {
                return self.new_symbol(name, flags, decl, parent);
            }
            symbol.flags |= flags;
            // What is more than `export { a as b }` is in scope.
            symbol.flags.remove(SymFlags::EXPORT_ONLY);
            if symbol.parent.is_none() {
                symbol.parent = parent;
            }
            return existing;
        }
        let symbol = self.new_symbol(name, flags, decl, parent);
        self.tables[table.idx()].insert(name, symbol);
        symbol
    }

    fn push_scope(&mut self, kind: ScopeKind, symbol: SymbolId) -> ScopeId {
        let locals = self.new_table();
        self.b.scopes.push(Scope {
            parent: self.scope,
            kind,
            locals,
            symbol,
        });
        self.scope = ScopeId(self.b.scopes.len() as u32 - 1);
        self.scope
    }

    fn pop_scope(&mut self) {
        self.scope = self.b.scopes[self.scope.idx()].parent;
    }

    /// The nearest scope `var` and hoisted functions belong to.
    fn var_scope(&self) -> ScopeId {
        let mut scope = self.scope;
        loop {
            let s = &self.b.scopes[scope.idx()];
            if matches!(
                s.kind,
                ScopeKind::File | ScopeKind::Module(_) | ScopeKind::Fn(_)
            ) || s.parent.is_none()
            {
                return scope;
            }
            scope = s.parent;
        }
    }

    /// `declareModuleMember`: declares `name` in `scope`, or among the exports of the module or namespace `scope` is the body of if
    /// `exported`. What is exported under a name and what is not are two symbols. The locals hold what is not. Where there is no
    /// such thing they hold what is exported, in place of the symbol that would only lead there.
    fn declare(
        &mut self,
        scope: ScopeId,
        name: Atom,
        flags: SymFlags,
        decl: Decl,
        exported: bool,
    ) -> SymbolId {
        let s = &self.b.scopes[scope.idx()];
        let (locals, container) = (s.locals, s.symbol);
        if container.is_none() || !matches!(s.kind, ScopeKind::File | ScopeKind::Module(_)) {
            return self.declare_in(locals, name, flags, decl, SymbolId::NONE);
        }
        let exports = self.b.symbols[container.idx()].exports;
        let in_locals = self.tables[locals.idx()].get(&name).copied();
        let in_exports = self.tables[exports.idx()].get(&name).copied();
        // What the block declares without exporting it.
        let own = in_locals
            .filter(|&local| Some(local) != in_exports && !self.b.refused_exports.contains(&local));
        let is_only_a_value = |flags: SymFlags| {
            flags.intersects(SymFlags::VALUE)
                && !flags.intersects(SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS)
        };
        if !exported {
            // An import is kept one symbol with what is exported under its name: whether the two clash (2440) is asked of that.
            let Some(exported_one) =
                in_locals.filter(|_| own.is_none() && !flags.contains(SymFlags::ALIAS))
            else {
                return self.declare_in(locals, name, flags, decl, container);
            };
            let symbol = self.new_symbol(name, flags, decl, container);
            // `getExportSymbolOfValueSymbolIfExported`: as a value the name goes on meaning what is exported.
            if !(is_only_a_value(flags)
                && self.b.symbols[exported_one.idx()]
                    .flags
                    .intersects(SymFlags::VALUE))
            {
                self.tables[locals.idx()].insert(name, symbol);
            }
            return symbol;
        }
        let own = own.map(|local| self.b.symbols[local.idx()].flags);
        // `declareSymbol(locals, .., exportKind, symbolExcludes)`
        let goes_with_own = own.is_none_or(|there| !Self::is_refused(there, flags, decl));
        // One symbol with an import of the name, as above.
        if goes_with_own
            && in_exports.is_none()
            && own.is_some_and(|there| there.contains(SymFlags::ALIAS))
        {
            let symbol = self.declare_in(locals, name, flags, decl, container);
            self.tables[exports.idx()].insert(name, symbol);
            return symbol;
        }
        let symbol = self.declare_in(exports, name, flags, decl, container);
        let is_accepted = in_exports.is_none_or(|there| there == symbol);
        // `local.ExportSymbol`: as a value the name means, in this block, what was exported under it last, be it refused. As
        // anything else it means what the block keeps to itself, and then what the table of exports has.
        let takes_the_name = (is_accepted || is_only_a_value(flags))
            && own.is_none_or(|there| {
                goes_with_own && flags.intersects(SymFlags::VALUE) && is_only_a_value(there)
            });
        if takes_the_name {
            self.tables[locals.idx()].insert(name, symbol);
            if !is_accepted {
                self.b.refused_exports.push(symbol);
            }
        }
        symbol
    }

    /// `declareSymbolEx` for `export { a as b }` and `export * as b` among the exports. `AliasExcludes`: it is one symbol with what
    /// else is exported as `b`, of which each use takes the meaning it is after. Another alias that has the name keeps it, and so
    /// does whatever is the default: what is refused is in no table.
    fn export_as(&mut self, name: Atom, flags: SymFlags, decl: Decl) {
        let container = self.b.scopes[self.scope.idx()].symbol;
        if container.is_some() {
            let exports = self.b.symbols[container.idx()].exports;
            let Some(there) = self.tables[exports.idx()].get(&name).copied() else {
                let symbol = self.new_symbol(name, flags, decl, SymbolId::NONE);
                self.tables[exports.idx()].insert(name, symbol);
                return;
            };
            let there = &mut self.b.symbols[there.idx()];
            if name != known::default && !there.flags.contains(SymFlags::ALIAS) {
                there.flags |= flags.difference(SymFlags::EXPORT_ONLY);
                there.decls.push(decl);
                return;
            }
        }
        self.new_symbol(name, flags, decl, SymbolId::NONE);
    }

    /// `export { a }` where `a` means nothing but what is exported as `a`. Made one symbol with that it stands for itself, and most
    /// who meet an alias follow it whatever they are after. So it is a symbol of its own, in no table. Only once all is declared
    /// can it be told.
    fn part_exports_of_themselves(&mut self) {
        let f = self.f;
        for (i, export) in f.exports.iter().enumerate() {
            let scope = self.b.export_scope[i];
            if export.spec.is_some() || scope.is_none() {
                continue;
            }
            for spec in export.items.iter() {
                let (name, decl) = (f[spec].local, Decl::ExportSpec(spec));
                if f[spec].exported == name
                    && let Some(symbol) = self.lookup_name(name, scope)
                    && self.b.symbols[symbol.idx()].decls.len() > 1
                    && self.b.symbols[symbol.idx()].decls.contains(&decl)
                {
                    let whole = &mut self.b.symbols[symbol.idx()];
                    whole.decls.retain(|&d| d != decl);
                    whole.flags.remove(SymFlags::ALIAS);
                    self.new_symbol(
                        name,
                        SymFlags::ALIAS | SymFlags::EXPORT_ONLY,
                        decl,
                        SymbolId::NONE,
                    );
                }
            }
        }
    }

    /// `bindExportAssignment`: it goes with nothing, so what has the name already keeps it.
    fn export_if_vacant(&mut self, name: Atom, symbol: SymbolId) {
        let container = self.b.scopes[self.scope.idx()].symbol;
        if container.is_some() {
            let exports = self.b.symbols[container.idx()].exports;
            self.tables[exports.idx()].entry(name).or_insert(symbol);
        }
    }

    fn is_default_export(&self, decl: Decl) -> bool {
        let flags = match decl {
            Decl::Fn(f) => self.f[f].flags,
            Decl::Class(c) => self.f[c].flags,
            Decl::Interface(i) => self.f[i].flags,
            _ => return false,
        };
        flags.contains(Flags::DEFAULT)
    }

    /// `declareModuleMember`, `declareSymbolEx` for `export default` on a declaration: among the exports it goes by `default`,
    /// whatever it is called here. Without a name (`NONE`) nothing here can refer to it.
    fn declare_default(
        &mut self,
        name: Atom,
        flags: SymFlags,
        excludes: SymFlags,
        decl: Decl,
    ) -> SymbolId {
        let s = &self.b.scopes[self.scope.idx()];
        let (locals, container) = (s.locals, s.symbol);
        let shown = if name.is_some() { name } else { known::default };
        // Only among exports does it go by `default`. Where there are none, what has no name goes in no table.
        if container.is_none() {
            return if name.is_some() {
                self.declare(self.scope, name, flags, decl, false)
            } else {
                self.new_symbol(shown, flags, decl, SymbolId::NONE)
            };
        }
        let exports = self.b.symbols[container.idx()].exports;
        // Next to what is declared here under the name and is no default export it is declared like what is not exported.
        if name.is_some()
            && let Some(&local) = self.tables[locals.idx()].get(&name)
            && !self.b.symbols[local.idx()]
                .decls
                .iter()
                .all(|&d| self.is_default_export(d))
        {
            let symbol = self.declare(self.scope, name, flags, decl, false);
            self.tables[exports.idx()]
                .entry(known::default)
                .or_insert(symbol);
            return symbol;
        }
        // With an alias it would be one symbol too, which is the declaration wherever that has the meaning asked for. Here an alias
        // is followed wherever it is met, so the declaration takes its place.
        let there = self.tables[exports.idx()].get(&known::default).copied();
        let symbol = match there
            .filter(|there| !self.b.symbols[there.idx()].flags.contains(SymFlags::ALIAS))
        {
            // It goes with what is there: one symbol.
            Some(there) if !self.b.symbols[there.idx()].flags.intersects(excludes) => {
                let symbol = &mut self.b.symbols[there.idx()];
                symbol.flags |= flags;
                symbol.decls.push(decl);
                there
            }
            // Refused: a symbol of its own, which is not exported.
            Some(_) => self.new_symbol(shown, flags, decl, container),
            None => {
                let symbol = self.new_symbol(shown, flags, decl, container);
                self.tables[exports.idx()].insert(known::default, symbol);
                symbol
            }
        };
        // The name means the last that took it: `ExportSymbol` of the local symbol.
        if name.is_some() {
            self.tables[locals.idx()].insert(name, symbol);
        }
        symbol
    }

    fn specifier(&mut self, spec: Atom) {
        if spec.is_some() {
            self.b.specifiers.push(spec);
        }
    }

    /// The `module "m" { }` or `global { }` at the top of a script whose body the binder is directly in.
    fn ambient_module_around(&self) -> Option<ModuleId> {
        let s = &self.b.scopes[self.scope.idx()];
        match s.kind {
            ScopeKind::Module(m)
                if !self.f.has_module_syntax
                    && !matches!(self.f[m].name, ModuleName::Ident(_))
                    && matches!(self.b.scopes[s.parent.idx()].kind, ScopeKind::File) =>
            {
                Some(m)
            }
            _ => None,
        }
    }

    /// `collectModuleReferences`: whether the module an import or export statement names is looked for. At the top of the file
    /// it is, and in an ambient module a script declares. What adds to a module is not gone through, nor is a namespace.
    fn statement_specifier(&mut self, spec: Atom) {
        if matches!(self.b.scopes[self.scope.idx()].kind, ScopeKind::File) {
            self.specifier(spec);
        } else if spec.is_some()
            && let Some(m) = self.ambient_module_around()
            && (self.f[m].flags.contains(Flags::AMBIENT) || self.f.kind == FileKind::Declaration)
        {
            self.b.ambient_specifiers.push(spec);
        }
    }

    // ───────────────────────────── flow ─────────────────────────────

    fn new_flow(&mut self, node: Flow) -> FlowId {
        self.b.flow.push(node);
        FlowId(self.b.flow.len() as u32 - 1)
    }

    fn branch_label(&mut self) -> FlowId {
        let id = self.new_flow(Flow::Label { start: 0, len: 0 });
        self.label_edges.insert(id.0, Vec::new());
        id
    }

    fn loop_label(&mut self) -> FlowId {
        let id = self.new_flow(Flow::Loop { start: 0, len: 0 });
        self.label_edges.insert(id.0, Vec::new());
        id
    }

    /// What cannot be reached stays that way: a loop there would have no way in but its own way back.
    fn enter_loop(&mut self, pre: FlowId) {
        if self.flow != UNREACHABLE {
            self.add_edge(pre, self.flow);
            self.flow = pre;
        }
    }

    fn add_edge(&mut self, label: FlowId, from: FlowId) {
        if from == UNREACHABLE || label.is_none() {
            return;
        }
        let edges = self.label_edges.get_mut(&label.0).unwrap();
        if !edges.contains(&from) {
            edges.push(from);
        }
    }

    fn finish_label(&mut self, label: FlowId) -> FlowId {
        let edges = &self.label_edges[&label.0];
        match edges.len() {
            0 => UNREACHABLE,
            1 => edges[0],
            _ => label,
        }
    }

    fn has_edges(&self, label: FlowId) -> bool {
        !self.label_edges[&label.0].is_empty()
    }

    /// `IsStringOrNumericLiteralLike`, of what is written: `("a")` is not.
    fn is_string_or_numeric_literal_like(&self, e: ExprId) -> bool {
        is_string_or_numeric_literal_like(self.f, e)
    }

    /// `isNarrowableReference`
    fn is_narrowable_reference(&self, e: ExprId) -> bool {
        match self.f[e].kind {
            ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::NewTarget
            | ExprKind::ImportMeta => true,
            ExprKind::Dot { obj, .. } => self.is_narrowable_reference(obj),
            ExprKind::NonNull(x) => self.is_narrowable_reference(x),
            // With a literal for a key the object is not looked at.
            ExprKind::Index { obj, index, .. } => {
                self.is_string_or_numeric_literal_like(index)
                    || self.is_entity_name(index) && self.is_narrowable_reference(obj)
            }
            ExprKind::Assign { target, .. } => self.is_narrowable_reference(target),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.is_narrowable_reference(right),
            _ => false,
        }
    }

    fn contains_narrowable_reference(&self, e: ExprId) -> bool {
        if self.is_narrowable_reference(e) {
            return true;
        }
        match self.f[e].kind {
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. }
                if chain != Chain::No =>
            {
                self.contains_narrowable_reference(obj)
            }
            ExprKind::Call(c) if self.f[c].chain != Chain::No => {
                self.contains_narrowable_reference(self.f[c].callee)
            }
            ExprKind::NonNull(x) => self.contains_narrowable_reference(x),
            _ => false,
        }
    }

    /// `isNarrowingExpression`: `x as T` and `x satisfies T` are none.
    fn is_narrowing_expression(&self, e: ExprId) -> bool {
        match self.f[e].kind {
            ExprKind::Ident(_) | ExprKind::This | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.contains_narrowable_reference(e)
            }
            ExprKind::Call(c) => {
                let call = &self.f[c];
                if self
                    .f
                    .ids(call.args)
                    .any(|a| self.contains_narrowable_reference(a))
                {
                    return true;
                }
                matches!(self.f[call.callee].kind, ExprKind::Dot { obj, .. } if self.contains_narrowable_reference(obj))
            }
            ExprKind::NonNull(x) => self.is_narrowing_expression(x),
            ExprKind::Unary {
                op: UnOp::Typeof | UnOp::Not,
                operand,
            } => self.is_narrowing_expression(operand),
            // `isNarrowingBinaryExpression`: of the assignments `=`, `&&=`, `||=` and `??=` alone.
            ExprKind::Assign {
                op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                target,
                ..
            } => self.contains_narrowable_reference(target),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                    self.is_narrowable_operand(left)
                        || self.is_narrowable_operand(right)
                        || self.is_narrowing_typeof(right, left)
                        || self.is_narrowing_typeof(left, right)
                        || (matches!(self.f[right].kind, ExprKind::True | ExprKind::False)
                            && self.is_narrowing_expression(left))
                        || (matches!(self.f[left].kind, ExprKind::True | ExprKind::False)
                            && self.is_narrowing_expression(right))
                }
                BinOp::Instanceof => self.is_narrowable_operand(left),
                BinOp::In => self.is_narrowing_expression(right),
                BinOp::Comma => self.is_narrowing_expression(right),
                // `&&`, `||` and `??` too: their operands are conditions of their own.
                _ => false,
            },
            _ => false,
        }
    }

    /// `isNarrowingTypeOfOperands`: `typeof x` on one side and a string on the other.
    fn is_narrowing_typeof(&self, e: ExprId, other: ExprId) -> bool {
        matches!(self.f[e].kind, ExprKind::Unary { op: UnOp::Typeof, operand } if self.is_narrowable_operand(operand))
            && match self.f[other].kind {
                ExprKind::String(_) => true,
                ExprKind::Template { exprs, .. } => exprs.is_empty(),
                _ => false,
            }
    }

    fn is_narrowable_operand(&self, e: ExprId) -> bool {
        match self.f[e].kind {
            ExprKind::Assign {
                op: None, target, ..
            } => self.is_narrowable_operand(target),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.is_narrowable_operand(right),
            ExprKind::NonNull(x) => self.is_narrowable_operand(x),
            _ => self.contains_narrowable_reference(e),
        }
    }

    fn flow_condition(&mut self, sense: bool, before: FlowId, expr: ExprId) -> FlowId {
        if before == UNREACHABLE {
            return before;
        }
        if expr.is_none() {
            return if sense { before } else { UNREACHABLE };
        }
        // `createFlowCondition`: the keyword settles which way control goes, unless it is in parentheses, an operand of `??`, or what
        // a `?.` follows.
        if matches!(
            (self.f[expr].kind, sense),
            (ExprKind::True, false) | (ExprKind::False, true)
        ) && !self.is_in_parens(expr)
            && !matches!(self.b.expr_parent[expr.idx()], Parent::Expr(p)
                if matches!(self.f[p].kind, ExprKind::Binary { op: BinOp::Nullish, .. })
                    || self.chain_of(p).is_some_and(|(inner, is_root)| is_root && inner == expr))
        {
            return UNREACHABLE;
        }
        if !self.is_narrowing_expression(expr) {
            return before;
        }
        self.new_flow(Flow::Cond {
            before,
            expr,
            sense,
        })
    }

    fn flow_mutation(&mut self, node: Flow) {
        // `bindChildren`: nothing is made of what control does not get to.
        if !self.is_reached {
            return;
        }
        self.has_flow_effects = true;
        self.flow = self.new_flow(node);
        if self.exception_target.is_some() {
            self.add_edge(self.exception_target, self.flow);
        }
    }

    /// `createFlowCall`: unlike an assignment, it is not one of the places a `catch` or `finally` is come to from.
    fn flow_call(&mut self, call: ExprId) {
        if !self.is_reached {
            return;
        }
        self.has_flow_effects = true;
        self.flow = self.new_flow(Flow::Call {
            before: self.flow,
            call,
        });
    }

    /// `isLogicalAssignmentExpression`, or `IsLogicalExpression`, which alone looks under `!`.
    fn is_logical(&self, mut e: ExprId) -> bool {
        if matches!(
            self.f[e].kind,
            ExprKind::Assign {
                op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                ..
            }
        ) {
            return true;
        }
        loop {
            match self.f[e].kind {
                ExprKind::Unary {
                    op: UnOp::Not,
                    operand,
                } => e = operand,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                } => return true,
                _ => return false,
            }
        }
    }

    fn condition(&mut self, e: ExprId, parent: Parent, on_true: FlowId, on_false: FlowId) {
        let saved = (self.true_target, self.false_target);
        self.true_target = on_true;
        self.false_target = on_false;
        if e.is_some() {
            self.expr(e, parent);
        }
        (self.true_target, self.false_target) = saved;
        // An optional chain sees to its own.
        if e.is_none() || !self.is_logical(e) && self.chain_of(e).is_none() {
            let t = self.flow_condition(true, self.flow, e);
            self.add_edge(on_true, t);
            let f = self.flow_condition(false, self.flow, e);
            self.add_edge(on_false, f);
        }
    }

    fn assignment_target(&mut self, e: ExprId) {
        match self.f[e].kind {
            ExprKind::Array(items) => {
                for item in self.f.ids(items) {
                    match self.f[item].kind {
                        ExprKind::Spread(x) => self.assignment_target(x),
                        ExprKind::Assign {
                            op: None, target, ..
                        } => self.assignment_target(target),
                        _ => self.assignment_target(item),
                    }
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    let value = self.f[p].value;
                    if value.is_none() {
                        continue;
                    }
                    match self.f[value].kind {
                        ExprKind::Assign {
                            op: None, target, ..
                        } => self.assignment_target(target),
                        _ => self.assignment_target(value),
                    }
                }
            }
            ExprKind::NonNull(x) => self.assignment_target(x),
            // `(x as T) = v` gives `x` nothing, as far as `GetAssignmentTarget` and `isNarrowableReference` see.
            _ => {
                if let ExprKind::Ident(_) = self.f[e].kind {
                    self.assigned.push(e);
                }
                if self.is_narrowable_reference(e) {
                    self.flow_mutation(Flow::Assign {
                        before: self.flow,
                        target: FlowTarget::Expr(e),
                    });
                }
            }
        }
    }

    /// `IsAssignmentTarget`: `e` is what an assignment, `++`, `--` or the head of a `for`-`in` or `for`-`of` gives a value to, or
    /// part of a pattern that is. Only for what is being bound: it goes by the parents.
    fn is_assignment_target(&self, mut e: ExprId) -> bool {
        loop {
            match self.b.expr_parent[e.idx()] {
                Parent::Expr(p) => match self.f[p].kind {
                    ExprKind::Assign { target, .. } => return target == e,
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    } => return true,
                    ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::NonNull(_) => e = p,
                    _ => return false,
                },
                // The value of `name: value` and of `...value`, and the assignment `{ name = value }` is kept as.
                Parent::Prop(p) => {
                    let owner = self.b.prop_owner[p.idx()];
                    if !matches!(self.f[owner].kind, ExprKind::Object(_))
                        || !matches!(
                            self.f[p].kind,
                            PropKind::Init | PropKind::Spread | PropKind::Shorthand
                        )
                    {
                        return false;
                    }
                    e = owner;
                }
                Parent::Stmt(s) => {
                    return matches!(self.b.stmt_parent[s.idx()], Parent::Stmt(owner)
                        if matches!(self.f[owner].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s));
                }
                _ => return false,
            }
        }
    }

    /// `requiresScopeChangeWorker` says `yes` of something in the parameters that are being gone through.
    fn note_scope_change(&mut self, yes: bool) {
        if yes && self.scope_change_of.is_some() {
            self.b.requires_scope_change[self.scope_change_of.idx()] = true;
        }
    }

    // ───────────────────────────── the file ─────────────────────────────

    fn file(&mut self) {
        // `setCommonJSModuleIndicator`: not in a file that imports or exports.
        if self.f.is_js && (!self.f.has_module_syntax || self.f.is_module_by_decree) {
            self.b.commonjs_indicator = (0..self.f.exprs.len() as u32).map(ExprId).find(|&e| {
                require_argument(self.f, e).is_some()
                    || matches!(
                        assignment_declaration_kind(self.f, e),
                        JsDeclarationKind::ModuleExports
                            | JsDeclarationKind::ExportsProperty(_)
                            | JsDeclarationKind::ObjectDefinePropertyExports
                    )
            });
        }
        let is_module = self.f.has_module_syntax || self.b.commonjs_indicator.is_some();
        let symbol = self.new_symbol(
            Atom::NONE,
            SymFlags::VALUE_MODULE,
            Decl::File,
            SymbolId::NONE,
        );
        self.b.file_symbol = symbol;
        let exports = self.new_table();
        self.b.symbols[symbol.idx()].exports = exports;
        self.push_scope(
            ScopeKind::File,
            if is_module { symbol } else { SymbolId::NONE },
        );
        self.flow = self.new_flow(Flow::Start {
            outer: FlowId::NONE,
            arrow: false,
        });
        // `setExportContextFlag`: in a declaration file that exports nothing explicitly, everything is exported.
        let all_exported = is_module
            && self.f.kind == FileKind::Declaration
            && !self.has_export_statements(self.f.body);
        self.stmts(self.f.body, Parent::File, all_exported);
        // The attributes of `import .. with { .. }` and `export .. with { .. }` are kept beside the statements.
        if !self.f.import_attributes.is_empty() {
            self.flow = self.new_flow(Flow::Start {
                outer: FlowId::NONE,
                arrow: false,
            });
            for i in 0..self.f.import_attributes.len() {
                let (_, attributes) = self.f.import_attributes[i];
                self.expr(attributes, Parent::File);
            }
        }
        // `declareCommonJSVariable`
        if self.b.commonjs_indicator.is_some() {
            let locals = self.b.scopes[self.scope.idx()].locals;
            for name in [known::module, known::exports] {
                if !self.tables[locals.idx()].contains_key(&name) {
                    let flags = SymFlags::FUNCTION_SCOPED_VARIABLE | SymFlags::MODULE_EXPORTS;
                    self.declare_in(locals, name, flags, Decl::CommonJsVariable, SymbolId::NONE);
                }
            }
        }
        if is_module {
            self.bind_commonjs_type_exports(symbol);
        }
        self.pop_scope();
    }

    /// `bindCommonJSTypeExports`: the types and namespaces `module` exports next to `export =` are exports of the `export =` symbol
    /// as well, which is a namespace then.
    fn bind_commonjs_type_exports(&mut self, module: SymbolId) {
        let exports = &self.tables[self.b.symbols[module.idx()].exports.idx()];
        let Some(&equals) = exports.get(&known::export_equals) else {
            return;
        };
        let promoted: Vec<(Atom, SymbolId)> = exports
            .iter()
            .filter(|&(&name, &symbol)| {
                name != known::export_equals
                    && self.b.symbols[symbol.idx()]
                        .flags
                        .intersects(SymFlags::TYPE | SymFlags::NAMESPACE)
            })
            .map(|(&name, &symbol)| (name, symbol))
            .collect();
        if promoted.is_empty() {
            return;
        }
        if self.b.symbols[equals.idx()].exports.is_none() {
            let table = self.new_table();
            self.b.symbols[equals.idx()].exports = table;
        }
        let table = self.b.symbols[equals.idx()].exports;
        self.tables[table.idx()].extend(promoted);
        self.b.symbols[equals.idx()].flags |= SymFlags::NAMESPACE_MODULE;
    }

    /// `hasExportDeclarations`
    fn has_export_statements(&self, list: IdList<StmtId>) -> bool {
        self.f.ids(list).any(|s| {
            matches!(
                self.f[s].kind,
                StmtKind::ExportNamed(_)
                    | StmtKind::ExportAssign(_)
                    | StmtKind::ExportDefault(_)
                    | StmtKind::ExportStar { .. }
            )
        })
    }

    /// The nearest scope that is more than a block: `container`, where `scope` is `blockScopeContainer`.
    fn container_scope(&self, mut scope: ScopeId) -> ScopeId {
        loop {
            let s = &self.b.scopes[scope.idx()];
            let is_container = matches!(
                s.kind,
                ScopeKind::File
                    | ScopeKind::Module(_)
                    | ScopeKind::Fn(_)
                    | ScopeKind::Class(_)
                    | ScopeKind::Interface(_)
                    | ScopeKind::Enum(_)
            );
            if is_container || s.parent.is_none() {
                return scope;
            }
            scope = s.parent;
        }
    }

    /// `lookupName`: what goes by `name` in `scope` itself, or among the exports of what `scope` is the body of.
    fn lookup_name(&self, name: Atom, scope: ScopeId) -> Option<SymbolId> {
        let s = &self.b.scopes[scope.idx()];
        if let Some(&local) = self.tables[s.locals.idx()].get(&name) {
            return Some(local);
        }
        if s.symbol.is_none() {
            return None;
        }
        self.tables[self.b.symbols[s.symbol.idx()].exports.idx()]
            .get(&name)
            .copied()
    }

    /// `lookupEntity`: `a`, or `a.b` where `a` is a function and a namespace that exports `b`.
    fn lookup_entity(&self, e: ExprId, scope: ScopeId) -> Option<SymbolId> {
        if self.is_in_parens(e) {
            return None;
        }
        match self.f[e].kind {
            ExprKind::Ident(name) => self.lookup_name(name, scope),
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } if !self.is_private_name_at(name_pos) => {
                let ExpandoFunction::Declared(owner) =
                    self.expando_function(self.lookup_entity(obj, scope)?)?
                else {
                    return None;
                };
                let exports = self.b.symbols[owner.idx()].exports;
                if exports.is_none() {
                    return None;
                }
                self.tables[exports.idx()].get(&name).copied()
            }
            _ => None,
        }
    }

    /// `getInitializerSymbol`: the function `symbol` is declared as, or the one it is initialized with if it is a constant.
    fn expando_function(&self, symbol: SymbolId) -> Option<ExpandoFunction> {
        for &decl in &self.b.symbols[symbol.idx()].decls {
            match decl {
                Decl::Fn(f) if matches!(self.b.fns[f.idx()].owner, FnOwner::Stmt(_)) => {
                    return Some(ExpandoFunction::Declared(symbol));
                }
                Decl::Var(pat) => {
                    let PatParent::Var(d) = self.b.pat_parent[pat.idx()] else {
                        return None;
                    };
                    let decl = &self.f[d];
                    if (decl.kind == VarKind::Const || self.f.is_js)
                        && decl.init.is_some()
                        && !self.is_in_parens(decl.init)
                    {
                        return self.expando_initializer(decl.init, decl.ty.is_some());
                    }
                    return None;
                }
                // In JavaScript a class can be added to as well.
                Decl::Class(_) if self.f.is_js => return Some(ExpandoFunction::Declared(symbol)),
                // The value declaration decides: the first that is no namespace.
                Decl::Class(_) | Decl::Enum(_) | Decl::Param(_) => return None,
                _ => {}
            }
        }
        None
    }

    /// Whether something that is no assignment declares `name` among the exports of the function `symbol`: a namespace that is one
    /// with it, or a class, whose static members and `prototype` are there.
    fn has_export(&self, symbol: SymbolId, name: Atom) -> bool {
        let s = &self.b.symbols[symbol.idx()];
        s.exports.is_some() && self.tables[s.exports.idx()].contains_key(&name)
            || s.decls.iter().any(|&d| {
                matches!(d, Decl::Class(c) if name == known::prototype
                    || self.f[c].members.iter().any(|m| self.f[m].flags.contains(Flags::STATIC) && self.f[m].key == PropKey::Name(name)))
            })
    }

    /// `IsDynamicName`, `isLateBindableAST`: a literal, in parentheses or not, or an entity name.
    fn can_name_an_expando(&self, key: ExprId) -> bool {
        match self.f[key].kind {
            ExprKind::String(_) | ExprKind::Number(_) => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            _ => self.is_entity_name(key),
        }
    }

    /// `IsExpandoInitializer`: what can be added to by assigning, if `init` is such a thing.
    fn expando_initializer(&self, init: ExprId, is_annotated: bool) -> Option<ExpandoFunction> {
        match self.f[init].kind {
            ExprKind::Fn(func) => Some(ExpandoFunction::Expr(func)),
            ExprKind::Class(c) if self.f.is_js => {
                Some(ExpandoFunction::Declared(self.b.class_symbol[c.idx()]))
            }
            ExprKind::Object(props) if self.f.is_js && props.is_empty() && !is_annotated => {
                Some(ExpandoFunction::Object(init))
            }
            _ => None,
        }
    }

    /// The first declaration of a property of `owner`. The property is `name` or, if `name` is `NONE`, the one that the numeric
    /// literal `key` names. `a["0"]` and `a[0]` do not match: the binder cannot spell a number.
    fn first_expando_declaration<K: Copy + PartialEq>(
        &self,
        named: &[(K, Atom, ExprId)],
        keyed: &[(K, ExprId, ExprId)],
        owner: K,
        name: Atom,
        key: ExprId,
    ) -> Option<ExprId> {
        if name.is_some() {
            return named
                .iter()
                .find(|x| x.0 == owner && x.1 == name)
                .map(|x| x.2);
        }
        let ExprKind::Number(number) = self.f[key].kind else {
            return None;
        };
        let value = self.f.numbers[number as usize];
        keyed
            .iter()
            .find(|x| x.0 == owner && matches!(self.f[x.1].kind, ExprKind::Number(other) if self.f.numbers[other as usize] == value))
            .map(|x| x.2)
    }

    /// `getInitializerSymbol(lookupEntity(e))`: the function, class or object literal that `e.name = value`, written in `scope`,
    /// adds a property to.
    fn expando_owner(&self, e: ExprId, scope: ScopeId) -> Option<ExpandoFunction> {
        if let Some(symbol) = self
            .lookup_entity(e, scope)
            .or_else(|| self.lookup_entity(e, self.container_scope(scope)))
        {
            return self.expando_function(symbol);
        }
        if !self.f.is_js || self.is_in_parens(e) {
            return None;
        }
        // `IsEntityNameExpressionEx` with `allowJS`: `a.b`, `a["b"]`, `a[0]`.
        let (obj, name, key) = match self.f[e].kind {
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } if name.is_some() && !self.is_private_name_at(name_pos) => (obj, name, ExprId::NONE),
            ExprKind::Index { obj, index, .. } if self.is_string_or_numeric_literal_like(index) => {
                (obj, string_literal_text(self.f, index), index)
            }
            _ => return None,
        };
        // `symbol.ValueDeclaration` is the first declaration. The lists are still in binding order here.
        let b = &self.b;
        let first = match self.expando_owner(obj, scope)? {
            ExpandoFunction::Declared(s) => self.first_expando_declaration(
                &b.declared_fn_expandos,
                &b.declared_fn_keyed_expandos,
                s,
                name,
                key,
            ),
            ExpandoFunction::Expr(f) => self.first_expando_declaration(
                &b.fn_expr_expandos,
                &b.fn_expr_keyed_expandos,
                f,
                name,
                key,
            ),
            ExpandoFunction::Object(o) => self.first_expando_declaration(
                &b.object_expandos,
                &b.object_keyed_expandos,
                o,
                name,
                key,
            ),
        }?;
        // `getInitializerSymbol` has a case for a binary expression in JavaScript and none for a call. It takes the right side as
        // written: `({})` is not an expando initializer.
        let ExprKind::Assign { value, .. } = self.f[first].kind else {
            return None;
        };
        if self.is_in_parens(value) {
            return None;
        }
        self.expando_initializer(value, false)
    }

    /// `GetContainerFlags`: an object literal and the attributes of a JSX element are containers without locals, so `lookupName`
    /// finds nothing for an expression written directly in one. A computed member name is bound inside its member or class,
    /// which does not declare the enclosing names either.
    fn is_in_container_without_locals(&self, e: ExprId) -> bool {
        let mut parent = self.b.expr_parent[e.idx()];
        loop {
            parent = match parent {
                Parent::Expr(outer) if outer.is_some() => self.b.expr_parent[outer.idx()],
                Parent::Prop(_) | Parent::MemberKey => return true,
                Parent::Key(literal) => return literal.is_some(),
                _ => return false,
            };
        }
    }

    /// `bindDeferredExpandoAssignment`: `f.name = value`, `f[key] = value` and, in JavaScript,
    /// `Object.defineProperty(f, key, descriptor)` declare a property of `f`. `f` is a function declared in the block that
    /// contains the declaration or in the enclosing function, namespace or file, or a constant there that is initialized with a
    /// function. In JavaScript `f` can also be a class, or any variable initialized with a function, a class or `{}`.
    fn collect_expandos(&mut self) {
        for (e, scope) in std::mem::take(&mut self.expando_assignments) {
            if self.is_in_container_without_locals(e) {
                continue;
            }
            // `getParentOfPropertyAssignment`, `GetNonAssignedNameOfDeclaration`. `key` is `NONE` for `obj.name`.
            let (obj, name, key) = match self.f[e].kind {
                ExprKind::Assign { target, .. } => {
                    // `GetAssignmentDeclarationKind` tests the JavaScript kinds before `JSDeclarationKindProperty`.
                    if self.is_in_parens(target)
                        || assignment_declaration_kind(self.f, e) != JsDeclarationKind::None
                    {
                        continue;
                    }
                    match self.f[target].kind {
                        ExprKind::Dot {
                            obj,
                            name,
                            name_pos,
                            ..
                        } if !self.is_private_name_at(name_pos) => (obj, name, ExprId::NONE),
                        ExprKind::Index { obj, index, .. } => {
                            (obj, string_literal_text(self.f, index), index)
                        }
                        _ => continue,
                    }
                }
                ExprKind::Call(_) => {
                    let Some((obj, key)) = define_property_call(self.f, e) else {
                        continue;
                    };
                    (obj, string_literal_text(self.f, key), key)
                }
                _ => continue,
            };
            if name.is_none() && key.is_none() {
                continue;
            }
            let Some(owner) = self.expando_owner(obj, scope) else {
                continue;
            };
            match owner {
                // A declaration that is not an expando keeps the name.
                ExpandoFunction::Declared(symbol)
                    if name.is_some() && self.has_export(symbol, name) =>
                {
                    continue;
                }
                // `getDeclarationName`: the text of a literal key.
                ExpandoFunction::Declared(symbol) if name.is_some() => {
                    self.b.declared_fn_expandos.push((symbol, name, e))
                }
                ExpandoFunction::Expr(func) if name.is_some() => {
                    self.b.fn_expr_expandos.push((func, name, e))
                }
                ExpandoFunction::Object(literal) if name.is_some() => {
                    self.b.object_expandos.push((literal, name, e))
                }
                // A key such as `a + b` or `-1` names no property.
                _ if !self.can_name_an_expando(key) => {}
                // The checker names a number and a late-bound key.
                ExpandoFunction::Declared(symbol) => {
                    self.b.declared_fn_keyed_expandos.push((symbol, key, e))
                }
                ExpandoFunction::Expr(func) => self.b.fn_expr_keyed_expandos.push((func, key, e)),
                // `checkObjectLiteral` takes the exports as the binder left them: a late-bound name never reaches an object literal.
                ExpandoFunction::Object(literal)
                    if matches!(self.f[key].kind, ExprKind::Number(_)) =>
                {
                    self.b.object_keyed_expandos.push((literal, key, e))
                }
                ExpandoFunction::Object(_) => {}
            }
            self.b.expando_declarations.push(e);
        }
        self.b
            .declared_fn_expandos
            .sort_unstable_by_key(|x| (x.0, x.1, x.2));
        self.b
            .fn_expr_expandos
            .sort_unstable_by_key(|x| (x.0, x.1, x.2));
        self.b
            .declared_fn_keyed_expandos
            .sort_unstable_by_key(|x| (x.0, x.2));
        self.b
            .fn_expr_keyed_expandos
            .sort_unstable_by_key(|x| (x.0, x.2));
        self.b
            .object_expandos
            .sort_unstable_by_key(|x| (x.0, x.1, x.2));
        self.b
            .object_keyed_expandos
            .sort_unstable_by_key(|x| (x.0, x.2));
        self.b.expando_declarations.sort_unstable();
    }

    /// `bindThisPropertyAssignment`, `getThisClassAndSymbolTable`: in a constructor, a method, an accessor, an initializer or a static
    /// block, `this.name = value` and `this["name"] = value` declare a property of the class. In a function of its own they declare
    /// nothing, and neither does `this.#name = value`. A numeric key is not collected: the binder cannot spell a number.
    fn collect_this_properties(&mut self) {
        if !self.f.is_js {
            return;
        }
        for i in 0..self.f.exprs.len() {
            let e = ExprId(i as u32);
            if assignment_declaration_kind(self.f, e) != JsDeclarationKind::ThisProperty {
                continue;
            }
            let ExprKind::Assign { target, .. } = self.f[e].kind else {
                continue;
            };
            // `getDeclarationName`
            let name = match self.f[target].kind {
                ExprKind::Dot { name, name_pos, .. } if !self.is_private_name_at(name_pos) => name,
                ExprKind::Index { index, .. } => string_literal_text(self.f, index),
                _ => continue,
            };
            if name.is_none() {
                continue;
            }
            let b = &self.b;
            let mut parent = b.expr_parent[i];
            let member = loop {
                parent = match parent {
                    Parent::Expr(x) if x.is_some() => b.expr_parent[x.idx()],
                    Parent::Stmt(s) if s.is_some() => b.stmt_parent[s.idx()],
                    Parent::VarInit(d) => Parent::Stmt(b.var_stmt[d.idx()]),
                    Parent::Prop(p) => Parent::Expr(b.prop_owner[p.idx()]),
                    Parent::Case(c) => Parent::Stmt(b.case_stmt[c.idx()]),
                    Parent::FnBody(_) | Parent::ParamDefault(_) => {
                        let f = match parent {
                            Parent::FnBody(f) => f,
                            Parent::ParamDefault(p) => b.param_fn[p.idx()],
                            _ => unreachable!(),
                        };
                        match b.fns[f.idx()].owner {
                            FnOwner::Expr(owner) if self.f[f].kind == FnKind::Arrow => {
                                b.expr_parent[owner.idx()]
                            }
                            FnOwner::Member(m) => break Some(m),
                            _ => break None,
                        }
                    }
                    Parent::MemberInit(m) => break Some(m),
                    _ => break None,
                };
            };
            if let Some(m) = member
                && let MemberOwner::Class(class) = b.member_owner[m.idx()]
            {
                let is_static = self.f[m].flags.contains(Flags::STATIC)
                    || self.f[m].kind == MemberKind::StaticBlock;
                self.b.this_properties.push((class, is_static, name, e));
            }
        }
        self.b.this_properties.sort_unstable();
    }

    fn finish(mut self) -> Bound {
        self.part_exports_of_themselves();
        // Names, now that everything is declared.
        let idents = std::mem::take(&mut self.idents);
        let tables = &self.tables;
        let file = self.f;
        // `Resolve`: the functions that have an `arguments` of their own.
        let has_arguments = |b: &Bound, f: FnId| match file[f].kind {
            FnKind::Decl | FnKind::Expr | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                true
            }
            // A method of a class or an object literal, not a method signature.
            FnKind::Method => !matches!(b.fns[f.idx()].owner, FnOwner::Member(m)
                if matches!(b.member_owner[m.idx()], MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_))),
            _ => false,
        };
        // `Err`: the arguments object of a function.
        let resolve = |b: &Bound, mut scope: ScopeId, name: Atom| -> Result<SymbolId, ()> {
            // `lastLocation`: the kind of the scope the search has just left.
            let mut from = ScopeKind::Block;
            while scope.is_some() {
                let s = &b.scopes[scope.idx()];
                if let Some(&symbol) = tables[s.locals.idx()].get(&name)
                    && b.symbols[symbol.idx()]
                        .flags
                        .intersects(SymFlags::VALUE | SymFlags::ALIAS)
                    && b.is_seen_from(from, b.symbols[symbol.idx()].flags, SymFlags::VALUE)
                {
                    return Ok(symbol);
                }
                // Nothing goes by the name `default` where it is exported. Of an enum and a namespace that are one symbol, the enum
                // sees the members only and the namespace all but the members.
                if s.symbol.is_some()
                    && name != known::default
                    && let Some(&symbol) =
                        tables[b.symbols[s.symbol.idx()].exports.idx()].get(&name)
                    && !b.symbols[symbol.idx()]
                        .flags
                        .contains(SymFlags::EXPORT_ONLY)
                    && b.symbols[symbol.idx()].flags.intersects(match s.kind {
                        ScopeKind::Enum(_) => SymFlags::ENUM_MEMBER,
                        _ => (SymFlags::VALUE | SymFlags::ALIAS) & SymFlags::MODULE_MEMBER,
                    })
                {
                    return Ok(symbol);
                }
                if name == known::arguments
                    && let ScopeKind::Fn(f) = s.kind
                    && has_arguments(b, f)
                {
                    return Err(());
                }
                from = s.kind;
                scope = s.parent;
            }
            Ok(SymbolId::NONE)
        };
        for (expr, scope) in idents {
            let ExprKind::Ident(name) = self.f[expr].kind else {
                continue;
            };
            // `getResolvedSymbol`: a missing identifier is not looked up, though a declaration whose name is missing goes by "".
            if name == known::empty {
                continue;
            }
            let Ok(symbol) = resolve(&self.b, scope, name) else {
                self.b.arguments_objects.push(expr);
                continue;
            };
            self.b.expr_symbol[expr.idx()] = symbol;
            if symbol.is_none() {
                self.b.free_idents.push((expr, scope));
            } else if !self.b.symbols[symbol.idx()]
                .flags
                .intersects(SymFlags::VALUE)
            {
                self.b.alias_idents.push((expr, scope));
            }
        }
        for expr in std::mem::take(&mut self.assigned) {
            let symbol = self.b.expr_symbol[expr.idx()];
            if symbol.is_some() {
                self.b.symbols[symbol.idx()].flags |= SymFlags::ASSIGNED;
                self.b.assignments.push((symbol, expr));
            }
        }
        self.b.assignments.sort_unstable_by_key(|a| (a.0.0, a.1.0));
        self.b.type_query_operands.sort_unstable();
        self.b.free_idents.sort_unstable_by_key(|f| f.0);
        self.b.alias_idents.sort_unstable_by_key(|a| a.0);
        self.b.arguments_objects.sort_unstable();
        self.b.infer_positions.sort_unstable_by_key(|p| p.0);
        self.collect_expandos();
        self.collect_this_properties();
        // Tables, flat and sorted.
        for table in &self.tables {
            let start = self.b.entries.len() as u32;
            self.b
                .entries
                .extend(table.iter().map(|(&name, &symbol)| (name, symbol)));
            self.b.entries[start as usize..].sort_unstable_by_key(|e| e.0);
            self.b.tables.push((start, table.len() as u32));
        }
        // Labels.
        for i in 0..self.b.flow.len() {
            if let Some(edges) = self.label_edges.get(&(i as u32)) {
                let start = self.b.flow_edges.len() as u32;
                self.b.flow_edges.extend_from_slice(edges);
                let len = edges.len() as u32;
                self.b.flow[i] = match self.b.flow[i] {
                    Flow::Loop { .. } => Flow::Loop { start, len },
                    _ => Flow::Label { start, len },
                };
            }
        }
        let mut seen = crate::util::FxHashSet::default();
        self.b.specifiers.retain(|s| seen.insert(*s));
        self.b.ambient_specifiers.retain(|s| seen.insert(*s));
        self.b.symbols.shrink_to_fit();
        self.b.flow.shrink_to_fit();
        self.b
    }

    fn list(&mut self, items: &[u32]) -> (u32, u32) {
        let start = self.b.ids.len() as u32;
        self.b.ids.extend_from_slice(items);
        (start, items.len() as u32)
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// Function declarations first: they are there from the top of the block.
    fn stmts(&mut self, list: IdList<StmtId>, parent: Parent, all_exported: bool) {
        for s in self.f.ids(list) {
            if matches!(self.f[s].kind, StmtKind::Fn(_)) {
                self.stmt(s, parent, all_exported);
            }
        }
        for s in self.f.ids(list) {
            if !matches!(self.f[s].kind, StmtKind::Fn(_)) {
                self.stmt(s, parent, all_exported);
            }
        }
    }

    fn optional_stmt(&mut self, s: StmtId, parent: Parent) {
        if s.is_some() {
            self.stmt(s, parent, false);
        }
    }

    fn block_scoped(&mut self, s: StmtId, parent: Parent) {
        self.stmt(s, parent, false);
    }

    fn stmt(&mut self, id: StmtId, parent: Parent, all_exported: bool) {
        self.b.stmt_parent[id.idx()] = parent;
        self.b.stmt_flow[id.idx()] = self.flow;
        let around_reached = std::mem::replace(&mut self.is_reached, self.flow != UNREACHABLE);
        let me = Parent::Stmt(id);
        let is_exported = |flags: Flags| all_exported || flags.contains(Flags::EXPORT);
        match self.f[id].kind {
            StmtKind::Empty => {}
            StmtKind::Expr(e) => {
                self.expr(e, me);
                self.maybe_call_flow(e);
            }
            StmtKind::Var(decls) => {
                for d in decls.iter() {
                    self.b.var_stmt[d.idx()] = id;
                    self.var_decl(d, is_exported(self.f[d].flags), false);
                }
            }
            StmtKind::Fn(func) => {
                let f = &self.f[func];
                let symbol = if f.flags.contains(Flags::DEFAULT) {
                    let excludes = SymFlags::VALUE
                        .difference(SymFlags::FUNCTION | SymFlags::VALUE_MODULE | SymFlags::CLASS);
                    self.declare_default(f.name, SymFlags::FUNCTION, excludes, Decl::Fn(func))
                } else {
                    // `parseFunctionDeclaration`: the name that is missing is an identifier without text.
                    let name = if f.name.is_some() {
                        f.name
                    } else {
                        known::empty
                    };
                    self.declare(
                        self.scope,
                        name,
                        SymFlags::FUNCTION,
                        Decl::Fn(func),
                        is_exported(f.flags),
                    )
                };
                self.b.fn_symbol[func.idx()] = symbol;
                self.func(func, FnOwner::Stmt(id));
            }
            StmtKind::Class(class) => {
                let c = &self.f[class];
                let symbol = if c.flags.contains(Flags::DEFAULT) {
                    let excludes = (SymFlags::VALUE | SymFlags::TYPE).difference(
                        SymFlags::VALUE_MODULE | SymFlags::INTERFACE | SymFlags::FUNCTION,
                    );
                    self.declare_default(c.name, SymFlags::CLASS, excludes, Decl::Class(class))
                } else if c.name.is_none() {
                    // `declareSymbolEx`: what has no name goes in no table, exported or not.
                    self.new_symbol(
                        known::default,
                        SymFlags::CLASS,
                        Decl::Class(class),
                        SymbolId::NONE,
                    )
                } else {
                    self.declare(
                        self.scope,
                        c.name,
                        SymFlags::CLASS,
                        Decl::Class(class),
                        is_exported(c.flags),
                    )
                };
                self.b.class_symbol[class.idx()] = symbol;
                self.class(class, ClassOwner::Stmt(id));
            }
            StmtKind::Interface(interface) => {
                let i = &self.f[interface];
                let symbol = if i.flags.contains(Flags::DEFAULT) {
                    let excludes = SymFlags::TYPE.difference(SymFlags::INTERFACE | SymFlags::CLASS);
                    self.declare_default(
                        i.name,
                        SymFlags::INTERFACE,
                        excludes,
                        Decl::Interface(interface),
                    )
                } else {
                    self.declare(
                        self.scope,
                        i.name,
                        SymFlags::INTERFACE,
                        Decl::Interface(interface),
                        is_exported(i.flags),
                    )
                };
                self.b.interface_symbol[interface.idx()] = symbol;
                // `ContainerFlagsIsInterface`: a `this` in it says nothing of what is around.
                let seen_this = self.seen_this;
                self.push_scope(ScopeKind::Interface(interface), SymbolId::NONE);
                self.type_params(i.type_params, FnId::NONE);
                for t in self.f.ids(i.extends) {
                    self.ty(t);
                }
                self.members(i.members, MemberOwner::Interface(interface));
                self.pop_scope();
                self.seen_this = seen_this;
            }
            StmtKind::TypeAlias(alias) => {
                let a = &self.f[alias];
                let symbol = self.declare(
                    self.scope,
                    a.name,
                    SymFlags::TYPE_ALIAS,
                    Decl::Alias(alias),
                    is_exported(a.flags),
                );
                self.b.alias_symbol[alias.idx()] = symbol;
                self.b.alias_scope[alias.idx()] =
                    self.push_scope(ScopeKind::TypeParams, SymbolId::NONE);
                self.type_params(a.type_params, FnId::NONE);
                self.by_alias = true;
                self.ty(a.ty);
                self.by_alias = false;
                self.pop_scope();
            }
            StmtKind::Enum(e) => {
                let decl = &self.f[e];
                let flags = if decl.flags.contains(Flags::CONST) {
                    SymFlags::ENUM | SymFlags::CONST_ENUM
                } else {
                    SymFlags::ENUM
                };
                let symbol = self.declare(
                    self.scope,
                    decl.name,
                    flags,
                    Decl::Enum(e),
                    is_exported(decl.flags),
                );
                self.b.enum_symbol[e.idx()] = symbol;
                if self.b.symbols[symbol.idx()].exports.is_none() {
                    let exports = self.new_table();
                    self.b.symbols[symbol.idx()].exports = exports;
                }
                let exports = self.b.symbols[symbol.idx()].exports;
                self.push_scope(ScopeKind::Enum(e), symbol);
                // `forEachYieldExpression` does not look into an enum.
                let counted = self.yields.len();
                for m in decl.members.iter() {
                    // `bindPropertyOrMethodOrAccessor`: a member with a computed name gets a symbol that is in no table.
                    let member = if self.f[m].name.is_none() {
                        self.new_symbol(
                            Atom::NONE,
                            SymFlags::ENUM_MEMBER,
                            Decl::EnumMember(m),
                            symbol,
                        )
                    } else {
                        self.declare_in(
                            exports,
                            self.f[m].name,
                            SymFlags::ENUM_MEMBER,
                            Decl::EnumMember(m),
                            symbol,
                        )
                    };
                    self.b.enum_member_symbol[m.idx()] = member;
                    self.b.enum_member_owner[m.idx()] = e;
                    if self.f[m].init.is_some() {
                        self.expr(self.f[m].init, Parent::EnumInit(m));
                    }
                }
                self.yields.truncate(counted);
                self.pop_scope();
            }
            StmtKind::Module(m) => self.module(m, id, all_exported),
            StmtKind::Return(e) => {
                self.returns.push(id.0);
                let is_reached = self.flow != UNREACHABLE;
                if e.is_some() {
                    self.expr(e, me);
                }
                if self.return_target.is_some() {
                    self.add_edge(self.return_target, self.flow);
                }
                self.flow = UNREACHABLE;
                self.has_flow_effects |= is_reached;
            }
            StmtKind::Throw(e) => {
                let is_reached = self.flow != UNREACHABLE;
                self.expr(e, me);
                self.flow = UNREACHABLE;
                self.has_flow_effects |= is_reached;
            }
            StmtKind::If { test, yes, no } => {
                let (then_label, else_label, post) = (
                    self.branch_label(),
                    self.branch_label(),
                    self.branch_label(),
                );
                self.condition(test, me, then_label, else_label);
                self.flow = self.finish_label(then_label);
                self.block_scoped(yes, me);
                self.add_edge(post, self.flow);
                self.flow = self.finish_label(else_label);
                self.optional_stmt(no, me);
                self.add_edge(post, self.flow);
                self.flow = self.finish_label(post);
            }
            StmtKind::While { test, body } => {
                let (pre, pre_body, post) =
                    (self.loop_label(), self.branch_label(), self.branch_label());
                self.enter_loop(pre);
                self.condition(test, me, pre_body, post);
                self.flow = self.finish_label(pre_body);
                self.iteration(body, me, post, pre, pre);
                self.add_edge(pre, self.flow);
                self.flow = self.finish_label(post);
            }
            StmtKind::DoWhile { body, test } => {
                let (pre, pre_condition, post) =
                    (self.loop_label(), self.branch_label(), self.branch_label());
                self.enter_loop(pre);
                self.iteration(body, me, post, pre_condition, pre_condition);
                self.add_edge(pre_condition, self.flow);
                self.flow = self.finish_label(pre_condition);
                self.condition(test, me, pre, post);
                self.flow = self.finish_label(post);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.push_scope(ScopeKind::Block, SymbolId::NONE);
                let (pre, pre_body, pre_increment, post) = (
                    self.loop_label(),
                    self.branch_label(),
                    self.branch_label(),
                    self.branch_label(),
                );
                self.optional_stmt(init, me);
                self.enter_loop(pre);
                self.condition(test, me, pre_body, post);
                self.flow = self.finish_label(pre_body);
                // `bindForStatement`: `continue` with a label of the loop goes round without what is done after each turn.
                self.iteration(body, me, post, pre_increment, pre);
                self.add_edge(pre_increment, self.flow);
                self.flow = self.finish_label(pre_increment);
                if update.is_some() {
                    self.expr(update, me);
                }
                self.add_edge(pre, self.flow);
                self.flow = self.finish_label(post);
                self.pop_scope();
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                self.push_scope(ScopeKind::Block, SymbolId::NONE);
                let (pre, post) = (self.loop_label(), self.branch_label());
                self.expr(expr, me);
                self.enter_loop(pre);
                self.add_edge(post, self.flow);
                self.b.stmt_parent[left.idx()] = me;
                match self.f[left].kind {
                    StmtKind::Var(decls) => {
                        for d in decls.iter() {
                            self.b.var_stmt[d.idx()] = left;
                            self.var_decl(d, false, true);
                        }
                    }
                    StmtKind::Expr(target) => {
                        self.expr(target, Parent::Stmt(left));
                        self.assignment_target(target);
                    }
                    _ => {}
                }
                self.iteration(body, me, post, pre, pre);
                self.add_edge(pre, self.flow);
                self.flow = self.finish_label(post);
                self.pop_scope();
            }
            StmtKind::Block(list) => {
                self.push_scope(ScopeKind::Block, SymbolId::NONE);
                self.stmts(list, me, false);
                self.pop_scope();
            }
            StmtKind::Switch { expr, cases } => self.switch(id, expr, cases),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => self.try_stmt(id, block, param, handler, finalizer),
            StmtKind::Break(label) => self.jump(label, false),
            StmtKind::Continue(label) => self.jump(label, true),
            StmtKind::Labeled { label, body } => {
                // `bindChildren`: nothing is said of one control does not get to.
                let is_reached = self.flow != UNREACHABLE;
                let post = self.branch_label();
                self.labels.push((label, post, FlowId::NONE, false));
                self.stmt(body, me, false);
                if self.labels.pop().is_some_and(|l| !l.3) && is_reached {
                    self.b.unused_labels.push(id);
                }
                self.add_edge(post, self.flow);
                self.flow = self.finish_label(post);
            }
            StmtKind::Import(import) => {
                let i = &self.f[import];
                self.statement_specifier(i.spec);
                let type_only = if i.type_only {
                    SymFlags::TYPE_ONLY
                } else {
                    SymFlags::empty()
                };
                if i.default.is_some() {
                    self.declare(
                        self.scope,
                        i.default,
                        SymFlags::ALIAS | type_only,
                        Decl::ImportDefault(import),
                        false,
                    );
                }
                if i.namespace.is_some() {
                    self.declare(
                        self.scope,
                        i.namespace,
                        SymFlags::ALIAS | type_only,
                        Decl::ImportNamespace(import),
                        false,
                    );
                }
                for spec in i.named.iter() {
                    // `IsTypeOnlyImportDeclaration`: `import { type a }`
                    let type_only = if self.f[spec].type_only {
                        SymFlags::TYPE_ONLY
                    } else {
                        type_only
                    };
                    self.declare(
                        self.scope,
                        self.f[spec].local,
                        SymFlags::ALIAS | type_only,
                        Decl::ImportSpec(spec),
                        false,
                    );
                }
            }
            StmtKind::ImportEquals(import) => {
                let i = &self.f[import];
                if let ImportEqualsTarget::Require(spec) = i.target {
                    self.statement_specifier(spec);
                }
                let type_only = if i.flags.contains(Flags::TYPE_ONLY) {
                    SymFlags::TYPE_ONLY
                } else {
                    SymFlags::empty()
                };
                // `declareModuleMember`: an alias is exported only if it says so itself.
                let exported = i.flags.contains(Flags::EXPORT);
                self.declare(
                    self.scope,
                    i.name,
                    SymFlags::ALIAS | type_only,
                    Decl::ImportEquals(import),
                    exported,
                );
                self.b.import_equals_scope[import.idx()] = self.scope;
            }
            StmtKind::ExportNamed(export) => {
                let e = &self.f[export];
                self.statement_specifier(e.spec);
                self.b.export_scope[export.idx()] = self.scope;
                for spec in e.items.iter() {
                    self.export_as(
                        self.f[spec].exported,
                        SymFlags::ALIAS | SymFlags::EXPORT_ONLY,
                        Decl::ExportSpec(spec),
                    );
                }
            }
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                ..
            } => {
                self.statement_specifier(spec);
                if alias.is_some() {
                    let type_only = if type_only {
                        SymFlags::TYPE_ONLY
                    } else {
                        SymFlags::empty()
                    };
                    self.export_as(
                        alias,
                        SymFlags::ALIAS | SymFlags::EXPORT_ONLY | type_only,
                        Decl::ExportStarAs(id),
                    );
                } else {
                    let container = self.b.scopes[self.scope.idx()].symbol;
                    if container.is_some() {
                        self.b.export_stars.push((container, spec));
                        self.b.export_star_type_only.push(type_only);
                    }
                }
            }
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                self.expr(e, me);
                let name = if matches!(self.f[id].kind, StmtKind::ExportDefault(_)) {
                    known::default
                } else {
                    known::export_equals
                };
                // `ExpressionIsAlias`: `export default name` stands for everything `name` means, and a class expression for the class.
                let is_alias = self.is_entity_name(e)
                    || matches!(self.f[e].kind, ExprKind::Class(_)) && !self.is_in_parens(e);
                let flags = if is_alias {
                    SymFlags::ALIAS
                } else {
                    SymFlags::EXPORT_VALUE
                } | SymFlags::EXPORT_ONLY;
                let symbol = self.new_symbol(name, flags, Decl::ExportExpr(id), SymbolId::NONE);
                self.export_if_vacant(name, symbol);
                self.b.expr_scope.insert(e, self.scope);
            }
            StmtKind::ExportAsNamespace(name) => {
                // `bindNamespaceExportDeclaration`: only at the top of a declaration file that is a module.
                if self.f.kind == FileKind::Declaration
                    && self.f.has_module_syntax
                    && matches!(self.b.scopes[self.scope.idx()].kind, ScopeKind::File)
                {
                    let symbol = self.new_symbol(
                        name,
                        SymFlags::ALIAS | SymFlags::EXPORT_ONLY,
                        Decl::UmdGlobal(id),
                        SymbolId::NONE,
                    );
                    self.b.umd_globals.push((name, symbol));
                }
            }
        }
        self.is_reached = around_reached;
    }

    fn is_in_parens(&self, e: ExprId) -> bool {
        is_in_parens(self.f, e)
    }

    /// Whether the name written at `pos` is a `#name`.
    fn is_private_name_at(&self, pos: u32) -> bool {
        is_private_name_at(self.f, pos)
    }

    /// `IsEntityNameExpression`
    fn is_entity_name(&self, e: ExprId) -> bool {
        !self.is_in_parens(e)
            && match self.f[e].kind {
                ExprKind::Ident(_) => true,
                ExprKind::Dot {
                    obj,
                    name_pos,
                    chain: Chain::No,
                    ..
                } => !self.is_private_name_at(name_pos) && self.is_entity_name(obj),
                _ => false,
            }
    }

    /// `bindBreakOrContinueStatement`
    fn jump(&mut self, label: Atom, is_continue: bool) {
        // `bindChildren`: nothing is made of what control does not get to, and it is no use of the label.
        if self.flow == UNREACHABLE {
            return;
        }
        let target = if label.is_some() {
            self.labels
                .iter_mut()
                .rev()
                .find(|l| l.0 == label)
                .map_or(FlowId::NONE, |l| {
                    l.3 = true;
                    if is_continue { l.2 } else { l.1 }
                })
        } else if is_continue {
            self.continue_target
        } else {
            self.break_target
        };
        // `bindBreakOrContinueFlow`: with nowhere to go, control just goes on.
        if target.is_some() {
            self.add_edge(target, self.flow);
            self.flow = UNREACHABLE;
            self.has_flow_effects = true;
        }
    }

    /// `bindIterativeStatement`. `labeled_continue`: where `continue label` goes if the loop is what `label` labels.
    fn iteration(
        &mut self,
        body: StmtId,
        parent: Parent,
        break_target: FlowId,
        continue_target: FlowId,
        labeled_continue: FlowId,
    ) {
        let saved = (self.break_target, self.continue_target);
        self.break_target = break_target;
        self.continue_target = continue_target;
        // `setContinueTarget`
        if let Parent::Stmt(loop_stmt) = parent {
            let mut at = loop_stmt;
            let mut depth = self.labels.len();
            while let Parent::Stmt(p) = self.b.stmt_parent[at.idx()]
                && matches!(self.f[p].kind, StmtKind::Labeled { .. })
                && depth > 0
            {
                depth -= 1;
                self.labels[depth].2 = labeled_continue;
                at = p;
            }
        }
        self.stmt(body, parent, false);
        (self.break_target, self.continue_target) = saved;
    }

    /// `maybeBindExpressionFlowIfCall`: of a call as it is written, which `(f())` is not.
    fn maybe_call_flow(&mut self, e: ExprId) {
        if let ExprKind::Call(c) = self.f[e].kind
            && !self.is_in_parens(e)
        {
            let callee = self.f[c].callee;
            // `super(..)` got its own where it was bound.
            if !matches!(self.f[callee].kind, ExprKind::Super) && self.is_dotted_name(callee) {
                self.flow_call(e);
            }
        }
    }

    /// `IsDottedName`
    fn is_dotted_name(&self, e: ExprId) -> bool {
        match self.f[e].kind {
            ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::NewTarget
            | ExprKind::ImportMeta => true,
            ExprKind::Dot { obj, .. } => self.is_dotted_name(obj),
            _ => false,
        }
    }

    fn switch(&mut self, id: StmtId, expr: ExprId, cases: Span<CaseId>) {
        let me = Parent::Stmt(id);
        let post = self.branch_label();
        self.expr(expr, me);
        let saved = (self.break_target, self.pre_switch);
        self.break_target = post;
        self.pre_switch = self.flow;
        self.push_scope(ScopeKind::Block, SymbolId::NONE);
        // `bindCaseBlock`: the keyword as it is written, which `(true)` is not.
        let is_narrowing = matches!(self.f[expr].kind, ExprKind::True) && !self.is_in_parens(expr)
            || self.is_narrowing_expression(expr);
        let mut fallthrough = UNREACHABLE;
        let n = cases.len();
        let mut i = 0;
        while i < n {
            let start = i;
            while self.f[cases.at(i)].body.is_empty() && i + 1 < n {
                if fallthrough == UNREACHABLE {
                    self.flow = self.pre_switch;
                }
                self.case(cases.at(i), id);
                i += 1;
            }
            let pre_case = self.branch_label();
            let entered = if is_narrowing && self.pre_switch != UNREACHABLE {
                self.new_flow(Flow::Switch {
                    before: self.pre_switch,
                    stmt: id,
                    from: start as u16,
                    to: (i + 1) as u16,
                })
            } else {
                self.pre_switch
            };
            self.add_edge(pre_case, entered);
            self.add_edge(pre_case, fallthrough);
            self.flow = self.finish_label(pre_case);
            self.case(cases.at(i), id);
            fallthrough = self.flow;
            if i + 1 < n && self.flow != UNREACHABLE {
                self.b.case_fallthrough[cases.at(i).idx()] = self.flow;
            }
            i += 1;
        }
        self.pop_scope();
        self.add_edge(post, self.flow);
        let has_default = cases.iter().any(|c| self.f[c].test.is_none());
        if !has_default {
            let none = if self.pre_switch != UNREACHABLE {
                self.new_flow(Flow::Switch {
                    before: self.pre_switch,
                    stmt: id,
                    from: 0,
                    to: 0,
                })
            } else {
                UNREACHABLE
            };
            self.add_edge(post, none);
        }
        (self.break_target, self.pre_switch) = saved;
        self.flow = self.finish_label(post);
    }

    fn case(&mut self, case: CaseId, stmt: StmtId) {
        self.b.case_stmt[case.idx()] = stmt;
        let c = &self.f[case];
        if c.test.is_some() {
            let saved = self.flow;
            self.flow = self.pre_switch;
            self.expr(c.test, Parent::Case(case));
            self.flow = saved;
        }
        // `bindCaseOrDefaultClause`: as they are written, function declarations too.
        for s in self.f.ids(c.body) {
            self.stmt(s, Parent::Stmt(stmt), false);
        }
    }

    fn try_stmt(
        &mut self,
        id: StmtId,
        block: StmtId,
        param: VarDeclId,
        handler: StmtId,
        finalizer: StmtId,
    ) {
        let me = Parent::Stmt(id);
        let saved = (self.return_target, self.exception_target);
        let normal_exit = self.branch_label();
        let return_label = self.branch_label();
        let mut exception_label = self.branch_label();
        if finalizer.is_some() {
            self.return_target = return_label;
        }
        self.add_edge(exception_label, self.flow);
        self.exception_target = exception_label;
        self.stmt(block, me, false);
        self.add_edge(normal_exit, self.flow);
        if handler.is_some() {
            self.flow = self.finish_label(exception_label);
            exception_label = self.branch_label();
            self.add_edge(exception_label, self.flow);
            self.exception_target = exception_label;
            self.push_scope(ScopeKind::Block, SymbolId::NONE);
            if param.is_some() {
                self.b.var_stmt[param.idx()] = id;
                self.var_decl(param, false, false);
            }
            self.stmt(handler, me, false);
            self.pop_scope();
            self.add_edge(normal_exit, self.flow);
        }
        (self.return_target, self.exception_target) = saved;
        if finalizer.is_some() {
            let finally_label = self.branch_label();
            for from in [normal_exit, exception_label, return_label] {
                for edge in self.label_edges[&from.0].clone() {
                    self.add_edge(finally_label, edge);
                }
            }
            self.flow = if self.has_edges(finally_label) {
                finally_label
            } else {
                UNREACHABLE
            };
            self.stmt(finalizer, me, false);
            if self.flow != UNREACHABLE {
                // Whoever comes out of the block goes on the way they came in: by returning, by throwing, or normally.
                let end = self.flow;
                if self.return_target.is_some() && self.has_edges(return_label) {
                    let reduced = self.new_flow(Flow::Reduce {
                        before: end,
                        label: finally_label,
                        instead: return_label,
                    });
                    self.add_edge(self.return_target, reduced);
                }
                if self.exception_target.is_some() && self.has_edges(exception_label) {
                    let reduced = self.new_flow(Flow::Reduce {
                        before: end,
                        label: finally_label,
                        instead: exception_label,
                    });
                    self.add_edge(self.exception_target, reduced);
                }
                self.flow = if self.has_edges(normal_exit) {
                    self.new_flow(Flow::Reduce {
                        before: end,
                        label: finally_label,
                        instead: normal_exit,
                    })
                } else {
                    UNREACHABLE
                };
            }
        } else {
            self.flow = self.finish_label(normal_exit);
        }
    }

    fn module(&mut self, m: ModuleId, stmt: StmtId, all_exported: bool) {
        let decl = &self.f[m];
        let ambient = decl.flags.contains(Flags::AMBIENT) || self.f.kind == FileKind::Declaration;
        let instantiated = self.is_module_instantiated(m);
        self.b.module_instantiated[m.idx()] = instantiated;
        let is_at_top = matches!(self.b.scopes[self.scope.idx()].kind, ScopeKind::File);
        // `IsModuleAugmentationExternal`: it adds to a module that is declared elsewhere.
        let is_augmentation = if is_at_top {
            self.f.has_module_syntax
        } else {
            self.ambient_module_around().is_some()
        };
        // `bindModuleDeclaration`: a module that is declared here is a value whatever is in it.
        let flags =
            if instantiated || !matches!(decl.name, ModuleName::Ident(_)) && !is_augmentation {
                SymFlags::VALUE_MODULE
            } else {
                SymFlags::NAMESPACE_MODULE
            };
        // `declareSymbolAndAddToSymbolTable`: what a script declares, be it in a block, is global.
        let is_global = !self.f.has_module_syntax
            && matches!(
                self.b.scopes[self.container_scope(self.scope).idx()].kind,
                ScopeKind::File
            );
        let symbol = match decl.name {
            ModuleName::Ident(name) => self.declare(
                self.scope,
                name,
                flags,
                Decl::Module(m),
                all_exported || decl.flags.contains(Flags::EXPORT),
            ),
            // `declareModuleMember`: a local of what it is written in, under a name nothing can refer to. 2435
            ModuleName::String(name) if !is_global && !is_augmentation => {
                self.new_symbol(name, flags, Decl::Module(m), SymbolId::NONE)
            }
            ModuleName::String(name) => {
                // `collectModuleReferences`: what adds to a module has to find it, like one that is imported. At the top of a script
                // it is the module.
                if !is_at_top || self.f.has_module_syntax && ambient {
                    self.statement_specifier(name);
                }
                let existing = self
                    .b
                    .ambient_modules
                    .iter()
                    .find(|a| a.0 == name)
                    .map(|a| a.1);
                match existing {
                    Some(symbol) => {
                        let there = &mut self.b.symbols[symbol.idx()];
                        there.flags |= flags;
                        there.decls.push(Decl::Module(m));
                        symbol
                    }
                    None => {
                        let symbol = self.new_symbol(name, flags, Decl::Module(m), SymbolId::NONE);
                        self.b.ambient_modules.push((name, symbol));
                        symbol
                    }
                }
            }
            ModuleName::Global => {
                let symbol = self.new_symbol(known::global, flags, Decl::Module(m), SymbolId::NONE);
                // `collectModuleReferences`: anywhere else it adds to nothing. 2669
                if is_augmentation {
                    self.b.global_augmentations.push(symbol);
                }
                symbol
            }
        };
        self.b.module_symbol[m.idx()] = symbol;
        if self.b.symbols[symbol.idx()].exports.is_none() {
            let exports = self.new_table();
            self.b.symbols[symbol.idx()].exports = exports;
        }
        // `setExportContextFlag`: in an ambient module that exports nothing explicitly, everything is exported.
        let everything = ambient && !self.has_export_statements(decl.body);
        self.push_scope(ScopeKind::Module(m), symbol);
        // `GetContainerFlags`: in the body the flow of control starts afresh, and nothing known outside holds.
        let saved = (
            self.flow,
            self.break_target,
            self.continue_target,
            self.return_target,
            self.exception_target,
            std::mem::take(&mut self.labels),
        );
        self.flow = self.new_flow(Flow::Start {
            outer: FlowId::NONE,
            arrow: false,
        });
        self.break_target = FlowId::NONE;
        self.continue_target = FlowId::NONE;
        self.return_target = FlowId::NONE;
        self.exception_target = FlowId::NONE;
        let seen_this = self.seen_this;
        // `forEachYieldExpression` does not look into a namespace.
        let counted = self.yields.len();
        self.stmts(decl.body, Parent::Module(m), everything);
        self.yields.truncate(counted);
        self.seen_this = seen_this;
        (
            self.flow,
            self.break_target,
            self.continue_target,
            self.return_target,
            self.exception_target,
            self.labels,
        ) = saved;
        self.pop_scope();
        // `IsAmbientModule`
        if !matches!(decl.name, ModuleName::Ident(_)) {
            self.bind_commonjs_type_exports(symbol);
        }
        let _ = stmt;
    }

    /// `GetModuleInstanceState(m) != NonInstantiated`, of a namespace declared in the scope the binder is in.
    fn is_module_instantiated(&self, m: ModuleId) -> bool {
        // The statement lists around, innermost last.
        let mut outer = Vec::new();
        let mut scope = self.scope;
        while scope.is_some() {
            let s = &self.b.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Module(around) => outer.push(self.f[around].body),
                ScopeKind::File => outer.push(self.f.body),
                _ => {}
            }
            scope = s.parent;
        }
        outer.reverse();
        self.is_namespace_instantiated(m, &mut outer, &mut Vec::new())
    }

    /// `getModuleInstanceState`. `busy`: the namespaces being asked about, which count for nothing meanwhile.
    fn is_namespace_instantiated(
        &self,
        m: ModuleId,
        outer: &mut Vec<IdList<StmtId>>,
        busy: &mut Vec<ModuleId>,
    ) -> bool {
        let module = &self.f[m];
        if !module.has_body {
            return true;
        }
        if busy.contains(&m) {
            return false;
        }
        busy.push(m);
        outer.push(module.body);
        let is = self
            .f
            .ids(module.body)
            .any(|s| self.is_instantiated(s, outer, busy));
        outer.pop();
        busy.pop();
        is
    }

    /// `getModuleInstanceStateWorker`
    fn is_instantiated(
        &self,
        s: StmtId,
        outer: &mut Vec<IdList<StmtId>>,
        busy: &mut Vec<ModuleId>,
    ) -> bool {
        match self.f[s].kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Import(_) => false,
            StmtKind::ImportEquals(i) => self.f[i].flags.contains(Flags::EXPORT),
            StmtKind::Module(m) => self.is_namespace_instantiated(m, outer, busy),
            // `type` on it or on a name plays no part.
            StmtKind::ExportNamed(e) if self.f[e].spec.is_none() => self.f[e]
                .items
                .iter()
                .any(|i| self.is_alias_target_instantiated(i, &outer[..], busy)),
            _ => true,
        }
    }

    /// `getModuleInstanceStateForAliasTarget`
    fn is_alias_target_instantiated(
        &self,
        spec: ExportSpecId,
        outer: &[IdList<StmtId>],
        busy: &mut Vec<ModuleId>,
    ) -> bool {
        let ExportSpec {
            local: name,
            local_pos,
            ..
        } = self.f[spec];
        // `export { "a" }`
        if matches!(self.f.text.get(local_pos as usize), Some(b'"' | b'\'')) {
            return true;
        }
        for depth in (0..outer.len()).rev() {
            let mut found = false;
            let mut around = outer[..=depth].to_vec();
            for s in self.f.ids(outer[depth]) {
                if !self.stmt_has_name(s, name) {
                    continue;
                }
                if self.is_instantiated(s, &mut around, busy)
                    || matches!(self.f[s].kind, StmtKind::ImportEquals(_))
                {
                    return true;
                }
                found = true;
            }
            if found {
                return false;
            }
        }
        // Not to be found: it could be a value.
        true
    }

    /// `NodeHasName`
    fn stmt_has_name(&self, s: StmtId, name: Atom) -> bool {
        match self.f[s].kind {
            StmtKind::Fn(x) => self.f[x].name == name,
            StmtKind::Class(x) => self.f[x].name == name,
            StmtKind::Interface(x) => self.f[x].name == name,
            StmtKind::TypeAlias(x) => self.f[x].name == name,
            StmtKind::Enum(x) => self.f[x].name == name,
            StmtKind::Module(x) => match self.f[x].name {
                ModuleName::Ident(n) => n == name,
                ModuleName::Global => name == known::global,
                ModuleName::String(_) => false,
            },
            StmtKind::ImportEquals(x) => self.f[x].name == name,
            StmtKind::ExportAsNamespace(n) => n == name,
            StmtKind::Var(decls) => decls
                .iter()
                .any(|d| matches!(self.f[self.f[d].pat].kind, PatKind::Ident(n) if n == name)),
            _ => false,
        }
    }

    fn var_decl(&mut self, d: VarDeclId, exported: bool, always_assigned: bool) {
        let decl = &self.f[d];
        let (scope, mut flags) = match decl.kind {
            VarKind::Var => (self.var_scope(), SymFlags::FUNCTION_SCOPED_VARIABLE),
            _ => (self.scope, SymFlags::BLOCK_SCOPED_VARIABLE),
        };
        if matches!(
            decl.kind,
            VarKind::Const | VarKind::Using | VarKind::AwaitUsing
        ) {
            flags |= SymFlags::CONST;
        }
        let around_reached = std::mem::replace(&mut self.is_reached, self.flow != UNREACHABLE);
        // `bindVariableDeclarationFlow`: as they are written.
        self.pat(decl.pat, PatParent::Var(d), scope, flags, exported, false);
        if decl.ty.is_some() {
            self.ty(decl.ty);
        }
        if decl.init.is_some() {
            self.expr(decl.init, Parent::VarInit(d));
        }
        if decl.init.is_some() || always_assigned {
            self.initialized(decl.pat, Some(d));
        }
        self.is_reached = around_reached;
    }

    fn initialized(&mut self, pat: PatId, decl: Option<VarDeclId>) {
        match self.f[pat].kind {
            PatKind::Ident(_) => {
                let target = match decl {
                    Some(d) => FlowTarget::Var(d),
                    None => FlowTarget::Pat(pat),
                };
                self.flow_mutation(Flow::Assign {
                    before: self.flow,
                    target,
                });
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    self.initialized(self.f[p].value, None);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.initialized(self.f[e].pat, None);
                }
            }
            PatKind::Missing => {}
        }
    }

    fn pat(
        &mut self,
        pat: PatId,
        parent: PatParent,
        scope: ScopeId,
        flags: SymFlags,
        exported: bool,
        is_param: bool,
    ) {
        self.b.pat_parent[pat.idx()] = parent;
        match self.f[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(name) => {
                // `bindVariableDeclarationOrBindingElement`: what is required is an alias of it.
                let (flags, decl) = match () {
                    _ if is_param => (flags, Decl::Param(pat)),
                    _ if self.b.required_by(self.f, pat).is_some() => {
                        (SymFlags::ALIAS, Decl::Require(pat))
                    }
                    _ => (flags, Decl::Var(pat)),
                };
                self.b.pat_symbol[pat.idx()] = self.declare(scope, name, flags, decl, exported);
                if !is_param
                    && scope != self.scope
                    && flags.contains(SymFlags::FUNCTION_SCOPED_VARIABLE)
                {
                    self.b.hoisted_vars.push((pat, self.scope));
                }
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    let prop = &self.f[p];
                    // `requiresScopeChangeWorker`: `...rest` answers for itself.
                    let scope_change_of = self.scope_change_of;
                    if prop.is_rest {
                        self.note_scope_change(self.options.before_es2017);
                        self.scope_change_of = FnId::NONE;
                    }
                    if let PropKey::Computed(key) = prop.key {
                        self.expr(key, Parent::Key(ExprId::NONE));
                    }
                    // `bindBindingElementFlow`: the default is worked out before what it is the default of.
                    if prop.default.is_some() {
                        self.conditional_default(prop.default, Parent::PatPropDefault(p));
                    }
                    self.pat(
                        prop.value,
                        PatParent::Prop(pat, p),
                        scope,
                        flags,
                        exported,
                        is_param,
                    );
                    self.scope_change_of = scope_change_of;
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    let elem = &self.f[e];
                    if elem.default.is_some() {
                        self.conditional_default(elem.default, Parent::PatElemDefault(e));
                    }
                    self.pat(
                        elem.pat,
                        PatParent::Elem(pat, e),
                        scope,
                        flags,
                        exported,
                        is_param,
                    );
                }
            }
        }
    }

    /// `bindInitializer`: a default may or may not be evaluated.
    fn conditional_default(&mut self, e: ExprId, parent: Parent) {
        let post = self.branch_label();
        self.add_edge(post, self.flow);
        self.expr(e, parent);
        self.add_edge(post, self.flow);
        self.flow = self.finish_label(post);
    }

    // ───────────────────────────── functions and classes ─────────────────────────────

    /// `list_of`: the function they are the type parameters of, if it is one.
    fn type_params(&mut self, params: Span<TypeParamId>, list_of: FnId) {
        for p in params.iter() {
            let symbol = self.declare(
                self.scope,
                self.f[p].name,
                SymFlags::TYPE_PARAMETER,
                Decl::TypeParam(p),
                false,
            );
            self.b.type_param_symbol[p.idx()] = symbol;
            self.b.type_param_scope[p.idx()] = self.scope;
        }
        let has_list = list_of.is_some()
            && params
                .iter()
                .any(|p| self.f[p].constraint.is_some() || self.f[p].default.is_some());
        if has_list {
            self.push_scope(ScopeKind::TypeParamList(list_of), SymbolId::NONE);
        }
        for p in params.iter() {
            let tp = &self.f[p];
            if tp.constraint.is_some() {
                self.ty(tp.constraint);
            }
            if tp.default.is_some() {
                self.ty(tp.default);
            }
        }
        if has_list {
            self.pop_scope();
        }
    }

    fn func(&mut self, id: FnId, owner: FnOwner) {
        let f = &self.f[id];
        // `NodeCanBeDecorated`: only a parameter of a class member can be decorated, and `Binder::class` binds its decorators.
        let is_class_member = matches!(owner, FnOwner::Member(m) if matches!(self.b.member_owner[m.idx()], MemberOwner::Class(_)));
        if !is_class_member && !f.params.is_empty() && !self.f.decorators.is_empty() {
            let counted = self.yields.len();
            // What `function_key` left for this function is not for a function in a decorator.
            let from_name = (
                std::mem::take(&mut self.this_in_name),
                std::mem::replace(&mut self.flow_after_name, FlowId::NONE),
            );
            for i in 0..self.f.decorators.len() {
                let (of, e) = self.f.decorators[i];
                if let DecoratorOwner::Param(p) = of
                    && f.params.range().contains(&p.idx())
                {
                    self.expr(e, Parent::FnBody(id));
                    self.b.refused_decorators.push(e);
                }
            }
            (self.this_in_name, self.flow_after_name) = from_name;
            self.yields.truncate(counted);
        }
        // `Resolve`: the name of a function expression comes after all that is in the function, `arguments` too.
        let has_own_name = f.kind == FnKind::Expr && f.name.is_some();
        if has_own_name {
            let around = self.push_scope(ScopeKind::Block, SymbolId::NONE);
            self.b.fn_symbol[id.idx()] =
                self.declare(around, f.name, SymFlags::FUNCTION, Decl::Fn(id), false);
        }
        let scope = self.push_scope(ScopeKind::Fn(id), SymbolId::NONE);
        let saved_this =
            std::mem::replace(&mut self.seen_this, std::mem::take(&mut self.this_in_name));
        let outer_member = std::mem::replace(&mut self.cur_member, MemberId::NONE);
        // `requiresScopeChangeWorker` enters no function, but goes through a static block as through any statement.
        let outer_scope_change = self.scope_change_of;
        if f.kind != FnKind::StaticBlock {
            self.scope_change_of = FnId::NONE;
        }
        // `IsObjectLiteralOrClassExpressionMethodOrAccessor`
        let is_in_expression = match owner {
            FnOwner::Expr(_) => true,
            FnOwner::Member(m) => {
                matches!(self.b.member_owner[m.idx()], MemberOwner::Class(c) if matches!(self.b.class_owner[c.idx()], ClassOwner::Expr(_)))
            }
            _ => false,
        };
        let continues_outer = matches!(f.kind, FnKind::Expr | FnKind::Arrow)
            || (matches!(f.kind, FnKind::Method | FnKind::Getter | FnKind::Setter)
                && is_in_expression);
        let saved = (
            self.flow,
            self.break_target,
            self.continue_target,
            self.return_target,
            self.exception_target,
            self.true_target,
            self.false_target,
            self.cur_fn,
            std::mem::take(&mut self.labels),
            std::mem::take(&mut self.returns),
            std::mem::take(&mut self.yields),
        );
        // `getImmediatelyInvokedFunctionExpression`
        let is_invoked = matches!(f.kind, FnKind::Expr | FnKind::Arrow)
            && matches!(owner, FnOwner::Expr(e) if matches!(self.b.expr_parent[e.idx()], Parent::Expr(call)
                if matches!(self.f[call].kind, ExprKind::Call(c) if self.f[c].callee == e)));
        // `isImmediatelyInvoked` of `bindContainer`: nothing starts here, the flow of control around goes on through it.
        let runs_in_place = f.kind == FnKind::StaticBlock
            || is_invoked && !f.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
        let arrow = f.kind == FnKind::Arrow;
        let after_name = std::mem::replace(&mut self.flow_after_name, FlowId::NONE);
        if after_name.is_some() {
            // `bindContainer`: it started before the computed name.
            self.flow = after_name;
        } else if !runs_in_place && f.kind != FnKind::IndexSignature {
            // `GetContainerFlags`: an index signature has locals, but the flow of control goes on through it too.
            self.flow = self.new_flow(if is_invoked {
                Flow::StartInvoked {
                    outer: saved.0,
                    plain: false,
                    arrow,
                }
            } else {
                Flow::Start {
                    outer: if continues_outer {
                        saved.0
                    } else {
                        FlowId::NONE
                    },
                    arrow,
                }
            });
        }
        self.break_target = FlowId::NONE;
        self.continue_target = FlowId::NONE;
        // Where a constructor is left, by whichever way, is where its class's properties have to have a value. Where what runs in
        // place is left is where the flow of control around goes on: a `return` is a jump to there.
        self.return_target = if f.kind == FnKind::Constructor || runs_in_place {
            self.branch_label()
        } else {
            FlowId::NONE
        };
        self.exception_target = FlowId::NONE;
        self.true_target = FlowId::NONE;
        self.false_target = FlowId::NONE;
        self.cur_fn = id;

        self.type_params(f.type_params, id);
        // Only what a block declares is not seen from the parameters and the return type.
        let has_body_locals = matches!(f.body, FnBody::Block(_));
        let has_param_scope = has_body_locals && (f.this_ty.is_some() || !f.params.is_empty());
        if has_param_scope {
            self.push_scope(ScopeKind::Param(id), SymbolId::NONE);
        }
        if f.this_ty.is_some() {
            self.ty(f.this_ty);
        }
        for p in f.params.iter() {
            self.b.param_fn[p.idx()] = id;
            let param = &self.f[p];
            if param.ty.is_some() {
                self.ty(param.ty);
            }
            // `requiresScopeChange` looks at the name and the initializer. `bindParameterFlow`: the initializer comes first.
            self.scope_change_of = id;
            if param.default.is_some() {
                self.conditional_default(param.default, Parent::ParamDefault(p));
            }
            self.pat(
                param.pat,
                PatParent::Param(p),
                scope,
                SymFlags::FUNCTION_SCOPED_VARIABLE | SymFlags::PARAMETER,
                false,
                true,
            );
            self.scope_change_of = FnId::NONE;
        }
        if has_param_scope {
            self.pop_scope();
        }
        if f.ret.is_some() {
            if has_body_locals {
                self.push_scope(ScopeKind::ReturnType(id), SymbolId::NONE);
            }
            self.ty(f.ret);
            if has_body_locals {
                self.pop_scope();
            }
        }
        match f.body {
            FnBody::None => {}
            FnBody::Block(stmts) => self.stmts(stmts, Parent::FnBody(id), false),
            FnBody::Expr(e) => self.expr(e, Parent::FnBody(id)),
        }
        let end = if matches!(f.body, FnBody::Block(_)) {
            self.flow
        } else {
            UNREACHABLE
        };
        let exit = if self.return_target.is_some() {
            // What runs in place is left at the end of an expression that is its body as well.
            self.add_edge(
                self.return_target,
                if runs_in_place { self.flow } else { end },
            );
            self.finish_label(self.return_target)
        } else {
            FlowId::NONE
        };
        let returns = std::mem::take(&mut self.returns);
        let yields = std::mem::take(&mut self.yields);
        // `forEachYieldExpression` goes through a static block as through any statement: what it yields is for the function around.
        let passes_yields_on = f.kind == FnKind::StaticBlock;
        let (rs, rl) = self.list(&returns);
        let (ys, yl) = self.list(&yields[..if passes_yields_on { 0 } else { yields.len() }]);
        self.b.fns[id.idx()] = FnInfo {
            owner,
            scope,
            enclosing: saved.7,
            returns: IdList::new(rs, rl),
            yields: IdList::new(ys, yl),
            end,
            exit,
            contains_this: self.seen_this,
        };
        // `ContainerFlagsPropagatesThisKeyword`; an index signature is no container of the flow of control at all.
        let propagates = match f.kind {
            FnKind::Arrow
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => true,
            // A method signature.
            FnKind::Method => matches!(owner, FnOwner::Member(m)
                if matches!(self.b.member_owner[m.idx()], MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_))),
            _ => false,
        };
        self.seen_this = saved_this || propagates && self.seen_this;
        self.cur_member = outer_member;
        self.scope_change_of = outer_scope_change;
        (
            self.flow,
            self.break_target,
            self.continue_target,
            self.return_target,
            self.exception_target,
            self.true_target,
            self.false_target,
            self.cur_fn,
            self.labels,
            self.returns,
            self.yields,
        ) = saved;
        if runs_in_place {
            self.flow = exit;
        }
        if passes_yields_on {
            self.yields.extend_from_slice(&yields);
        }
        self.pop_scope();
        if has_own_name {
            self.pop_scope();
        }
    }

    fn class(&mut self, id: ClassId, owner: ClassOwner) {
        let c = &self.f[id];
        self.b.class_owner[id.idx()] = owner;
        // Those of the class do not see its type parameters.
        for i in 0..self.f.decorators.len() {
            let (of, e) = self.f.decorators[i];
            if of == DecoratorOwner::Class(id) {
                self.expr(e, Parent::Decorator(id, of));
                if !self.can_be_decorated(of, id, owner) {
                    self.b.refused_decorators.push(e);
                }
            }
        }
        let scope = self.push_scope(ScopeKind::Class(id), SymbolId::NONE);
        self.b.class_scope[id.idx()] = scope;
        if let ClassOwner::Expr(_) = owner {
            let name = if c.name.is_some() { c.name } else { Atom::NONE };
            let symbol = if name.is_some() {
                self.declare(scope, name, SymFlags::CLASS, Decl::Class(id), false)
            } else {
                self.new_symbol(Atom::NONE, SymFlags::CLASS, Decl::Class(id), SymbolId::NONE)
            };
            self.b.class_symbol[id.idx()] = symbol;
        }
        self.type_params(c.type_params, FnId::NONE);
        if c.extends.is_some() {
            // To `requiresScopeChangeWorker` what is extended is a type.
            let scope_change_of = std::mem::replace(&mut self.scope_change_of, FnId::NONE);
            self.expr(c.extends, Parent::ClassExtends(id));
            self.scope_change_of = scope_change_of;
        }
        for t in self.f.ids(c.extends_args) {
            self.ty(t);
        }
        for t in self.f.ids(c.implements) {
            self.ty(t);
        }
        // Those of members and parameters see what the class sees, not what is in the method. Of a member
        // `requiresScopeChangeWorker` looks at the name alone.
        let scope_change_of = std::mem::replace(&mut self.scope_change_of, FnId::NONE);
        for i in 0..self.f.decorators.len() {
            let (of, e) = self.f.decorators[i];
            let is_here = match of {
                DecoratorOwner::Class(_) => false,
                DecoratorOwner::Member(m) => c.members.range().contains(&m.idx()),
                DecoratorOwner::Param(p) => c.members.iter().any(|m| {
                    let func = self.f[m].func;
                    func.is_some() && self.f[func].params.range().contains(&p.idx())
                }),
            };
            if is_here {
                // `forEachYieldExpression` looks at nothing of a method, an accessor or a constructor but its computed name.
                let counted = self.yields.len();
                self.expr(e, Parent::Decorator(id, of));
                let of_a_function = match of {
                    DecoratorOwner::Member(m) => self.f[m].func.is_some(),
                    DecoratorOwner::Param(_) => true,
                    DecoratorOwner::Class(_) => false,
                };
                if of_a_function {
                    self.yields.truncate(counted);
                }
                if !self.can_be_decorated(of, id, owner) {
                    self.b.refused_decorators.push(e);
                }
            }
        }
        self.scope_change_of = scope_change_of;
        self.members(c.members, MemberOwner::Class(id));
        self.pop_scope();
    }

    /// `nodeCanBeDecorated`
    fn can_be_decorated(&self, of: DecoratorOwner, class: ClassId, owner: ClassOwner) -> bool {
        let legacy = self.f.legacy_decorators;
        let is_declaration = matches!(owner, ClassOwner::Stmt(_));
        let in_a_fitting_class = !legacy || is_declaration;
        let has_body = |func: FnId| func.is_some() && !matches!(self.f[func].body, FnBody::None);
        match of {
            DecoratorOwner::Class(_) => in_a_fitting_class,
            DecoratorOwner::Member(m) => {
                let member = &self.f[m];
                if legacy && matches!(member.key, PropKey::Private(_)) {
                    return false;
                }
                match member.kind {
                    MemberKind::Property => {
                        in_a_fitting_class
                            && (legacy
                                || !member.flags.intersects(Flags::ABSTRACT | Flags::AMBIENT))
                    }
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                        in_a_fitting_class && has_body(member.func)
                    }
                    _ => false,
                }
            }
            DecoratorOwner::Param(p) => {
                let Some(m) = self.f[class].members.iter().find(|&m| {
                    let func = self.f[m].func;
                    func.is_some() && self.f[func].params.range().contains(&p.idx())
                }) else {
                    return false;
                };
                legacy
                    && is_declaration
                    && has_body(self.f[m].func)
                    && matches!(
                        self.f[m].kind,
                        MemberKind::Constructor | MemberKind::Method | MemberKind::Setter
                    )
                    && !matches!(self.f[self.f[p].pat].kind, PatKind::Ident(known::this))
            }
        }
    }

    fn members(&mut self, members: Span<MemberId>, owner: MemberOwner) {
        let is_in_class_expression = matches!(owner, MemberOwner::Class(c) if matches!(self.b.class_owner[c.idx()], ClassOwner::Expr(_)));
        for m in members.iter() {
            self.b.member_owner[m.idx()] = owner;
            let member = &self.f[m];
            let seen_this = self.seen_this;
            // `requiresScopeChangeWorker`: a static property, unless fields are left as they are written.
            if member.kind == MemberKind::Property
                && member.flags.contains(Flags::STATIC)
                && matches!(owner, MemberOwner::Class(_))
            {
                self.note_scope_change(!self.options.emit_standard_class_fields);
            }
            // `GetContainerFlags`: in a property with an initializer the flow of control starts afresh, for its name and its type too,
            // and what is thrown goes nowhere.
            let saved = (self.flow, self.exception_target);
            if member.init.is_some() {
                self.flow = self.new_flow(Flow::Start {
                    outer: FlowId::NONE,
                    arrow: false,
                });
                self.exception_target = FlowId::NONE;
            }
            if let PropKey::Computed(key) = member.key
                // `checkComputedPropertyName`: `[P in K]` outside a mapped type is an error of its own and is not looked at.
                && !(matches!(self.f[key].kind, ExprKind::Binary { op: BinOp::In, .. })
                    && !self.is_in_parens(key)
                    && !matches!(member.kind, MemberKind::Getter | MemberKind::Setter))
            {
                if member.func.is_some() {
                    self.function_key(key, is_in_class_expression);
                } else {
                    self.expr(key, Parent::MemberKey);
                }
            }
            let of_class = if matches!(owner, MemberOwner::Class(_)) {
                m
            } else {
                MemberId::NONE
            };
            let outer_member = std::mem::replace(&mut self.cur_member, of_class);
            // The type of an index signature is the return type of its function, which is bound below.
            if member.ty.is_some() && member.kind != MemberKind::IndexSignature {
                self.ty(member.ty);
            }
            if member.func.is_some() {
                self.func(member.func, FnOwner::Member(m));
            }
            if member.init.is_some() {
                let scope_change_of = std::mem::replace(&mut self.scope_change_of, FnId::NONE);
                self.expr(member.init, Parent::MemberInit(m));
                self.scope_change_of = scope_change_of;
                (self.flow, self.exception_target) = saved;
                // `GetContainerFlags`: a property with an initializer is a container of its own, name and type and all.
                if member.kind == MemberKind::Property && matches!(owner, MemberOwner::Class(_)) {
                    self.seen_this = seen_this;
                }
            }
            self.cur_member = outer_member;
        }
    }

    /// `bindContainer`: the computed name of a method or an accessor is part of it. The flow of control starts afresh before the name
    /// and goes on into the function, which is bound next, and a `this` in the name is one in the function.
    /// `is_in_expression`: `IsObjectLiteralOrClassExpressionMethodOrAccessor`, what is known outside holds.
    fn function_key(&mut self, key: ExprId, is_in_expression: bool) {
        let around = std::mem::replace(&mut self.seen_this, false);
        let saved = (self.flow, self.exception_target);
        self.flow = self.new_flow(Flow::Start {
            outer: if is_in_expression {
                saved.0
            } else {
                FlowId::NONE
            },
            arrow: false,
        });
        self.exception_target = FlowId::NONE;
        self.expr(key, Parent::MemberKey);
        self.flow_after_name = self.flow;
        (self.flow, self.exception_target) = saved;
        self.this_in_name = std::mem::replace(&mut self.seen_this, around);
    }

    // ───────────────────────────── types ─────────────────────────────

    fn tys(&mut self, list: IdList<TypeNodeId>) {
        for t in self.f.ids(list) {
            self.ty(t);
        }
    }

    fn note_infer(&mut self, node: TypeNodeId, position: InferPosition) {
        if node.is_some()
            && let TypeNodeKind::Infer(param) = self.f[node].kind
        {
            self.b.infer_positions.push((param, position));
        }
    }

    fn ty(&mut self, id: TypeNodeId) {
        self.b.type_scope[id.idx()] = self.scope;
        // `requiresScopeChangeWorker` enters no type.
        let scope_change_of = std::mem::replace(&mut self.scope_change_of, FnId::NONE);
        let by_alias = self.by_alias;
        self.b.type_by_alias[id.idx()] = by_alias;
        self.by_alias = by_alias
            && matches!(
                self.f[id].kind,
                TypeNodeKind::Ref { .. }
                    | TypeNodeKind::Union(_)
                    | TypeNodeKind::Intersection(_)
                    | TypeNodeKind::IndexedAccess { .. }
                    | TypeNodeKind::Cond { .. }
                    | TypeNodeKind::Keyof(_)
                    | TypeNodeKind::Readonly(_)
                    | TypeNodeKind::Array(_)
                    | TypeNodeKind::Tuple(_)
            );
        match self.f[id].kind {
            TypeNodeKind::Keyword(Keyword::This) => {
                self.seen_this = true;
                if self.type_literal_depth > 0 {
                    self.b.this_in_type_literal.insert(id);
                }
            }
            TypeNodeKind::Error
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
            TypeNodeKind::Ref { args, .. } => {
                for (i, arg) in self.f.ids(args).enumerate() {
                    self.note_infer(arg, InferPosition::TypeArgument(id, i as u32));
                }
                self.tys(args)
            }
            TypeNodeKind::Typeof { args, expr, .. } => {
                // A type has no place among the expressions: its operand is put in the function, namespace or file around, or in
                // the property of a class, which is what decides `this` in its type and its initializer (`GetThisContainer`).
                let mut scope = self.scope;
                let parent = loop {
                    let s = &self.b.scopes[scope.idx()];
                    match s.kind {
                        ScopeKind::Fn(f) => break Parent::FnBody(f),
                        ScopeKind::Module(m) => break Parent::Module(m),
                        ScopeKind::File => break Parent::File,
                        ScopeKind::Class(_) if self.cur_member.is_some() => {
                            break Parent::MemberInit(self.cur_member);
                        }
                        _ => scope = s.parent,
                    }
                };
                let saved = (self.true_target, self.false_target);
                (self.true_target, self.false_target) = (FlowId::NONE, FlowId::NONE);
                // The `this` of `typeof this.x` is a name, not the keyword.
                let seen_this = self.seen_this;
                self.expr(expr, parent);
                self.seen_this = seen_this;
                (self.true_target, self.false_target) = saved;
                let mut at = expr;
                loop {
                    self.b.type_query_operands.push(at);
                    let ExprKind::Dot { obj, .. } = self.f[at].kind else {
                        break;
                    };
                    at = obj;
                }
                self.tys(args)
            }
            TypeNodeKind::Import { spec, args, .. } => {
                self.specifier(spec);
                self.tys(args);
            }
            TypeNodeKind::Template { types, .. } => {
                for t in self.f.ids(types) {
                    self.note_infer(t, InferPosition::Template);
                }
                self.tys(types)
            }
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => self.tys(types),
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.ty(t)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    let elem = &self.f[e];
                    if elem.rest {
                        self.note_infer(elem.ty, InferPosition::Rest);
                    }
                    // `T?` and `...T` without a name are nodes of their own, which `isResolvedByTypeAlias` does not go through.
                    self.by_alias =
                        by_alias && (elem.name.is_some() || !elem.optional && !elem.rest);
                    self.ty(elem.ty);
                }
            }
            TypeNodeKind::Fn(func) => {
                for p in self.f[func].params.iter() {
                    if self.f[p].flags.contains(Flags::REST) {
                        self.note_infer(self.f[p].ty, InferPosition::Rest);
                    }
                }
                self.func(func, FnOwner::Type(id))
            }
            TypeNodeKind::Object(members) => {
                for m in members.iter() {
                    let func = self.f[m].func;
                    if func.is_some() {
                        for p in self.f[func].params.iter() {
                            if self.f[p].flags.contains(Flags::REST) {
                                self.note_infer(self.f[p].ty, InferPosition::Rest);
                            }
                        }
                    }
                }
                self.type_literal_depth += 1;
                self.members(members, MemberOwner::TypeLiteral(id));
                self.type_literal_depth -= 1;
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                if let (TypeNodeKind::Mapped(checked), TypeNodeKind::Mapped(wanted)) =
                    (self.f[check].kind, self.f[extends].kind)
                    && self.f[checked].ty.is_some()
                {
                    self.note_infer(self.f[wanted].ty, InferPosition::MappedTemplate(checked));
                }
                self.ty(check);
                // `Resolve`: the `infer`s can be named in the true branch alone. What is written in the `extends` type is generic in
                // them all the same (`getOuterTypeParameters`), so their scope is around that too.
                let scope = self.push_scope(ScopeKind::TypeParams, SymbolId::NONE);
                let outer = std::mem::replace(&mut self.infer_scope, scope);
                self.push_scope(ScopeKind::Extends, SymbolId::NONE);
                self.ty(extends);
                self.pop_scope();
                self.infer_scope = outer;
                self.ty(yes);
                self.pop_scope();
                self.ty(no);
            }
            TypeNodeKind::Infer(param) => {
                // Belongs to the conditional type whose `extends` it is in, whatever else it is inside of. In none, only what it
                // extends sees it: `bindTypeParameter`, `Resolve`.
                let is_stray = self.infer_scope.is_none();
                let scope = if is_stray {
                    self.push_scope(ScopeKind::TypeParams, SymbolId::NONE)
                } else {
                    self.infer_scope
                };
                let TypeParam {
                    name, constraint, ..
                } = self.f[param];
                let symbol = self.declare(
                    scope,
                    name,
                    SymFlags::TYPE_PARAMETER,
                    Decl::TypeParam(param),
                    false,
                );
                self.b.type_param_symbol[param.idx()] = symbol;
                self.b.type_param_scope[param.idx()] = scope;
                if constraint.is_some() {
                    // `Resolve`, at an `infer`: what it extends can name it, though not the others of the conditional type.
                    if !is_stray {
                        let own = self.push_scope(ScopeKind::InferConstraint, SymbolId::NONE);
                        let locals = self.b.scopes[own.idx()].locals;
                        self.tables[locals.idx()].insert(name, symbol);
                    }
                    self.ty(constraint);
                    if !is_stray {
                        self.pop_scope();
                    }
                }
                if is_stray {
                    self.pop_scope();
                }
            }
            TypeNodeKind::Mapped(m) => {
                let mapped = &self.f[m];
                self.note_infer(self.f[mapped.param].constraint, InferPosition::MappedKey);
                self.push_scope(ScopeKind::TypeParams, SymbolId::NONE);
                self.type_params(Span::new(mapped.param.0, 1), FnId::NONE);
                if mapped.name_ty.is_some() {
                    self.ty(mapped.name_ty);
                }
                if mapped.ty.is_some() {
                    self.ty(mapped.ty);
                }
                self.pop_scope();
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.ty(obj);
                self.ty(index);
            }
            TypeNodeKind::Predicate { param, ty, .. } => {
                // `this is T`
                if param == known::this {
                    self.seen_this = true;
                }
                if ty.is_some() {
                    self.ty(ty);
                }
            }
        }
        self.by_alias = by_alias;
        self.scope_change_of = scope_change_of;
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn exprs(&mut self, list: IdList<ExprId>, parent: Parent) {
        for e in self.f.ids(list) {
            self.expr(e, parent);
        }
    }

    /// `lookupSymbolForPrivateIdentifierDeclaration`: the innermost class around that declares `#name`, static or not.
    fn private_name(&mut self, id: ExprId, name: Atom) {
        let mut scope = self.scope;
        while scope.is_some() {
            let s = &self.b.scopes[scope.idx()];
            if let ScopeKind::Class(class) = s.kind
                && self.f[class]
                    .members
                    .iter()
                    .any(|m| self.f[m].key == PropKey::Private(name))
            {
                self.b.private_class.insert(id, class);
                return;
            }
            scope = s.parent;
        }
    }

    /// `bind`, of `a.b` and `a[b]`: only what can be narrowed is told where control is. The rest is what it is declared as.
    fn access_flow(&mut self, id: ExprId) {
        if self.is_narrowable_reference(id) {
            self.b.expr_flow[id.idx()] = self.flow;
        }
    }

    fn expr(&mut self, id: ExprId, parent: Parent) {
        self.b.expr_parent[id.idx()] = parent;
        let around_reached = std::mem::replace(&mut self.is_reached, self.flow != UNREACHABLE);
        match self.f[id].kind {
            // Of a declaration file there is no text: there the names the classes around declare tell.
            ExprKind::Dot { name, name_pos, .. }
                if self
                    .f
                    .text
                    .get(name_pos as usize)
                    .is_none_or(|&c| c == b'#') =>
            {
                self.private_name(id, name)
            }
            // `#x in a`
            ExprKind::Binary {
                op: BinOp::In,
                left,
                ..
            } => {
                if let ExprKind::String(name) = self.f[left].kind
                    && self.is_private_name_at(self.f[left].pos)
                {
                    self.private_name(left, name);
                }
            }
            _ => {}
        }
        let me = Parent::Expr(id);
        // Only `!`, `&&`, `||`, `??` and what changes nothing pass the targets of a condition on to their operands.
        let targets = (self.true_target, self.false_target);
        let passes_targets = matches!(
            self.f[id].kind,
            ExprKind::Unary { op: UnOp::Not, .. }
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                }
                | ExprKind::Assign {
                    op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                    ..
                }
        );
        if !passes_targets {
            self.true_target = FlowId::NONE;
            self.false_target = FlowId::NONE;
        }
        // `bindChildren`: only the parts of a pattern hand it on. Parentheses, which the tree does not keep, do not.
        let around_in_pattern = std::mem::replace(&mut self.in_assignment_pattern, false);
        let in_pattern = around_in_pattern && !self.is_in_parens(id);
        // `requiresScopeChangeWorker`: `??` and an optional chain answer for all that is in them, and `f<T>` counts as a type.
        let scope_change_of = self.scope_change_of;
        if scope_change_of.is_some() {
            let answer = match self.f[id].kind {
                ExprKind::Binary {
                    op: BinOp::Nullish, ..
                } => Some(self.options.before_es2020),
                ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }
                    if chain != Chain::No =>
                {
                    Some(self.options.before_es2020)
                }
                ExprKind::Call(c) if self.f[c].chain != Chain::No => {
                    Some(self.options.before_es2020)
                }
                ExprKind::Instantiation { .. } => Some(false),
                _ => None,
            };
            if let Some(yes) = answer {
                self.note_scope_change(yes);
                self.scope_change_of = FnId::NONE;
            }
        }
        // `bind`, `KindCallExpression`: a call in an optional chain is a call expression too.
        if matches!(self.f[id].kind, ExprKind::Call(_)) {
            match assignment_declaration_kind(self.f, id) {
                JsDeclarationKind::ObjectDefinePropertyValue => {
                    self.expando_assignments.push((id, self.scope));
                }
                JsDeclarationKind::ObjectDefinePropertyExports => self.define_property_export(id),
                _ => {}
            }
        }
        match self.f[id].kind {
            ExprKind::Missing
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex
            | ExprKind::ImportMeta
            | ExprKind::NewTarget => {}
            ExprKind::Ident(_) => {
                self.b.expr_flow[id.idx()] = self.flow;
                self.idents.push((id, self.scope));
            }
            ExprKind::This => {
                self.seen_this = true;
                self.b.expr_flow[id.idx()] = self.flow;
            }
            ExprKind::Super => self.b.expr_flow[id.idx()] = self.flow,
            ExprKind::Template { exprs, .. } => self.exprs(exprs, me),
            ExprKind::TaggedTemplate(c) => {
                let call = self.f[c];
                self.expr(call.callee, me);
                self.tys(call.type_args);
                self.exprs(call.args, me);
            }
            ExprKind::Array(items) => {
                self.in_assignment_pattern = in_pattern;
                self.exprs(items, me)
            }
            ExprKind::Object(props) => {
                self.in_assignment_pattern = in_pattern;
                self.props(props, id)
            }
            ExprKind::Fn(func) => self.func(func, FnOwner::Expr(id)),
            ExprKind::Class(class) => self.class(class, ClassOwner::Expr(id)),
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } if chain != Chain::No => {
                self.access_flow(id);
                self.optional_chain_flow(id, parent, targets);
            }
            ExprKind::Call(c) if self.f[c].chain != Chain::No => {
                self.optional_chain_flow(id, parent, targets);
                if let ExprKind::Dot { obj, name, .. } = self.f[self.f[c].callee].kind
                    && (name == known::push || name == known::unshift)
                    && self.is_narrowable_operand(obj)
                {
                    self.flow_mutation(Flow::ArrayMutation {
                        before: self.flow,
                        expr: id,
                    });
                }
            }
            ExprKind::Dot { obj, .. } => {
                self.access_flow(id);
                self.expr(obj, me);
            }
            ExprKind::Index { obj, index, .. } => {
                self.access_flow(id);
                self.expr(obj, me);
                self.expr(index, me);
            }
            // `bindCallExpressionFlow`
            ExprKind::Call(c) => {
                let call = &self.f[c];
                // `collectExternalModuleReferences`: what JavaScript requires is loaded like what it imports.
                if self.f.is_js
                    && let Some(spec) = required_specifier(self.f, id)
                {
                    self.specifier(spec);
                }
                // What an immediately invoked function sees has the arguments evaluated.
                if matches!(self.f[call.callee].kind, ExprKind::Fn(_)) {
                    self.tys(call.type_args);
                    self.exprs(call.args, me);
                    self.expr(call.callee, me);
                } else {
                    self.expr(call.callee, me);
                    self.tys(call.type_args);
                    self.exprs(call.args, me);
                }
                if let ExprKind::Dot { obj, name, .. } = self.f[call.callee].kind
                    && (name == known::push || name == known::unshift)
                    && self.is_narrowable_operand(obj)
                {
                    self.flow_mutation(Flow::ArrayMutation {
                        before: self.flow,
                        expr: id,
                    });
                }
                // From here on there is a `this`.
                if matches!(self.f[call.callee].kind, ExprKind::Super) {
                    self.flow_call(id);
                }
            }
            ExprKind::New(c) => {
                let call = &self.f[c];
                self.expr(call.callee, me);
                self.tys(call.type_args);
                self.exprs(call.args, me);
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not => {
                    (self.true_target, self.false_target) = (targets.1, targets.0);
                    self.expr(operand, me);
                }
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    self.expr(operand, me);
                    self.assignment_target(operand);
                }
                // `bindDeleteExpressionFlow`: only `delete a.b`; not `delete a[b]`, `delete a`, `delete (a.b)`.
                UnOp::Delete => {
                    self.expr(operand, me);
                    if matches!(self.f[operand].kind, ExprKind::Dot { .. })
                        && !self.is_in_parens(operand)
                    {
                        self.assignment_target(operand);
                    }
                }
                _ => self.expr(operand, me),
            },
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => self.logical(id, left, right, targets, false),
            ExprKind::Assign {
                op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                target,
                value,
            } => self.logical(id, target, value, targets, true),
            // `bindBinaryExpressionFlow`: each side of a comma may be a call that asserts something or never returns.
            ExprKind::Binary { op, left, right } => {
                self.expr(left, me);
                if op == BinOp::Comma {
                    self.maybe_call_flow(left);
                }
                self.expr(right, me);
                if op == BinOp::Comma {
                    self.maybe_call_flow(right);
                }
            }
            // `bindDestructuringAssignmentFlow`: a default inside a pattern is worked out before the pattern it is the default of.
            ExprKind::Assign {
                op: None,
                target,
                value,
            } if matches!(
                self.f[target].kind,
                ExprKind::Object(_) | ExprKind::Array(_)
            ) && !self.is_in_parens(target) =>
            {
                if in_pattern {
                    self.expr(value, me);
                    self.in_assignment_pattern = true;
                    self.expr(target, me);
                } else {
                    self.in_assignment_pattern = true;
                    self.expr(target, me);
                    self.in_assignment_pattern = false;
                    self.expr(value, me);
                }
                self.assignment_target(target);
            }
            ExprKind::Assign { target, value, op } => {
                if op.is_none()
                    && matches!(
                        self.f[target].kind,
                        ExprKind::Dot { .. } | ExprKind::Index { .. }
                    )
                {
                    self.expando_assignments.push((id, self.scope));
                }
                self.expr(target, me);
                self.expr(value, me);
                // `bindModuleExportsAssignment`, `bindExportsOrObjectDefineProperty`: wherever it is written, it is the file that exports.
                if self.b.commonjs_indicator.is_some() {
                    // `ExpressionIsAlias`
                    let is_alias = self.is_entity_name(value)
                        || matches!(self.f[value].kind, ExprKind::Class(_))
                            && !self.is_in_parens(value);
                    let declared = match assignment_declaration_kind(self.f, id) {
                        JsDeclarationKind::ModuleExports => Some((
                            known::export_equals,
                            if is_alias {
                                SymFlags::ALIAS
                            } else {
                                SymFlags::EXPORT_VALUE
                            },
                            Decl::ModuleExports(id),
                        )),
                        JsDeclarationKind::ExportsProperty(name) => {
                            let name = match self.f[target].kind {
                                ExprKind::Index { index, .. } if name.is_none() => {
                                    self.literal_name(index)
                                }
                                _ => name,
                            };
                            name.is_some().then_some((
                                name,
                                if is_alias {
                                    SymFlags::ALIAS
                                } else {
                                    SymFlags::FUNCTION_SCOPED_VARIABLE
                                },
                                Decl::ExportsProperty(id),
                            ))
                        }
                        _ => None,
                    };
                    if let Some((name, flags, decl)) = declared {
                        let file = self.b.file_symbol;
                        let exports = self.b.symbols[file.idx()].exports;
                        self.declare_in(exports, name, flags | SymFlags::EXPORT_ONLY, decl, file);
                        self.b.expr_scope.insert(value, self.scope);
                    }
                }
                // As the default of a part of a pattern it assigns nothing itself: the assignment the pattern is the left side of does.
                if !self.is_assignment_target(id) {
                    self.assignment_target(target);
                    if op.is_none()
                        && let ExprKind::Index { obj, .. } = self.f[target].kind
                        && self.is_narrowable_operand(obj)
                    {
                        self.flow_mutation(Flow::ArrayMutation {
                            before: self.flow,
                            expr: id,
                        });
                    }
                }
            }
            // `bindConditionalExpressionFlow`
            ExprKind::Cond { test, yes, no } => {
                let (on_true, on_false, post) = (
                    self.branch_label(),
                    self.branch_label(),
                    self.branch_label(),
                );
                let saved_flow = self.flow;
                let saved_effects = std::mem::replace(&mut self.has_flow_effects, false);
                self.condition(test, me, on_true, on_false);
                self.flow = self.finish_label(on_true);
                self.expr(yes, me);
                self.add_edge(post, self.flow);
                self.flow = self.finish_label(on_false);
                self.expr(no, me);
                self.add_edge(post, self.flow);
                // Which way it went makes no difference afterwards, unless something was assigned to on the way.
                self.flow = if self.has_flow_effects {
                    self.finish_label(post)
                } else {
                    saved_flow
                };
                self.has_flow_effects |= saved_effects;
            }
            ExprKind::Spread(e)
            | ExprKind::Await(e)
            | ExprKind::AsConst(e)
            | ExprKind::NonNull(e)
            | ExprKind::ImportCall(e) => {
                let is_import = matches!(self.f[id].kind, ExprKind::ImportCall(_));
                if is_import && let ExprKind::String(spec) = self.f[e].kind {
                    self.specifier(spec);
                }
                if matches!(self.f[id].kind, ExprKind::Spread(_)) {
                    self.in_assignment_pattern = in_pattern;
                }
                self.expr(e, me);
                // The second argument of `import()`.
                if is_import
                    && let Some(&(_, options)) = self.f.import_options.iter().find(|o| o.0 == e)
                {
                    self.expr(options, me);
                }
            }
            ExprKind::Yield { value, .. } => {
                self.yields.push(id.0);
                if value.is_some() {
                    self.expr(value, me);
                }
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                self.expr(expr, me);
                self.ty(ty);
            }
            // No reference and no assignment target: nothing sees through it.
            ExprKind::Instantiation { expr, type_args } => {
                self.expr(expr, me);
                self.tys(type_args);
            }
            ExprKind::Jsx(j) => {
                // What the tag is made with, and the namespace `JSX` is in, are looked for from here. `markJsxAliasReferenced`
                self.b.expr_scope.insert(id, self.scope);
                let jsx = &self.f[j];
                if jsx.tag.is_some() {
                    self.expr(jsx.tag, me);
                }
                self.tys(jsx.type_args);
                self.props(jsx.attrs, id);
                self.exprs(jsx.children, me);
                if jsx.close_tag.is_some() {
                    self.expr(jsx.close_tag, me);
                }
            }
        }
        (self.true_target, self.false_target) = targets;
        self.in_assignment_pattern = around_in_pattern;
        self.scope_change_of = scope_change_of;
        self.is_reached = around_reached;
    }

    /// `bindExportsOrObjectDefineProperty`, of the call `Object.defineProperty(exports, key, descriptor)`: the file exports a variable
    /// under the name `key` spells.
    fn define_property_export(&mut self, call: ExprId) {
        if self.b.commonjs_indicator.is_none() {
            return;
        }
        let Some((_, key)) = define_property_call(self.f, call) else {
            return;
        };
        let name = self.literal_name(key);
        if name.is_none() {
            return;
        }
        let file = self.b.file_symbol;
        let exports = self.b.symbols[file.idx()].exports;
        let flags = SymFlags::FUNCTION_SCOPED_VARIABLE | SymFlags::EXPORT_ONLY;
        self.declare_in(exports, name, flags, Decl::ExportsProperty(call), file);
    }

    /// `getDeclarationName`: the text of the string or numeric literal `key`. `NONE` for a number without an interner to spell it.
    fn literal_name(&self, key: ExprId) -> Atom {
        match (self.f[key].kind, self.atoms) {
            (ExprKind::Number(number), Some(atoms)) => atoms.intern_str(
                &crate::atom::number_to_string(self.f.numbers[number as usize]),
            ),
            _ => string_literal_text(self.f, key),
        }
    }

    /// What comes before the last link of the optional chain `e`, and whether that link is a `?.`.
    fn chain_of(&self, e: ExprId) -> Option<(ExprId, bool)> {
        let (inner, chain) = match self.f[e].kind {
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => (obj, chain),
            ExprKind::Call(c) => (self.f[c].callee, self.f[c].chain),
            _ => return None,
        };
        (chain != Chain::No).then_some((inner, chain == Chain::Start))
    }

    /// `bindOptionalChainFlow`
    fn optional_chain_flow(&mut self, id: ExprId, parent: Parent, targets: (FlowId, FlowId)) {
        if targets.0.is_some() {
            return self.optional_chain(id, parent, targets.0, targets.1);
        }
        let post = self.branch_label();
        let saved_flow = self.flow;
        self.optional_chain(id, parent, post, post);
        // Whether it stopped early or not makes no difference afterwards, unless something was assigned to: on the way, or before,
        // as far back as where the conditional or logical expression around starts. It is not reset here.
        self.flow = if self.has_flow_effects {
            self.finish_label(post)
        } else {
            saved_flow
        };
    }

    /// `bindOptionalChain`: `a?.b.c` is bound like `a && a.b.c`, `a?.b?.c` like `a && a.b && a.b.c`.
    fn optional_chain(&mut self, id: ExprId, parent: Parent, on_true: FlowId, on_false: FlowId) {
        let me = Parent::Expr(id);
        let Some((inner, is_root)) = self.chain_of(id) else {
            return;
        };
        let pre_chain = if is_root {
            self.branch_label()
        } else {
            FlowId::NONE
        };
        // `bindOptionalExpression`
        let inner_true = if is_root { pre_chain } else { on_true };
        let saved = (self.true_target, self.false_target);
        (self.true_target, self.false_target) = (inner_true, on_false);
        self.expr(inner, me);
        (self.true_target, self.false_target) = saved;
        if self.chain_of(inner).is_none() || is_root {
            let t = self.flow_condition(true, self.flow, inner);
            self.add_edge(inner_true, t);
            let f = self.flow_condition(false, self.flow, inner);
            self.add_edge(on_false, f);
        }
        if is_root {
            self.flow = self.finish_label(pre_chain);
        }
        // `bindOptionalChainRest`: got to only if the chain has not stopped.
        (self.true_target, self.false_target) = (FlowId::NONE, FlowId::NONE);
        match self.f[id].kind {
            ExprKind::Index { index, .. } => self.expr(index, me),
            ExprKind::Call(c) => {
                let call = self.f[c];
                self.tys(call.type_args);
                self.exprs(call.args, me);
            }
            _ => {}
        }
        (self.true_target, self.false_target) = saved;
        // `IsOutermostOptionalChain`
        let is_outermost = match parent {
            Parent::Expr(p) => self
                .chain_of(p)
                .is_none_or(|(before, parent_is_root)| parent_is_root || before != id),
            _ => true,
        };
        if is_outermost {
            let t = self.flow_condition(true, self.flow, id);
            self.add_edge(on_true, t);
            let f = self.flow_condition(false, self.flow, id);
            self.add_edge(on_false, f);
        }
    }

    fn logical(
        &mut self,
        id: ExprId,
        left: ExprId,
        right: ExprId,
        targets: (FlowId, FlowId),
        is_assignment: bool,
    ) {
        let me = Parent::Expr(id);
        let is_and = matches!(
            self.f[id].kind,
            ExprKind::Binary { op: BinOp::And, .. }
                | ExprKind::Assign {
                    op: Some(BinOp::And),
                    ..
                }
        );
        let top_level = targets.0.is_none();
        let post = if top_level {
            self.branch_label()
        } else {
            FlowId::NONE
        };
        let (on_true, on_false) = if top_level { (post, post) } else { targets };
        let saved_flow = self.flow;
        let saved_effects = self.has_flow_effects;
        if top_level {
            self.has_flow_effects = false;
        }
        let pre_right = self.branch_label();
        if is_and {
            self.condition(left, me, pre_right, on_false);
        } else {
            self.condition(left, me, on_true, pre_right);
        }
        self.flow = self.finish_label(pre_right);
        if is_assignment {
            self.true_target = FlowId::NONE;
            self.false_target = FlowId::NONE;
            self.expr(right, me);
            self.assignment_target(left);
            let t = self.flow_condition(true, self.flow, id);
            self.add_edge(on_true, t);
            let f = self.flow_condition(false, self.flow, id);
            self.add_edge(on_false, f);
        } else {
            self.condition(right, me, on_true, on_false);
        }
        // `bindBinaryExpressionFlow`: how it came out makes no difference afterwards, unless something was assigned to on the way.
        if top_level {
            self.flow = if self.has_flow_effects {
                self.finish_label(post)
            } else {
                saved_flow
            };
            self.has_flow_effects |= saved_effects;
        }
    }

    fn props(&mut self, props: Span<PropId>, owner: ExprId) {
        let in_pattern = self.in_assignment_pattern;
        let is_literal = matches!(self.f[owner].kind, ExprKind::Object(_));
        for p in props.iter() {
            self.b.prop_owner[p.idx()] = owner;
            let prop = &self.f[p];
            if let PropKey::Computed(key) = prop.key {
                self.in_assignment_pattern = false;
                let names_a_function = !matches!(
                    prop.kind,
                    PropKind::Init | PropKind::Spread | PropKind::Shorthand
                );
                if names_a_function && prop.value.is_some() {
                    self.function_key(key, true);
                } else {
                    self.expr(
                        key,
                        if names_a_function {
                            Parent::MemberKey
                        } else {
                            Parent::Key(owner)
                        },
                    );
                }
            }
            if prop.value.is_some() {
                // `name: value` in an object literal: `bindChildren` hands the flag on through it alone, and
                // `requiresScopeChangeWorker` looks at its name alone.
                let is_assignment = is_literal && prop.kind == PropKind::Init;
                self.in_assignment_pattern = in_pattern && is_assignment;
                let scope_change_of = self.scope_change_of;
                if is_assignment {
                    self.scope_change_of = FnId::NONE;
                }
                self.expr(prop.value, Parent::Prop(p));
                self.scope_change_of = scope_change_of;
            }
        }
        self.in_assignment_pattern = in_pattern;
    }
}
