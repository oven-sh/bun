//! What is used before it is there: 2448 2449 2450 2729.

use super::*;
use crate::bind::{ClassOwner, Decl, Parent, PatParent, SymbolId};
use std::ops::ControlFlow::{Break, Continue};

impl Checker<'_> {
    pub(super) fn check_use_before_declaration(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        let index = self.exprs_by_kind(file);
        // By symbol: where the statement that declares it ends, plus one. Every arm of the rule says yes to a use after that, so most
        // uses cost one comparison. 0: not worked out yet.
        let mut declared_by = vec![0u32; bound.symbols.len()];
        for &e in index.of(ExprTag::Ident) {
            let local = bound.expr_symbol[e.idx()];
            if local.is_none() {
                continue;
            }
            if declared_by[local.idx()] == 0 {
                declared_by[local.idx()] = self.end_of_declaring_statement(file, local);
            }
            if declared_by[local.idx()] == 0 {
                let statement = hir
                    .find_ancestor(self.block_scoped_declaration(file, local), |n| {
                        matches!(hir.data(n), NodeData::Stmt(_))
                    });
                declared_by[local.idx()] = match hir.data(statement) {
                    NodeData::Stmt(s) => hir[s].loc.end + 1,
                    // There is nothing to be used before.
                    NodeData::None => 1,
                    _ => u32::MAX,
                };
            }
            if hir[e].pos + 1 < declared_by[local.idx()] && !bound.is_unchecked(e.idx()) {
                self.check_resolved_block_scoped_variable(file, e);
            }
        }
        // Without a class only what is in the initializer of a member or in a static block is looked at.
        if hir.classes.is_empty() && !hir.members.iter().any(|m| m.init.is_some()) {
            return;
        }
        // `isInPropertyInitializerOrClassStaticBlock` can only say yes in one of these.
        let is_place =
            |m: &&Member| matches!(m.kind, MemberKind::Property | MemberKind::StaticBlock);
        let places = Places::new(hir.members.iter().filter(is_place).map(|m| m.loc));
        for &e in index.of(ExprTag::Dot) {
            if !bound.is_unchecked(e.idx()) {
                let may_be_in_place = places.contain(hir[e].pos);
                self.check_property_not_used_before_declaration(file, e, may_be_in_place);
            }
        }
    }

    /// Where the statement ends that declares `local`, plus one, by the binder's tables: of what has one declaration, which is a
    /// variable, a class statement or an enum. 0: they do not tell.
    fn end_of_declaring_statement(&self, file: FileId, local: SymbolId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = &bound.symbols[local.idx()];
        let is_block_scoped = SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM;
        if !symbol.flags.intersects(is_block_scoped) {
            return 1;
        }
        let &[declaration] = &symbol.decls[..] else {
            return 0;
        };
        // What `block_scoped_declaration` has more to say about.
        let is_more = SymFlags::MERGED
            | SymFlags::FUNCTION
            | SymFlags::FUNCTION_SCOPED_VARIABLE
            | SymFlags::ASSIGNMENT;
        if symbol.flags.intersects(is_more) {
            return 0;
        }
        let mut statement = match declaration {
            Decl::Var(mut name) => loop {
                match bound.pat_parent[name.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => name = outer,
                    PatParent::Var(d) => break bound.var_stmt[d.idx()],
                    PatParent::Param(_) | PatParent::None => return 0,
                }
            },
            Decl::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Stmt(s) => s,
                ClassOwner::Expr(_) => return 0,
            },
            Decl::Enum(e) => hir[e].stmt,
            _ => return 0,
        };
        if statement.is_none() {
            return 0;
        }
        // The head of a `for` is in that statement.
        if let Parent::Stmt(around) = bound.stmt_parent[statement.idx()]
            && matches!(
                hir[around].kind,
                StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
            )
        {
            statement = around;
        }
        hir[statement].loc.end + 1
    }

    /// The declaration `checkResolvedBlockScopedVariable` looks at. `NONE`: it looks at none.
    fn block_scoped_declaration(&self, file: FileId, local: SymbolId) -> Node {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = &bound.symbols[local.idx()];
        let flags = symbol.flags;
        let is_function =
            SymFlags::FUNCTION | SymFlags::FUNCTION_SCOPED_VARIABLE | SymFlags::ASSIGNMENT;
        if !flags.intersects(SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM)
            || flags.contains(SymFlags::CLASS) && flags.intersects(is_function)
        {
            return Node::NONE;
        }
        // `mergeSymbol`: what does not go with what an earlier file declared is left out, and the name goes on meaning that. And
        // what another file declares counts as declared.
        if flags.contains(SymFlags::MERGED) {
            let sym = self.files().sym(file, local);
            let first = self
                .files()
                .decls(sym)
                .into_iter()
                .find(|&(of, d)| match d {
                    Decl::Var(_) | Decl::Fn(_) | Decl::Class(_) | Decl::Enum(_) => true,
                    // A namespace with something in it goes with a class or an enum, not with a variable.
                    Decl::Module(m) => {
                        flags.contains(SymFlags::BLOCK_SCOPED_VARIABLE)
                            && self.bound(of).module_instance_state[m.idx()]
                                != ModuleInstanceState::NonInstantiated
                    }
                    _ => false,
                });
            if first.is_none_or(|(of, _)| of != file) {
                return Node::NONE;
            }
        }
        let declaration = symbol.decls.iter().map(|&d| hir.node(d)).find(|&d| {
            hir.is_block_or_catch_scoped(d)
                || hir.kind(d).is_class_like()
                || hir.kind(d) == Kind::EnumDeclaration
        });
        declaration.unwrap_or(Node::NONE)
    }

    /// `checkResolvedBlockScopedVariable`, of a name that is not written after the statement that declares it.
    fn check_resolved_block_scoped_variable(&mut self, file: FileId, e: ExprId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.expr_symbol[e.idx()];
        let (flags, declaration) = (
            bound.symbols[local.idx()].flags,
            self.block_scoped_declaration(file, local),
        );
        if hir.is_ambient(declaration)
            || self.is_block_scoped_name_declared_before_use(file, declaration, hir.node(e))
        {
            return;
        }
        let code = if flags.contains(SymFlags::BLOCK_SCOPED_VARIABLE) {
            2448
        } else if flags.contains(SymFlags::CLASS) {
            2449
        } else if flags.contains(SymFlags::REGULAR_ENUM) || self.p.files.options.isolated_modules {
            2450
        } else {
            return;
        };
        let name = hir.start(hir.name(declaration));
        self.report_use_before_declaration(file, hir[e].pos, code, name, declaration);
    }

    /// The error `code` at `start`, which names what is written at `name`, and `'{0}' is declared here.` at `declaration`.
    fn report_use_before_declaration(
        &mut self,
        file: FileId,
        start: u32,
        code: u32,
        name: u32,
        declaration: Node,
    ) {
        self.error_at(
            (file, start, 0),
            code,
            &[Arg::Text(&self.declaration_name_at(file, name))],
        );
        self.relate(start, code, |c| {
            let (from, to) = c.get_error_range_for_node(file, declaration);
            vec![c.declared_here((file, from, to), c.declaration_name_at(file, name))]
        });
    }

    /// `isBlockScopedNameDeclaredBeforeUse`, of a declaration and a use in `file`.
    pub(super) fn is_block_scoped_name_declared_before_use(
        &mut self,
        file: FileId,
        declaration: Node,
        usage: Node,
    ) -> bool {
        let hir = self.hir(file);
        let emits_standard_class_fields = self.p.files.options.emit_standard_class_fields;
        let has_legacy_decorators = self.p.files.options.experimental_decorators;
        let container = hir.get_enclosing_block_scope_container(declaration);
        if hir.is_in_jsdoc(hir.start(usage))
            || hir.is_in_type_query(usage)
            || hir.is_in_ambient_or_type_node(usage)
        {
            return true;
        }
        let kind = hir.kind(declaration);
        let is_property = kind == Kind::PropertyDeclaration;
        let is_same_class =
            || hir.get_containing_class(declaration) == hir.get_containing_class(usage);
        if hir.start(declaration) <= hir.start(usage)
            && !(is_property
                && hir.is_this_property(hir.parent(usage))
                && hir.initializer(declaration).is_none()
                && !hir.flags(declaration).contains(Flags::DEFINITE))
        {
            return match kind {
                Kind::BindingElement => {
                    let error_binding_element = hir.find_ancestor_kind(usage, Kind::BindingElement);
                    if error_binding_element.is_some() {
                        return error_binding_element != declaration
                            || hir.start(declaration) < hir.start(error_binding_element);
                    }
                    let variable = hir.find_ancestor_kind(declaration, Kind::VariableDeclaration);
                    self.is_block_scoped_name_declared_before_use(file, variable, usage)
                }
                Kind::VariableDeclaration => {
                    !is_immediately_used_in_initializer_of_block_scoped_variable(
                        hir,
                        declaration,
                        usage,
                        container,
                    )
                }
                _ if kind.is_class_like() => {
                    let is_in_declaration = |n: Node, levels: u32| {
                        (0..levels).fold(n, |n, _| hir.parent(n)) == declaration
                    };
                    let found = hir.find_ancestor(usage, |n| {
                        let parent = hir.kind(hir.parent(n));
                        n == declaration
                            || hir.kind(n) == Kind::ComputedPropertyName && is_in_declaration(n, 2)
                            || !has_legacy_decorators
                                && hir.kind(n) == Kind::Decorator
                                && (is_in_declaration(n, 1)
                                    || matches!(
                                        parent,
                                        Kind::MethodDeclaration
                                            | Kind::GetAccessor
                                            | Kind::SetAccessor
                                            | Kind::PropertyDeclaration
                                    ) && is_in_declaration(n, 2)
                                    || parent == Kind::Parameter && is_in_declaration(n, 3))
                    });
                    if found.is_none() || found == declaration {
                        return true;
                    }
                    if hir.kind(found) != Kind::Decorator {
                        return false;
                    }
                    let deferred = hir.find_ancestor(usage, |n| {
                        n == found
                            || hir.kind(n).is_function_like()
                                && hir.get_immediately_invoked_function_expression(n).is_none()
                    });
                    deferred.is_some() && deferred != found
                }
                Kind::PropertyDeclaration => !self
                    .is_property_immediately_referenced_within_declaration(
                        file,
                        declaration,
                        usage,
                        false,
                    ),
                _ if hir.is_parameter_property_declaration(declaration) => {
                    !(emits_standard_class_fields
                        && is_same_class()
                        && self.is_used_in_function_or_instance_property(
                            file,
                            usage,
                            declaration,
                            container,
                        ))
                }
                _ => true,
            };
        }
        let is_export_equals = |n: Node| matches!(hir.data(n), NodeData::Stmt(s) if matches!(hir[s].kind, StmtKind::ExportAssign(_)));
        if hir.kind(hir.parent(usage)) == Kind::ExportSpecifier
            || is_export_equals(hir.parent(usage))
            || is_export_equals(usage)
        {
            return true;
        }
        if !self.is_used_in_function_or_instance_property(file, usage, declaration, container) {
            return false;
        }
        !(emits_standard_class_fields
            && hir.get_containing_class(declaration).is_some()
            && (is_property || hir.is_parameter_property_declaration(declaration))
            && self.is_property_immediately_referenced_within_declaration(
                file,
                declaration,
                usage,
                true,
            ))
    }

    /// `isUsedInFunctionOrInstanceProperty`
    fn is_used_in_function_or_instance_property(
        &mut self,
        file: FileId,
        usage: Node,
        declaration: Node,
        container: Node,
    ) -> bool {
        let hir = self.hir(file);
        let is_property = hir.kind(declaration) == Kind::PropertyDeclaration;
        let is_same_class =
            || hir.get_containing_class(usage) == hir.get_containing_class(declaration);
        let found = hir.find_ancestor_or_quit(usage, |current| {
            if current == container {
                return Break(false);
            }
            let is_found = |is_found: bool| if is_found { Break(true) } else { Continue(()) };
            if hir.kind(current).is_function_like() {
                return is_found(
                    hir.get_immediately_invoked_function_expression(current)
                        .is_none(),
                );
            }
            if hir.kind(current) == Kind::ClassStaticBlockDeclaration {
                return is_found(hir.start(declaration) < hir.start(usage));
            }
            let parent = hir.parent(current);
            if hir.kind(parent) == Kind::PropertyDeclaration && hir.initializer(parent) == current {
                if !hir.is_static(parent) {
                    if !(is_property && !hir.is_static(declaration)) || !is_same_class() {
                        return Break(true);
                    }
                } else if hir.kind(declaration) == Kind::MethodDeclaration
                    || is_property
                        && is_same_class()
                        && matches!(
                            hir.kind(hir.name(declaration)),
                            Kind::Identifier | Kind::PrivateIdentifier
                        )
                        && self.is_property_initialized_in_static_blocks(
                            file,
                            declaration,
                            hir.start(current),
                        )
                {
                    return Break(true);
                }
            }
            if hir.kind(parent) == Kind::Decorator && hir.expression(parent) == current {
                let decorated = hir.parent(parent);
                let class = match hir.kind(decorated) {
                    Kind::Parameter => hir.parent(hir.parent(decorated)),
                    Kind::MethodDeclaration => hir.parent(decorated),
                    _ => return Continue(()),
                };
                return Break(self.is_used_in_function_or_instance_property(
                    file,
                    class,
                    declaration,
                    container,
                ));
            }
            Continue(())
        });
        found.is_some()
    }

    /// `isPropertyInitializedInStaticBlocks`, of the property `declaration` and the static blocks of its class that start by `end`.
    fn is_property_initialized_in_static_blocks(
        &mut self,
        file: FileId,
        declaration: Node,
        end: u32,
    ) -> bool {
        let hir = self.hir(file);
        let NodeData::Member(member) = hir.data(declaration) else {
            return false;
        };
        let name = hir.text(hir.name(declaration));
        let class = hir.class_of(hir.parent(declaration));
        let blocks = hir[class]
            .members
            .iter()
            .filter(|&block| hir[block].kind == MemberKind::StaticBlock && hir[block].start <= end);
        let mut ty = None;
        for block in blocks {
            let ty = *ty.get_or_insert_with(|| self.type_of_member_declaration(file, member));
            if self.is_assigned_in_constructor(file, hir[block].func, name, ty) {
                return true;
            }
        }
        false
    }

    /// `isPropertyImmediatelyReferencedWithinDeclaration`
    fn is_property_immediately_referenced_within_declaration(
        &self,
        file: FileId,
        declaration: Node,
        usage: Node,
        stop_at_any_property_declaration: bool,
    ) -> bool {
        let hir = self.hir(file);
        if self.end_of_node(file, usage) > self.end_of_node(file, declaration) {
            return false;
        }
        let mut node = usage;
        while node.is_some() && node != declaration {
            match hir.kind(node) {
                Kind::ArrowFunction => return false,
                Kind::PropertyDeclaration => {
                    let class = hir.parent(declaration);
                    return stop_at_any_property_declaration
                        && (hir.kind(declaration) == Kind::PropertyDeclaration
                            && hir.parent(node) == class
                            || hir.is_parameter_property_declaration(declaration)
                                && hir.parent(node) == hir.parent(class));
                }
                Kind::Block
                    if matches!(
                        hir.kind(hir.parent(node)),
                        Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor
                    ) =>
                {
                    return false;
                }
                _ => {}
            }
            node = hir.parent(node);
        }
        true
    }

    /// `prop.ValueDeclaration`
    fn value_declaration_of(&self, prop: &Prop) -> Option<(FileId, Node)> {
        Some(match *Self::value_declaration(prop)? {
            PropSource::Members(ref members) => {
                let &(file, member) = members.first()?;
                (file, self.hir(file).node(member))
            }
            PropSource::Parameter(file, p) => (file, self.hir(file).node(p)),
            PropSource::Literal(file, p) => (file, self.hir(file).node(p)),
            PropSource::Assigned(file, ref assignments) => {
                (file, self.hir(file).node(*assignments.first()?))
            }
            // `SetValueDeclaration`: the first that declares a value, a namespace only if nothing else does. An alias declares none.
            PropSource::Symbol(s) => {
                let decls = self.files().decls_of(self.files().canonical(s));
                let is_value = |d: &&(FileId, Decl)| {
                    matches!(
                        d.1,
                        Decl::Var(_)
                            | Decl::Fn(_)
                            | Decl::Class(_)
                            | Decl::Enum(_)
                            | Decl::EnumMember(_)
                    )
                };
                let &(file, decl) = decls
                    .iter()
                    .find(is_value)
                    .or_else(|| decls.iter().find(|d| matches!(d.1, Decl::Module(_))))?;
                (file, self.hir(file).node(decl))
            }
            _ => return None,
        })
    }

    /// `checkPropertyNotUsedBeforeDeclaration`, of the property access `e`.
    fn check_property_not_used_before_declaration(
        &mut self,
        file: FileId,
        e: ExprId,
        may_be_in_place: bool,
    ) {
        let hir = self.hir(file);
        let ExprKind::Dot {
            obj,
            name,
            name_pos,
            ..
        } = hir[e].kind
        else {
            return;
        };
        let (node, right) = (hir.node(e), hir.name(hir.node(e)));
        let is_in_place = may_be_in_place
            && hir.is_in_property_initializer_or_class_static_block(node, false)
            && !hir.kind(hir.expression(node)).is_access_expression();
        // Elsewhere only a class declaration counts, one that a namespace exports.
        if !is_in_place && hir.classes.is_empty() {
            return;
        }
        let object = self.type_of_expr(file, obj);
        if !is_in_place
            && !matches!(
                self.data(object),
                TypeData::Anon {
                    origin: Origin::Module(_)
                        | Origin::Namespace { .. }
                        | Origin::ClassStatic(_)
                        | Origin::Function(_)
                        | Origin::EnumObject(_),
                    ..
                }
            )
        {
            return;
        }
        if !self.is_known(object) {
            return;
        }
        let object = self.apparent_type(object);
        let Some((prop, _)) = self.prop_ref(object, name) else {
            return;
        };
        let Some((declared_in, declaration)) = self.value_declaration_of(prop) else {
            return;
        };
        // What another file declares counts as declared.
        if declared_in != file
            || self.is_block_scoped_name_declared_before_use(file, declaration, right)
        {
            return;
        }
        let (kind, flags) = (hir.kind(declaration), hir.flags(declaration));
        // `isOptionalPropertyDeclaration`
        let is_optional = kind == Kind::PropertyDeclaration
            && flags.contains(Flags::OPTIONAL)
            && !flags.contains(Flags::ACCESSOR);
        let code = if is_in_place
            && !is_optional
            && !(kind == Kind::MethodDeclaration && flags.contains(Flags::STATIC))
            && (self.p.files.options.use_define_for_class_fields
                || !self.is_property_declared_in_ancestor_class(file, declaration, name))
        {
            2729
        } else if kind == Kind::ClassDeclaration && !hir.is_ambient(declaration) {
            2449
        } else {
            return;
        };
        self.report_use_before_declaration(file, name_pos, code, name_pos, declaration);
    }

    /// `isPropertyDeclaredInAncestorClass`, of the property `name` that `declaration` declares.
    fn is_property_declared_in_ancestor_class(
        &mut self,
        file: FileId,
        declaration: Node,
        name: Atom,
    ) -> bool {
        let hir = self.hir(file);
        let class = hir.class_of(hir.get_containing_class(declaration));
        if class.is_none() {
            return false;
        }
        let sym = self
            .files()
            .sym(file, self.bound(file).class_symbol[class.idx()]);
        let Some(&base) = self.base_types(sym).first() else {
            return false;
        };
        let base = self.apparent_type(base);
        matches!(self.prop_of(base, name), Some((property, _)) if Self::value_declaration(&property).is_some())
    }

    /// `GetImmediatelyInvokedFunctionExpression(f) != nil`
    pub(super) fn is_immediately_invoked(&self, file: FileId, f: FnId) -> bool {
        self.bound(file)
            .get_immediately_invoked_function_expression(self.hir(file), f)
            .is_some()
    }

    /// What is around what `parent` stands for, patterns and `extends` included. `None`: it is not kept track of.
    #[inline]
    pub(super) fn outward(&self, file: FileId, parent: Parent) -> Parent {
        match parent {
            Parent::PatPropDefault(_)
            | Parent::PatElemDefault(_)
            | Parent::ClassExtends(_)
            | Parent::Decorator(..) => self.outward_from_pattern_or_class(file, parent),
            _ => self.parent_of(file, parent),
        }
    }

    fn outward_from_pattern_or_class(&self, file: FileId, parent: Parent) -> Parent {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of_pattern = |mut pat: PatId| loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return Parent::VarInit(d),
                PatParent::Param(p) => return Parent::ParamDefault(p),
                PatParent::None => return Parent::None,
            }
        };
        match parent {
            Parent::PatPropDefault(p) => of_pattern(hir[p].value),
            Parent::PatElemDefault(p) => of_pattern(hir[p].pat),
            Parent::ClassExtends(c) | Parent::Decorator(c, _) => match bound.class_owner[c.idx()] {
                ClassOwner::Expr(x) => Parent::Expr(x),
                ClassOwner::Stmt(s) => Parent::Stmt(s),
            },
            _ => self.parent_of(file, parent),
        }
    }
}

