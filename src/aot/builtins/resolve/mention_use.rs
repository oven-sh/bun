use super::SourceDialect;
use super::mentions::mentioned_id;
use super::resolver::{ExprState, HolderKind, ResolvedValue, Resolver, is_of_loader};
use super::written_members::{follows_unlisted_names_of, holder_of, writes_on_first_operand};
use crate::builtins::table::{self, BuiltinId, BuiltinKind, Intrinsic, Scope};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingStability, Parent, SymbolId};
use bun_sema::hir::{
    self, BinOp, CallId, ExprId, ExprKind, MemberKey, NodeData, PatId, PatKind, StmtId, StmtKind,
    UnOp, VarDeclId,
};
use std::ops::ControlFlow;

pub(super) enum MentionUse {
    Holder,
    ReadByComputedKey,
    Called(ExprId),
    Inspected,
    Aliased,
    Destructured(PatId),
    Exposed,
}

fn looks_at_first_operand(builtin: BuiltinId) -> bool {
    matches!(
        builtin,
        BuiltinId::ObjectKeys
            | BuiltinId::ObjectGetOwnPropertyNames
            | BuiltinId::ObjectGetOwnPropertySymbols
            | BuiltinId::ReflectOwnKeys
    )
}

#[rustfmt::skip]
fn classify_stmt_parent(hir: &hir::File<'_>, node: ExprId, stmt: StmtId) -> MentionUse {
    match hir[stmt].kind {
        StmtKind::Expr(_) | StmtKind::Switch { .. } => MentionUse::Inspected,
        StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } if node == test => MentionUse::Inspected,
        StmtKind::For { test, update, .. } if node == test || node == update => MentionUse::Inspected,
        StmtKind::ForIn { .. } | StmtKind::With { .. } => MentionUse::Exposed,
        _ => MentionUse::Exposed,
    }
}

impl Resolver<'_, '_> {
    #[rustfmt::skip]
    pub(super) fn classify_use(&self, e: ExprId) -> MentionUse {
        let input = self.input;
        let mut node = e;
        loop {
            let flow = match input.bound.parent_of_expr(node) {
                Parent::Expr(parent) => self.classify_expr_parent(e, node, parent),
                Parent::Stmt(stmt) => {
                    ControlFlow::Break(classify_stmt_parent(input.hir, node, stmt))
                }
                Parent::VarInit(declarator) => {
                    ControlFlow::Break(self.classify_initializer(e, declarator))
                }
                Parent::None
                | Parent::File | Parent::ParamDefault(_) | Parent::PatPropDefault(_)
                | Parent::PatElemDefault(_) | Parent::Prop(_) | Parent::MemberInit(_)
                | Parent::FnBody(_) | Parent::EnumInit(_) | Parent::ClassExtends(_)
                | Parent::ClassDecorator(_) | Parent::MemberDecorator(_)
                | Parent::ParamDecorator(_)
                | Parent::Module(_) => ControlFlow::Break(MentionUse::Exposed),
                _ => ControlFlow::Break(MentionUse::Inspected),
            };
            match flow {
                ControlFlow::Break(mention_use) => return mention_use,
                ControlFlow::Continue(parent) => node = parent,
            }
        }
    }

