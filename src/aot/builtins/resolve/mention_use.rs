use super::mentions::mentioned_id;
use super::resolver::{ExprState, Resolver};
use crate::builtins::table::{self, BuiltinId, Intrinsic};
use bun_sema::bind::{Binding, BindingInitializer, Decl, FunctionFlags, Parent, SymbolId};
use bun_sema::hir::{
    self, BinOp, CallId, ExprId, ExprKind, Flags, FnId, MemberKey, PatId, PatKind, StmtId,
    StmtKind, UnOp, VarDeclId,
};
use std::ops::ControlFlow;

pub(super) enum MentionUse {
    Holder,
    ReadByComputedKey,
    Called(ExprId),
    Inspected,
    SearchedFor(ExprId),
    SearchedForKeysOf(ExprId),
    Aliased,
    Destructured(PatId),
    StoredInto(SymbolId),
    Exposed,
}

// It lists the keys of its first operand or sets the link to its prototype, and looks for no member of it.
fn looks_at_first_operand(builtin: BuiltinId) -> bool {
    matches!(
        builtin,
        BuiltinId::ObjectKeys
            | BuiltinId::ObjectGetOwnPropertyNames
            | BuiltinId::ObjectGetOwnPropertySymbols
            | BuiltinId::ReflectOwnKeys
            | BuiltinId::ObjectSetPrototypeOf
            | BuiltinId::ReflectSetPrototypeOf
    )
}