/// `isImmediatelyUsedInInitializerOfBlockScopedVariable`
fn is_immediately_used_in_initializer_of_block_scoped_variable(
    hir: &File,
    declaration: Node,
    usage: Node,
    container: Node,
) -> bool {
    let grandparent = hir.parent(hir.parent(declaration));
    let kind = hir.kind(grandparent);
    matches!(
        kind,
        Kind::VariableStatement | Kind::ForStatement | Kind::ForOfStatement
    ) && is_same_scope_descendent_of(hir, usage, declaration, container)
        || matches!(kind, Kind::ForInStatement | Kind::ForOfStatement)
            && is_same_scope_descendent_of(hir, usage, hir.expression(grandparent), container)
}

/// `isSameScopeDescendentOf`
fn is_same_scope_descendent_of(hir: &File, initial: Node, parent: Node, stop_at: Node) -> bool {
    if parent.is_none() {
        return false;
    }
    let found = hir.find_ancestor_or_quit(initial, |n| {
        if n == parent {
            return Break(true);
        }
        let is_deferred = || {
            hir.get_immediately_invoked_function_expression(n).is_none()
                || hir.flags(n).intersects(Flags::ASYNC | Flags::GENERATOR)
        };
        if n == stop_at || hir.kind(n).is_function_like() && is_deferred() {
            return Break(false);
        }
        Continue(())
    });
    found.is_some()
}
