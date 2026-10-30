use bun_sema::bind::{BindingKind, ClassOwner, FnOwner, InitialState, Parent, PatParent, SymbolId};
use bun_sema::hir::is_moved_to_file_start;

use super::*;

// Reading a `let`, `const` or class binding in its temporal dead zone throws, so the read is only removable once the binding is known to be initialized.
impl Removable<'_, '_> {
    fn pattern_owner(&self, mut pattern: PatId) -> Parent {
        loop {
            match self.bound.pat_parent[pattern.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pattern = outer,
                PatParent::Var(declarator) => return Parent::VarInit(declarator),
                PatParent::Param(parameter) => return Parent::ParamDefault(parameter),
                PatParent::None => return Parent::None,
            }
        }
    }

    // `Parent::None` at a function boundary. Static fields and static blocks run inline with their class.
    fn inline_parent(&self, node: Parent) -> Parent {
        let (hir, bound) = (self.hir, self.bound);
        let class_parent = |class: ClassId| bound.class_owner[class.idx()].to_parent();
        let member_parent = |member: MemberId| {
            bound
                .member_class(member)
                .map_or(Parent::None, class_parent)
        };
        match node {
            Parent::Expr(expression) => bound.parent_of_expr(expression),
            Parent::Stmt(statement) => bound.parent_of_stmt(statement),
            Parent::VarInit(declarator) => Parent::Stmt(bound.var_stmt[declarator.idx()]),
            Parent::Prop(property) | Parent::PropKey(property) | Parent::MethodKey(property) => {
                Parent::Expr(bound.prop_owner[property.idx()])
            }
            Parent::PatPropDefault(property) | Parent::PatKey(property) => {
                self.pattern_owner(hir[property].value)
            }
            Parent::PatElemDefault(element) => self.pattern_owner(hir[element].pat),
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            Parent::EnumInit(member) => match bound.enum_member_owner[member.idx()].some() {
                Some(declaration) => Parent::Stmt(hir[declaration].stmt),
                None => Parent::None,
            },
            Parent::Module(namespace) => Parent::Stmt(hir[namespace].stmt),
            Parent::ClassExtends(class) | Parent::ClassDecorator(class) => class_parent(class),
            Parent::MemberKey(member) | Parent::MemberDecorator(member) => member_parent(member),
            Parent::MemberInit(member) if hir[member].flags.contains(Flags::STATIC) => {
                member_parent(member)
            }
            Parent::FnBody(function) => match bound.fns[function.idx()].owner {
                FnOwner::Member(member) if hir[member].kind == MemberKind::StaticBlock => {
                    member_parent(member)
                }
                _ => Parent::None,
            },
            Parent::MemberInit(_)
            | Parent::ParamDefault(_)
            | Parent::ParamDecorator(_)
            | Parent::File
            | Parent::None => Parent::None,
        }
    }

    fn runs_inline_in(&self, read: ExprId, container: Parent) -> bool {
        let mut node = self.bound.parent_of_expr(read);
        while node != Parent::None && node != container {
            node = self.inline_parent(node);
        }
        node != Parent::None
    }

    // A class's inner name is initialized after its `extends` clause and computed keys, before its static fields and blocks.
    fn runs_in_static_initializer(&self, read: ExprId, class: ClassId) -> bool {
        let bound = self.bound;
        let mut node = bound.parent_of_expr(read);
        while node != Parent::None {
            let parent = self.inline_parent(node);
            let node_class = match node {
                Parent::ClassExtends(class) | Parent::ClassDecorator(class) => Some(class),
                Parent::MemberKey(member)
                | Parent::MemberDecorator(member)
                | Parent::MemberInit(member) => bound.member_class(member),
                Parent::FnBody(function) => bound.function_class(function),
                _ => None,
            };
            if node_class == Some(class) {
                return parent != Parent::None
                    && matches!(node, Parent::MemberInit(_) | Parent::FnBody(_));
            }
            node = parent;
        }
        false
    }