#[rustfmt::skip]
fn classify_stmt_parent(hir: &hir::File<'_>, node: ExprId, stmt: StmtId) -> MentionUse {
    match hir[stmt].kind {
        StmtKind::Expr(_) | StmtKind::Switch { .. } => MentionUse::Inspected,
        StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } if node == test => MentionUse::Inspected,
        StmtKind::For { test, update, .. } if node == test || node == update => MentionUse::Inspected,
        // The host makes a member when it is first looked for, and each step looks for the name that it hands out.
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
            ExprKind::Binary { op: BinOp::In, left, right } if node == right => {
                MentionUse::SearchedFor(left)
            }
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => {
                return ControlFlow::Continue(parent);
            }
            ExprKind::Binary { op: BinOp::Comma, right, .. } if node == right => {
                return ControlFlow::Continue(parent);
            }
            ExprKind::Binary { .. } => MentionUse::Inspected,
            ExprKind::Cond { test, .. } if node != test => return ControlFlow::Continue(parent),
            ExprKind::Cond { .. } => MentionUse::Inspected,
            ExprKind::Dot { .. } => self.classify_object(e, node, parent),
            ExprKind::Index { obj, .. } if node == obj => self.classify_object(e, node, parent),
            ExprKind::Index { .. } => MentionUse::Inspected,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if node == hir[call].callee => MentionUse::Called(parent),
            ExprKind::Assign { target, .. } if node == target => MentionUse::Inspected,
            ExprKind::Template { .. } if self.is_tagged_template(parent) => MentionUse::Exposed,
            ExprKind::Unary { .. } | ExprKind::Template { .. } => MentionUse::Inspected,
            ExprKind::Call(call) | ExprKind::New(call) => self.classify_operand(e, parent, call, node),
            ExprKind::TaggedTemplate(_) | ExprKind::Spread(_) => MentionUse::Exposed,
            ExprKind::Assign { target, .. } => self.classify_store(target),
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

    fn classify_holder(&self, symbol: SymbolId) -> MentionUse {
        match self.can_hold_builtin(symbol) {
            true => MentionUse::StoredInto(symbol),
            false => MentionUse::Exposed,
        }
    }

    fn classify_store(&self, target: ExprId) -> MentionUse {
        let target = self.input.hir.skip_type_assertions(target);
        match (
            self.input.hir[target].kind,
            self.input.bound.binding(target),
        ) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => self.classify_holder(symbol),
            _ => MentionUse::Exposed,
        }
    }

    fn find_called_function(&self, callee: ExprId) -> Option<FnId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let Binding::Symbol(symbol) = bound.binding(callee) else {
            return None;
        };
        if !matches!(hir[callee].kind, ExprKind::Ident(_)) || !bound.is_stable_binding(symbol) {
            return None;
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Function(function) => Some(function),
            BindingInitializer::Expression(initializer) => {
                match hir[hir.skip_type_assertions(initializer)].kind {
                    ExprKind::Fn(function) => Some(function),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn find_parameter(&self, call: CallId, operand: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let function = self.find_called_function(hir.skip_type_assertions(hir[call].callee))?;
        if bound
            .function_flags(function)
            .contains(FunctionFlags::USES_ARGUMENTS)
        {
            return None;
        }
        let mut operands = hir.ids(hir[call].args);
        let index = operands.by_ref().position(|it| it == operand)?;
        let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
        if hir.ids(hir[call].args).take(index).any(is_spread) {
            return None;
        }
        let parameter = &hir[hir[function].params.iter().nth(index)?];
        let is_plain_name = matches!(hir[parameter.pat].kind, PatKind::Ident(_))
            && !parameter.flags.contains(Flags::REST);
        let symbol = bound.declared_symbol(Decl::Param(parameter.pat));
        (is_plain_name && !symbol.is_none()).then_some(symbol)
    }

    // Native code may walk over every member of what it is handed. A function of this file finds it in a parameter.
    fn classify_operand(
        &self,
        e: ExprId,
        parent: ExprId,
        call: CallId,
        operand: ExprId,
    ) -> MentionUse {
        let hir = self.input.hir;
        if let Some(parameter) = self.find_parameter(call, operand) {
            return self.classify_holder(parameter);
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        let is_first = hir.ids(hir[call].args).next() == Some(operand);
        let is_whole_operand = hir.skip_type_assertions(operand) == e;
        if is_first && is_whole_operand && self.is_receiver_of_own_method(e, callee) {
            return MentionUse::Inspected;
        }
        let Some(builtin) = mentioned_id(self.state(callee)) else {
            return MentionUse::Exposed;
        };
        match table::canonical_id(builtin) {
            BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf
                if is_first && self.is_resolved(parent) =>
            {
                MentionUse::Inspected
            }
            // A definition asks the object for the property first, and the host makes a member when it is first looked for.
            BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty if is_first => {
                match hir.ids(hir[call].args).nth(1) {
                    Some(key) => MentionUse::SearchedFor(key),
                    None => MentionUse::Inspected,
                }
            }
            BuiltinId::ObjectDefineProperties if is_first => match hir.ids(hir[call].args).nth(1) {
                Some(descriptors) => MentionUse::SearchedForKeysOf(descriptors),
                None => MentionUse::Inspected,
            },
            builtin if is_first && looks_at_first_operand(builtin) => MentionUse::Inspected,
            _ => MentionUse::Exposed,
        }
    }

    // `object.method.call(object, ..)`, and `apply` and `bind`, for a method that the object itself holds: what `object.method(..)` does with the object.
    fn is_receiver_of_own_method(&self, e: ExprId, callee: ExprId) -> bool {
        let hir = self.input.hir;
        let takes_receiver = self.hands_function_on(callee);
        let Some((function, _)) = hir.member_key(callee).filter(|_| takes_receiver) else {
            return false;
        };
        let Some(function) = mentioned_id(self.state(hir.skip_type_assertions(function))) else {
            return false;
        };
        let holder = table::entry(table::canonical_id(function))
            .holder
            .map(table::canonical_id);
        let object = self.value_of(e).or_else(|| self.held_value_of(e));
        object.is_some_and(|object| holder == Some(table::canonical_id(object.path.id)))
    }

    fn classify_object(&self, e: ExprId, node: ExprId, member: ExprId) -> MentionUse {
        let hir = self.input.hir;
        if hir.skip_type_assertions(node) != e {
            return MentionUse::Exposed;
        }
        if let Some(key) = self.find_key_that_call_searches_for(member) {
            return MentionUse::SearchedFor(key);
        }
        if self.is_deleted(member) || self.hands_function_on(member) {
            return MentionUse::Exposed;
        }
        // A function that the table does not list gets the object as `this` and may walk over it.
        if !self.is_resolved(member) && self.is_callee(member) {
            return MentionUse::Exposed;
        }
        match hir.member_key(member) {
            Some((_, MemberKey::Name(_) | MemberKey::PrivateName(_))) => MentionUse::Holder,
            Some((_, MemberKey::Computed(_))) if self.is_resolved(member) => MentionUse::Holder,
            Some((_, MemberKey::Computed(_))) => MentionUse::ReadByComputedKey,
            None => MentionUse::Exposed,
        }
    }

    // `f.call(..)`, `f.apply(..)` and `f.bind(..)` call the function, now or later, with operands that nobody looks at here. Only these three: their first operand is the receiver.
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

    // A deletion that finds the member has the host make every other member of the object first.
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

    // `object.hasOwnProperty(key)`: the method that every object inherits looks for a member of the object that it is called on.
    fn find_key_that_call_searches_for(&self, method: ExprId) -> Option<ExprId> {
        let hir = self.input.hir;
        let searches_receiver = matches!(
            mentioned_id(self.state(method)).map(table::canonical_id),
            Some(
                BuiltinId::ObjectPrototypeHasOwnProperty
                    | BuiltinId::ObjectPrototypePropertyIsEnumerable
                    | BuiltinId::ObjectPrototype__lookupGetter__
                    | BuiltinId::ObjectPrototype__lookupSetter__
            )
        );
        let Parent::Expr(parent) = self.input.bound.parent_of_expr(method) else {
            return None;
        };
        let ExprKind::Call(call) = hir[parent].kind else {
            return None;
        };
        if !searches_receiver || hir[call].callee != method {
            return None;
        }
        hir.ids(hir[call].args).next()
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
            PatKind::Object(_) if is_whole_initializer => MentionUse::Destructured(declaration.pat),
            PatKind::Ident(_) => match self.input.bound.initialized_binding(declaration.pat) {
                Binding::Symbol(symbol) => self.classify_holder(symbol),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => MentionUse::Exposed,
            },
            PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => MentionUse::Exposed,
        }
    }
}