    #[rustfmt::skip]
    fn classify_expr_parent(&self, e: ExprId, node: ExprId, parent: ExprId) -> ControlFlow<MentionUse, ExprId> {
        let hir = self.input.hir;
        let mention_use = match hir[parent].kind {
            ExprKind::Binary { op: BinOp::In, right, .. } if node == right => MentionUse::Exposed,
            ExprKind::Binary { op: BinOp::And, left, .. } if node == left => MentionUse::Inspected,
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => {
                return ControlFlow::Continue(parent);
            }
            ExprKind::Binary { op: BinOp::Comma, right, .. } if node == right => {
                return ControlFlow::Continue(parent);
            }
            ExprKind::Binary { .. } => MentionUse::Inspected,
            ExprKind::Cond { test, .. } if node != test && self.is_resolved(parent) => MentionUse::Aliased,
            ExprKind::Cond { test, .. } if node != test => return ControlFlow::Continue(parent),
            ExprKind::Cond { .. } => MentionUse::Inspected,
            ExprKind::Dot { .. } => self.classify_object(e, node, parent),
            ExprKind::Index { obj, .. } if node == obj => self.classify_object(e, node, parent),
            ExprKind::Index { .. } => MentionUse::Inspected,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if node == hir[call].callee => MentionUse::Called(parent),
            ExprKind::Assign { op: Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, .. } if node == target => return ControlFlow::Continue(parent),
            ExprKind::Assign { target, .. } if node == target => MentionUse::Inspected,
            ExprKind::Assign { op: None, target, value } if hir.skip_type_assertions(value) == e && self.is_kept_for_unlisted_members(e, target) => MentionUse::Inspected,
            ExprKind::Template { .. } if self.is_tagged_template(parent) => MentionUse::Exposed,
            ExprKind::Unary { .. } | ExprKind::Template { .. } => MentionUse::Inspected,
            ExprKind::Call(call) | ExprKind::New(call) => self.classify_operand(call, node),
            ExprKind::TaggedTemplate(_) | ExprKind::Spread(_) | ExprKind::Assign { .. } => MentionUse::Exposed,
            ExprKind::Missing | ExprKind::Ident(_) | ExprKind::PrivateIdentifier(_)
            | ExprKind::This | ExprKind::Super | ExprKind::Null | ExprKind::True | ExprKind::False
            | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_)
            | ExprKind::Regex { .. } | ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Fn(_)
            | ExprKind::Class(_) | ExprKind::Await(_)
            | ExprKind::Yield { .. } | ExprKind::Jsx(_) | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => MentionUse::Exposed,
            _ => return ControlFlow::Continue(parent),
        };
        ControlFlow::Break(mention_use)
    }

    fn is_kept_for_unlisted_members(&self, e: ExprId, target: ExprId) -> bool {
        let input = self.input;
        let Some(object) = self.value_of(e) else {
            return false;
        };
        let Binding::Symbol(variable) = input.bound.binding(target) else {
            return false;
        };
        let id = table::canonical_id(object.path.id);
        let entry = table::entry(id);
        let lists_members = object.kind == HolderKind::Object
            && entry.scope == Scope::Realm
            && matches!(entry.kind, BuiltinKind::Namespace | BuiltinKind::Prototype);
        if input.dialect != SourceDialect::Program
            || !lists_members
            || follows_unlisted_names_of(id)
            || !matches!(input.hir[target].kind, ExprKind::Ident(_))
            || !self.is_filled_by_stores_in_sight(variable)
        {
            return false;
        }
        let known = self.kept_variables.borrow().get(&(variable, id)).copied();
        known.unwrap_or_else(|| {
            let is_kept = self.stands_only_in_front_of_unlisted_names(variable, object);
            self.kept_variables
                .borrow_mut()
                .insert((variable, id), is_kept);
            is_kept
        })
    }

    fn stands_only_in_front_of_unlisted_names(
        &self,
        variable: SymbolId,
        object: ResolvedValue,
    ) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut stores = bound.stores_to(variable).iter();
        let mut names = (0..hir.exprs.len() as u32).map(ExprId).filter(|&name| {
            matches!(hir[name].kind, ExprKind::Ident(_))
                && bound.binding(name) == Binding::Symbol(variable)
        });
        stores.all(|it| self.stores_object(it.target, object))
            && names.all(|name| {
                bound.dynamic_lookup_scope(NodeData::Expr(name)).is_none()
                    && (bound.is_store_target(name)
                        || self.is_asked_for_unlisted_member(name, object))
            })
    }

    fn is_filled_by_stores_in_sight(&self, variable: SymbolId) -> bool {
        let bound = self.input.bound;
        bound.binding_stability(variable) == BindingStability::Stored
            && bound.initializing_declaration(variable).is_none()
            && !self.is_exported(variable)
    }

    fn stores_object(&self, target: ExprId, object: ResolvedValue) -> bool {
        let Parent::Expr(assignment) = self.input.bound.parent_of_expr(target) else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target: stored_to,
            value,
        } = self.input.hir[assignment].kind
        else {
            return false;
        };
        let is_same_object = |value: ResolvedValue| {
            value.kind == object.kind
                && table::canonical_id(value.path.id) == table::canonical_id(object.path.id)
        };
        stored_to == target
            && self.value_of(value).is_some_and(is_same_object)
            && self.is_asked_for_unlisted_member(assignment, object)
    }

    fn is_asked_for_unlisted_member(&self, holder: ExprId, object: ResolvedValue) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let holder = self.outermost_assertion_of(holder);
        let member = match bound.parent_of_expr(holder) {
            Parent::Expr(member) => member,
            Parent::Stmt(statement) => return matches!(hir[statement].kind, StmtKind::Expr(_)),
            _ => return false,
        };
        let Some((asked, MemberKey::Name(name))) = hir.member_key(member) else {
            return false;
        };
        asked == holder
            && !self.is_inherited_object_prototype_member(Some(object.path.id), name)
            && !self.is_deleted(member)
            && !self.is_callee(self.outermost_assertion_of(member))
            && self.find_named_member(object, name).is_none()
    }

    fn classify_operand(&self, call: CallId, operand: ExprId) -> MentionUse {
        let hir = self.input.hir;
        let callee = hir.skip_type_assertions(hir[call].callee);
        let is_first = hir.ids(hir[call].args).next() == Some(operand);
        if is_first && self.input.runs_tests && self.is_receiver_of_own_method(operand, callee) {
            return MentionUse::Inspected;
        }
        let Some(builtin) = mentioned_id(self.state(callee)) else {
            return MentionUse::Exposed;
        };
        match table::canonical_id(builtin) {
            builtin if is_first && looks_at_first_operand(builtin) => MentionUse::Inspected,
            builtin
                if is_first
                    && self.input.runs_tests
                    && writes_on_first_operand(builtin)
                    && !self.is_of_loader(operand) =>
            {
                MentionUse::Inspected
            }
            _ => MentionUse::Exposed,
        }
    }

    fn is_of_loader(&self, object: ExprId) -> bool {
        let object = self.input.hir.skip_type_assertions(object);
        mentioned_id(self.state(object)).is_none_or(is_of_loader)
    }

    fn is_receiver_of_own_method(&self, operand: ExprId, callee: ExprId) -> bool {
        let hir = self.input.hir;
        let takes_receiver = self.hands_function_on(callee);
        let Some((function, _)) = hir.member_key(callee).filter(|_| takes_receiver) else {
            return false;
        };
        let Some(function) = mentioned_id(self.state(hir.skip_type_assertions(function))) else {
            return false;
        };
        let holder = table::entry(table::canonical_id(function)).holder;
        let object = self
            .value_of(operand)
            .or_else(|| self.held_value_of(operand));
        object.is_some_and(|object| {
            holder.map(table::canonical_id) == Some(table::canonical_id(object.path.id))
        })
    }

    fn classify_object(&self, e: ExprId, node: ExprId, member: ExprId) -> MentionUse {
        let hir = self.input.hir;
        if hir.skip_type_assertions(node) != e {
            return MentionUse::Exposed;
        }
        if self.is_deleted(member) || self.hands_function_on(member) {
            return MentionUse::Exposed;
        }
        if !self.is_resolved(member) && self.is_callee(member) {
            return MentionUse::Exposed;
        }
        let object = mentioned_id(self.state(e));
        match hir.member_key(member) {
            Some((_, MemberKey::Name(name)))
                if self.is_inherited_object_prototype_member(object, name) =>
            {
                MentionUse::Exposed
            }
            Some((_, MemberKey::Name(_) | MemberKey::PrivateName(_))) => MentionUse::Holder,
            Some((_, MemberKey::Computed(_))) if self.is_resolved(member) => MentionUse::Holder,
            Some((_, MemberKey::Computed(_))) => MentionUse::ReadByComputedKey,
            None => MentionUse::Exposed,
        }
    }

    pub(super) fn is_inherited_object_prototype_member(
        &self,
        object: Option<BuiltinId>,
        name: Atom,
    ) -> bool {
        let Some(name) = self.input.names.get(name) else {
            return false;
        };
        let holds_member_itself =
            object.is_some_and(|object| table::own_member(holder_of(object), name).is_some());
        table::own_member(BuiltinId::ObjectPrototype, name).is_some() && !holds_member_itself
    }

    fn hands_function_on(&self, member: ExprId) -> bool {
        match self.state(member) {
            ExprState::Intrinsic(Intrinsic::Call { .. } | Intrinsic::Apply) => true,
            state => matches!(
                mentioned_id(state).map(table::canonical_id),
                Some(
                    BuiltinId::FunctionPrototypeApply
                        | BuiltinId::FunctionPrototypeBind
                        | BuiltinId::FunctionPrototypeCall
                )
            ),
        }
    }

    pub(super) fn is_deleted(&self, member: ExprId) -> bool {
        let hir = self.input.hir;
        let mut node = member;
        while let Parent::Expr(parent) = self.input.bound.parent_of_expr(node) {
            match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => node = parent,
                ExprKind::Unary { op, .. } => return op == UnOp::Delete,
                _ => return false,
            }
        }
        false
    }

    fn is_callee(&self, function: ExprId) -> bool {
        let hir = self.input.hir;
        let Parent::Expr(parent) = self.input.bound.parent_of_expr(function) else {
            return false;
        };
        let (ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) = hir[parent].kind else {
            return false;
        };
        hir[call].callee == function
    }

    fn is_tagged_template(&self, template: ExprId) -> bool {
        let hir = self.input.hir;
        let Parent::Expr(parent) = self.input.bound.parent_of_expr(template) else {
            return false;
        };
        let ExprKind::TaggedTemplate(call) = hir[parent].kind else {
            return false;
        };
        hir.template_of(call) == template
    }

    pub(super) fn ends_row_of_tests(&self, row: ExprId, e: ExprId) -> bool {
        let hir = self.input.hir;
        let mut last = hir.skip_type_assertions(row);
        while let ExprKind::Binary {
            op: BinOp::And,
            right,
            ..
        } = hir[last].kind
        {
            last = hir.skip_type_assertions(right);
        }
        last == e && last != hir.skip_type_assertions(row)
    }

    fn classify_initializer(&self, e: ExprId, declarator: VarDeclId) -> MentionUse {
        let hir = self.input.hir;
        let declaration = &hir[declarator];
        let is_whole_initializer = hir.skip_type_assertions(declaration.init) == e;
        match hir[declaration.pat].kind {
            PatKind::Ident(_)
                if is_whole_initializer
                    && self.is_local_alias(declaration.pat)
                    && self.held_value_of(e).is_none() =>
            {
                MentionUse::Aliased
            }
            PatKind::Ident(_)
                if self.is_local_alias(declaration.pat)
                    && self.find_object_only_held_by(declaration.init).is_some()
                    && (is_whole_initializer
                        || (self.held_value_of(e).is_none()
                            && self.ends_row_of_tests(declaration.init, e))) =>
            {
                MentionUse::Aliased
            }
            PatKind::Object(_)
                if is_whole_initializer && !matches!(hir[e].kind, ExprKind::Cond { .. }) =>
            {
                MentionUse::Destructured(declaration.pat)
            }
            PatKind::Ident(_) | PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => {
                MentionUse::Exposed
            }
        }
    }
}