    pub(super) fn declaration_statement(&self, declaration: Decl) -> Option<(StmtId, u32)> {
        let (hir, bound) = (self.hir, self.bound);
        let statement = match declaration {
            Decl::Var(name) | Decl::Require(name) => {
                let Parent::VarInit(declarator) = self.pattern_owner(name) else {
                    return None;
                };
                return Some((bound.var_stmt[declarator.idx()], hir[declarator].loc.end));
            }
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                ClassOwner::Stmt(statement) => statement,
                ClassOwner::Expr(_) => return None,
            },
            Decl::Enum(declaration) => hir[declaration].stmt,
            Decl::Module(namespace) => hir[namespace].stmt,
            Decl::ImportEquals(alias) => hir[alias].stmt,
            Decl::ExportExpr(statement) => statement,
            _ => return None,
        };
        Some((statement, hir[statement.some()?].loc.end))
    }

    pub(super) fn is_initialized_at(&self, read: ExprId, symbol: SymbolId) -> bool {
        match self.bound.initial_state(symbol) {
            InitialState::Undefined | InitialState::Initialized => true,
            InitialState::Uninitialized => self.has_initializer_run_at(read, symbol),
        }
    }

    pub(super) fn has_initializer_run_at(&self, read: ExprId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        if bound.binding_stability(symbol) == BindingStability::ContainerMember {
            return true;
        }
        let kind = bound.binding_kind(symbol);
        if kind == BindingKind::Import {
            return self.is_import_initialized(symbol);
        }
        let Some(declaration) = bound.initializing_declaration(symbol) else {
            return false;
        };
        if let (BindingKind::ClassInnerName, Decl::Class(class)) = (kind, declaration) {
            return self.runs_in_static_initializer(read, class);
        }
        let Some((statement, end)) = self.declaration_statement(declaration) else {
            return false;
        };
        let container = bound.parent_of_stmt(statement);
        // `for (const a of [a])` evaluates `[a]` first.
        let is_loop_variable = match container {
            Parent::Stmt(owner) => match hir[owner].kind {
                StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left == statement,
                _ => false,
            },
            _ => false,
        };
        let is_declared_earlier = end <= hir[read].pos
            || (self.hoists_classes
                && container == Parent::File
                && is_moved_to_file_start(hir, statement));
        is_declared_earlier && !is_loop_variable && self.runs_inline_in(read, container)
    }

    fn is_export_initialized(&self, export: Sym) -> bool {
        let may_run_first = |(modules, file): (&ModuleGraph, FileId)| {
            modules.may_run_before(ModuleRef::File(file), ModuleRef::File(export.file))
        };
        match self.files.bound(export.file).initial_state(export.id) {
            InitialState::Undefined | InitialState::Initialized => true,
            InitialState::Uninitialized => !self.modules.is_some_and(may_run_first),
        }
    }

    fn is_import_initialized(&self, symbol: SymbolId) -> bool {
        let binding = self
            .modules
            .map(|(modules, file)| modules.import_binding(file, symbol));
        match binding {
            Some(ImportBinding::Variable(export)) => self.is_export_initialized(export),
            _ => true,
        }
    }

    pub(super) fn is_member_initialized(&self, member: ExprId) -> bool {
        let Some((modules, file)) = self.modules else {
            return true;
        };
        match modules.member(file, member) {
            Some(Member::Binding(export)) => self.is_export_initialized(export),
            _ => match modules.member_binding(file, member) {
                Some(ImportBinding::Variable(export)) => self.is_export_initialized(export),
                _ => true,
            },
        }
    }

    pub(super) fn reads_only_initialized_names(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        if matches!(hir[expression].kind, ExprKind::Ident(_)) {
            return self.is_name_initialized(expression);
        }
        let mut stack = vec![TreeNode::Expr(expression)];
        while let Some(node) = stack.pop() {
            let TreeNode::Expr(expression) = node else {
                continue;
            };
            if self.analysis.decisions.is_dead_expr(expression) {
                continue;
            }
            let is_initialized = match hir[expression].kind {
                ExprKind::Ident(_) => {
                    !self.bound.is_evaluated_ident(expression)
                        || self.is_name_initialized(expression)
                }
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    self.is_member_initialized(expression)
                }
                _ => true,
            };
            if !is_initialized {
                return false;
            }
            push_children(hir, node, &mut stack);
        }
        true
    }

    pub(super) fn is_name_initialized(&self, name: ExprId) -> bool {
        match self.bound.binding(name) {
            Binding::Symbol(symbol) => self.is_initialized_at(name, symbol),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => true,
        }
    }
}
