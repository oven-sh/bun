use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::module_cache::{is_module_cache, name_of_module_cache};
use super::resolver::{ExprState, ResolvedValue, Resolver};
use super::{
    BuiltinPath, ModuleField, ModuleObjectMention, ModuleObjectOwner, ModuleObjectUse,
    SourceDialect,
};
use crate::builtins::table::{self, BuiltinFlags, BuiltinId, Mutability};
use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable, Parent};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, MemberKey, NodeData, PatId, PatKind, PropKey, PropKind, StmtId,
    StmtKind, UnOp,
};
use bun_sema::import_sites::{OwnRequire, answers_with_require, find_own_require, is_made_require};
use smallvec::{SmallVec, smallvec};

const HOLDER_ESCAPED: (ModuleObjectOwner, ModuleObjectUse) = (
    ModuleObjectOwner::EntryPoint,
    ModuleObjectUse::HolderEscaped,
);

fn leads_to_main_module(global: BuiltinId) -> bool {
    table::has_flag(global, BuiltinFlags::IS_GLOBAL_OBJECT)
        || table::canonical_id(global) == BuiltinId::Process
}

fn field_of(member: BuiltinId) -> Option<ModuleField> {
    match member {
        BuiltinId::ModuleObjectId => Some(ModuleField::Id),
        BuiltinId::ModuleObjectFilename => Some(ModuleField::Filename),
        BuiltinId::ModuleObjectPath => Some(ModuleField::Path),
        BuiltinId::ModuleObjectLoaded => Some(ModuleField::Loaded),
        _ => None,
    }
}

fn some_module_object() -> ResolvedValue {
    ResolvedValue::object(BuiltinPath {
        id: BuiltinId::ModuleObject,
        mutability: Mutability::ChangesOnItsOwn,
    })
}

pub(super) fn find_module_object_in(location: ResolvedValue) -> Option<ResolvedValue> {
    match table::canonical_id(location.path.id) {
        BuiltinId::ModuleRequireMain
        | BuiltinId::ProcessMainModule
        | BuiltinId::ModuleObjectParent => Some(some_module_object()),
        _ => None,
    }
}

pub(super) fn find_listed_module(holder: ResolvedValue, key: MemberKey) -> Option<ResolvedValue> {
    let is_list = table::canonical_id(holder.path.id) == BuiltinId::ModuleObjectChildren;
    match key {
        MemberKey::Computed(_) | MemberKey::Name(_) if is_module_cache(holder.path.id) => {
            Some(some_module_object())
        }
        MemberKey::Computed(_) if is_list => Some(some_module_object()),
        MemberKey::Computed(_) | MemberKey::Name(_) | MemberKey::PrivateName(_) => None,
    }
}

fn is_test_or_dropped(hir: &hir::File<'_>, node: ExprId, statement: StmtId) -> bool {
    match hir[statement].kind {
        StmtKind::Expr(_) => true,
        StmtKind::If { test, .. }
        | StmtKind::While { test, .. }
        | StmtKind::DoWhile { test, .. } => node == test,
        StmtKind::For { test, update, .. } => node == test || node == update,
        _ => false,
    }
}

fn made_require() -> ResolvedValue {
    ResolvedValue::object(BuiltinPath {
        id: BuiltinId::ModuleRequire,
        mutability: Mutability::ChangesOnItsOwn,
    })
}

impl Resolver<'_, '_> {
    pub(super) fn find_made_require(&self, object: ExprId) -> Option<ResolvedValue> {
        let input = self.input;
        let is_imported = || {
            matches!(
                find_own_require(input.hir, input.bound, Some(input.decisions), object),
                Some(OwnRequire::OfOtherFile(_) | OwnRequire::MadeInOtherFile(_))
            )
        };
        let is_made = self.may_hold_made_require
            && input.dialect == SourceDialect::Program
            && table::exists_on(BuiltinId::ModuleRequire, input.platform)
            && (is_made_require(input.hir, input.bound, object) || is_imported());
        is_made.then(made_require)
    }

    pub(super) fn find_module_cache_of_made_require(
        &self,
        require: ExprId,
    ) -> Option<ResolvedValue> {
        let input = self.input;
        let is_require = input.dialect == SourceDialect::Program
            && (self.find_made_require(require).is_some()
                || answers_with_require(input.hir, input.bound, input.decisions, require));
        let cache = self.find_member(made_require(), name_of_module_cache())?;
        is_require.then(|| ResolvedValue::object(cache))
    }

    fn is_nullish_constant(&self, e: ExprId) -> bool {
        let input = self.input;
        let e = input.hir.skip_type_assertions(e);
        let names_undefined =
            matches!(input.hir[e].kind, ExprKind::Ident(name) if name == known::undefined);
        let is_global_undefined = names_undefined
            && input.bound.binding(e) == Binding::Free
            && input
                .bound
                .dynamic_lookup_scope(NodeData::Expr(e))
                .is_none();
        is_global_undefined
            || matches!(
                input.decisions.constant(input.hir, e),
                FoldedValue::Constant(Constant::Undefined | Constant::Null)
            )
    }

    pub(super) fn is_only_tested(&self, e: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = e;
        loop {
            let parent = match bound.parent_of_expr(node) {
                Parent::Expr(parent) => parent,
                Parent::Stmt(statement) => return is_test_or_dropped(hir, node, statement),
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_)
                | ExprKind::Instantiation { .. } => {}
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                    ..
                } => return true,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    left,
                    ..
                } if node == left => return true,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                } => {}
                ExprKind::Binary {
                    op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                    left,
                    right,
                } => return self.is_nullish_constant(if node == left { right } else { left }),
                ExprKind::Cond { test, .. } if node == test => return true,
                ExprKind::Cond { .. } => {}
                _ => return false,
            }
            node = parent;
        }
    }

    pub(super) fn find_member_of(&self, object: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = object;
        loop {
            let Parent::Expr(parent) = bound.parent_of_expr(node) else {
                return None;
            };
            if hir.type_assertion_operand(parent).is_none() {
                let (accessed, _) = hir.member_key(parent)?;
                return (accessed == node).then_some(parent);
            }
            node = parent;
        }
    }

    fn goes_out_of_sight(&self, e: ExprId) -> bool {
        let escapes = matches!(
            self.classify_use(e),
            MentionUse::Exposed | MentionUse::ReadByComputedKey
        );
        let member = self.find_member_of(e);
        escapes && !self.is_only_tested(e) && !member.is_some_and(|member| self.is_deleted(member))
    }

    fn is_plain_read(&self, member: ExprId) -> bool {
        !self.input.bound.is_stored_to(self.input.hir, member) && !self.is_deleted(member)
    }

    fn find_owner(&self, object: ExprId) -> Option<ModuleObjectOwner> {
        let (value, is_held) = match self.state(self.input.hir.skip_type_assertions(object)) {
            ExprState::Builtin(value) => (value, false),
            ExprState::Held(value) => (value, true),
            _ => return None,
        };
        match table::canonical_id(value.path.id) {
            BuiltinId::ModuleObject if is_held => Some(ModuleObjectOwner::Related),
            BuiltinId::ModuleObject => Some(ModuleObjectOwner::OwnFile),
            BuiltinId::ModuleRequireMain | BuiltinId::ProcessMainModule => {
                Some(ModuleObjectOwner::EntryPoint)
            }
            BuiltinId::ModuleObjectParent => Some(ModuleObjectOwner::Related),
            _ => None,
        }
    }

    fn is_locked(&self, variable: CommonJsVariable) -> bool {
        let path = self.commonjs.get(variable);
        path.is_some_and(|path| path.mutability == Mutability::AlwaysLocked)
    }

    fn is_certainly_of(&self, object: ExprId, owner: ModuleObjectOwner) -> bool {
        let ExprState::Builtin(value) = self.state(self.input.hir.skip_type_assertions(object))
        else {
            return false;
        };
        match owner {
            ModuleObjectOwner::OwnFile => self.is_locked(CommonJsVariable::Module),
            ModuleObjectOwner::EntryPoint => {
                table::canonical_id(value.path.id) == BuiltinId::ModuleRequireMain
                    && self.is_locked(CommonJsVariable::Require)
            }
            ModuleObjectOwner::Related => false,
        }
    }

    fn is_what_its_exports_are_called_with(&self, object: ExprId) -> bool {
        let Some(member) = self.find_member_of(object) else {
            return false;
        };
        let MentionUse::Called(call) = self.classify_use(member) else {
            return false;
        };
        let id = mentioned_id(self.state(member)).map(table::canonical_id);
        id == Some(BuiltinId::ModuleObjectExports)
            && !matches!(self.input.hir[call].kind, ExprKind::New(_))
    }

    fn is_answered_without_object(&self, object: ExprId, owner: ModuleObjectOwner) -> bool {
        let Some(member) = self.find_member_of(object) else {
            return false;
        };
        let Some(id) = mentioned_id(self.state(member)).map(table::canonical_id) else {
            return false;
        };
        let is_certain = self.is_certainly_of(object, owner);
        let is_of_own_file = is_certain && owner == ModuleObjectOwner::OwnFile;
        match id {
            BuiltinId::ModuleObjectExports => is_of_own_file && !self.is_deleted(member),
            BuiltinId::ModuleObjectPaths | BuiltinId::ModuleRequire => {
                is_of_own_file && self.is_plain_read(member)
            }
            BuiltinId::ModuleObjectParent | BuiltinId::ModuleObjectChildren => {
                self.is_plain_read(member)
            }
            _ => is_certain && field_of(id).is_some() && self.is_plain_read(member),
        }
    }

    fn is_given_exports_by_descriptor(&self, e: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let operand = self.outermost_assertion_of(e);
        let Parent::Expr(user) = bound.parent_of_expr(operand) else {
            return false;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return false;
        };
        let Parent::Stmt(statement) = bound.parent_of_expr(user) else {
            return false;
        };
        let mut operands = hir.ids::<ExprId>(hir[call].args);
        let callee = mentioned_id(self.state(hir.skip_type_assertions(hir[call].callee)));
        let defines = callee.map(table::canonical_id).is_some_and(|callee| {
            matches!(
                callee,
                BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty
            )
        });
        if !defines
            || !matches!(hir[statement].kind, StmtKind::Expr(_))
            || operands.next() != Some(operand)
        {
            return false;
        }
        let names_exports = operands.next().is_some_and(|key| {
            matches!(hir[hir.skip_type_assertions(key)].kind, ExprKind::String(name) if name == known::exports)
        });
        let descriptor = operands
            .next()
            .map(|it| hir[hir.skip_type_assertions(it)].kind);
        let Some(ExprKind::Object(members)) = descriptor else {
            return false;
        };
        let is_written_out = members.iter().all(|member| {
            let member = &hir[member];
            let is_function = matches!(
                hir[hir.skip_type_assertions(member.value)].kind,
                ExprKind::Fn(_)
            );
            match (member.kind, member.key) {
                (PropKind::Method, PropKey::Name(_)) => true,
                (PropKind::Init, PropKey::Name(name)) => {
                    is_function || (name != known::get && name != known::set)
                }
                _ => false,
            }
        });
        let written_at = hir[user].pos..hir[user].end;
        names_exports
            && is_written_out
            && !(0..hir.exprs.len() as u32).map(ExprId).any(|it| {
                matches!(hir[it].kind, ExprKind::This | ExprKind::Super)
                    && written_at.contains(&hir[it].pos)
            })
    }

    fn find_use_of_object(&self, e: ExprId, owner: ModuleObjectOwner) -> Option<ModuleObjectUse> {
        if self.input.bound.is_stored_to(self.input.hir, e) {
            return Some(ModuleObjectUse::Object);
        }
        if self.is_only_tested(e) {
            return match owner {
                ModuleObjectOwner::EntryPoint => Some(ModuleObjectUse::Tested),
                ModuleObjectOwner::OwnFile | ModuleObjectOwner::Related => None,
            };
        }
        match self.classify_use(e) {
            MentionUse::Aliased => None,
            MentionUse::Holder if self.is_what_its_exports_are_called_with(e) => {
                Some(ModuleObjectUse::Escaped)
            }
            MentionUse::Holder if self.is_answered_without_object(e, owner) => None,
            _ if self.is_given_exports_by_descriptor(e) => Some(ModuleObjectUse::Object),
            _ if self.goes_out_of_sight(e) => Some(ModuleObjectUse::Escaped),
            _ => Some(ModuleObjectUse::Object),
        }
    }

    fn find_use_of_member(
        &self,
        member: ExprId,
        id: BuiltinId,
    ) -> Option<(ModuleObjectOwner, ModuleObjectUse)> {
        let (object, _) = self.input.hir.member_key(member)?;
        let owner = self.find_owner(object)?;
        let member_use = match id {
            BuiltinId::ModuleObjectChildren
                if !self.is_plain_read(member) || self.goes_out_of_sight(member) =>
            {
                ModuleObjectUse::Escaped
            }
            BuiltinId::ModuleObjectChildren => ModuleObjectUse::Children,
            _ if !self.is_plain_read(member) => return None,
            BuiltinId::ModuleObjectParent if self.is_only_tested(member) => {
                ModuleObjectUse::ParentTested
            }
            BuiltinId::ModuleObjectParent if self.goes_out_of_sight(member) => {
                ModuleObjectUse::Escaped
            }
            BuiltinId::ModuleObjectParent => ModuleObjectUse::Parent,
            _ if self.is_certainly_of(object, owner) => ModuleObjectUse::Field(field_of(id)?),
            _ => return None,
        };
        Some((owner, member_use))
    }

    fn reads_member_that_it_does_not_name(&self, holder: BuiltinId, pattern: PatId) -> bool {
        let hir = self.input.hir;
        let PatKind::Object(props) = hir[pattern].kind else {
            return false;
        };
        props.iter().any(|prop| {
            let prop = &hir[prop];
            match prop.key {
                PropKey::Name(name) if !prop.is_rest => {
                    self.is_inherited_object_prototype_member(Some(holder), name)
                }
                _ => true,
            }
        })
    }

    fn does_holder_escape(&self, e: ExprId, holder: BuiltinId) -> bool {
        match self.classify_use(e) {
            MentionUse::Exposed => true,
            MentionUse::Destructured(pattern) => {
                self.reads_member_that_it_does_not_name(holder, pattern)
            }
            MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Called(_)
            | MentionUse::Inspected
            | MentionUse::Aliased => false,
        }
    }

    fn is_kept_in_var(&self, e: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut whole = self.outermost_assertion_of(e);
        while let Parent::Expr(parent) = bound.parent_of_expr(whole)
            && let ExprKind::Binary {
                op: BinOp::And,
                right,
                ..
            } = hir[parent].kind
            && right == whole
        {
            whole = self.outermost_assertion_of(parent);
        }
        let stands_behind_tests = whole != self.outermost_assertion_of(e);
        let Parent::VarInit(declarator) = bound.parent_of_expr(whole) else {
            return false;
        };
        let name = hir[declarator].pat;
        let PatKind::Ident(_) = hir[name].kind else {
            return false;
        };
        match (bound.initialized_binding(name), self.value_of(e)) {
            (Binding::Symbol(variable), Some(value)) => {
                stands_behind_tests || self.may_still_be_undefined(variable, value)
            }
            _ => false,
        }
    }

    fn find_module_object_mention(
        &self,
        e: ExprId,
    ) -> Option<(ModuleObjectOwner, ModuleObjectUse)> {
        let (value, is_held) = match self.state(e) {
            ExprState::Builtin(value) => (value, false),
            ExprState::Held(value) => (value, true),
            _ => return None,
        };
        let escaped_use = (ModuleObjectOwner::Related, ModuleObjectUse::Escaped);
        let owner = match table::canonical_id(value.path.id) {
            BuiltinId::ModuleObject if is_held => {
                let escapes =
                    self.goes_out_of_sight(e) || self.is_what_its_exports_are_called_with(e);
                return escapes.then_some(escaped_use);
            }
            BuiltinId::ModuleObjectChildren | BuiltinId::ModuleObjectParent
                if self.input.hir.member_key(e).is_none() =>
            {
                return self.goes_out_of_sight(e).then_some(escaped_use);
            }
            BuiltinId::ModuleObject => ModuleObjectOwner::OwnFile,
            BuiltinId::ModuleRequireMain | BuiltinId::ProcessMainModule => {
                ModuleObjectOwner::EntryPoint
            }
            BuiltinId::ModuleRequire => {
                return self
                    .does_holder_escape(e, BuiltinId::ModuleRequire)
                    .then_some((ModuleObjectOwner::EntryPoint, ModuleObjectUse::Escaped));
            }
            BuiltinId::Process => {
                return self
                    .does_holder_escape(e, BuiltinId::Process)
                    .then_some(HOLDER_ESCAPED);
            }
            id if table::has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT) => {
                let escapes = self.does_holder_escape(e, BuiltinId::GlobalThis)
                    || matches!(self.classify_use(e), MentionUse::ReadByComputedKey);
                return escapes.then_some(HOLDER_ESCAPED);
            }
            id @ (BuiltinId::ModuleObjectChildren | BuiltinId::ModuleObjectParent) => {
                return self.find_use_of_member(e, id);
            }
            id if field_of(id).is_some() => return self.find_use_of_member(e, id),
            _ => return None,
        };
        let object_use = match self.classify_use(e) {
            MentionUse::Aliased if self.is_kept_in_var(e) => ModuleObjectUse::Object,
            _ => self.find_use_of_object(e, owner)?,
        };
        Some((owner, object_use))
    }

    fn push_ways_that_pattern_reads(
        &self,
        object: ExprId,
        mentions: &mut Vec<ModuleObjectMention>,
    ) {
        let hir = self.input.hir;
        let Some(owner) = self.find_owner(object) else {
            return;
        };
        let MentionUse::Destructured(pattern) = self.classify_use(object) else {
            return;
        };
        let mut push = |owner: ModuleObjectOwner, object_use: ModuleObjectUse| {
            mentions.push(ModuleObjectMention {
                expr: object,
                owner,
                object_use,
            });
        };
        let mut work_stack: SmallVec<[(ModuleObjectOwner, PatId); 2]> = smallvec![(owner, pattern)];
        while let Some((owner, pattern)) = work_stack.pop() {
            let PatKind::Object(props) = hir[pattern].kind else {
                continue;
            };
            for prop in props.iter() {
                let prop = &hir[prop];
                let module_object = Some(BuiltinId::ModuleObject);
                let member = match prop.key {
                    PropKey::Name(name)
                        if !prop.is_rest
                            && !self.is_inherited_object_prototype_member(module_object, name) =>
                    {
                        self.find_named_member(some_module_object(), name)
                    }
                    _ => {
                        push(owner, ModuleObjectUse::Escaped);
                        continue;
                    }
                };
                match member.map(|member| table::canonical_id(member.id)) {
                    Some(BuiltinId::ModuleObjectParent) => {
                        push(owner, ModuleObjectUse::Parent);
                        work_stack.push((ModuleObjectOwner::Related, prop.value));
                    }
                    Some(BuiltinId::ModuleObjectChildren) => {
                        push(owner, ModuleObjectUse::Children);
                    }
                    _ => {}
                }
            }
        }
    }

    fn find_way_that_computed_key_reads(
        &self,
        member: ExprId,
    ) -> Option<(ModuleObjectOwner, ModuleObjectUse)> {
        let (object, MemberKey::Computed(_)) = self.input.hir.member_key(member)? else {
            return None;
        };
        (self.holds_main_module(object) && self.is_plain_read(member))
            .then_some((ModuleObjectOwner::EntryPoint, ModuleObjectUse::Escaped))
    }

    fn holds_main_module(&self, object: ExprId) -> bool {
        let (ExprState::Builtin(value) | ExprState::Held(value)) =
            self.state(self.input.hir.skip_type_assertions(object))
        else {
            return false;
        };
        matches!(
            table::canonical_id(value.path.id),
            BuiltinId::ModuleRequire | BuiltinId::Process
        )
    }

    fn find_require_out_of_sight(
        &self,
        e: ExprId,
        state: ExprState,
        id: Option<BuiltinId>,
    ) -> Option<(ModuleObjectOwner, ModuleObjectUse)> {
        let is_out_of_sight = match state {
            ExprState::Unresolved => {
                self.find_made_require(e).is_some()
                    && matches!(self.classify_use(e), MentionUse::Exposed)
                    && !matches!(self.input.bound.parent_of_expr(e), Parent::VarInit(_))
            }
            _ => {
                id == Some(BuiltinId::NodeModuleCreateRequire)
                    && match self.classify_use(e) {
                        MentionUse::Called(call) => self.find_made_require(call).is_none(),
                        MentionUse::Exposed
                        | MentionUse::ReadByComputedKey
                        | MentionUse::Destructured(_) => true,
                        MentionUse::Holder | MentionUse::Inspected | MentionUse::Aliased => false,
                    }
            }
        };
        is_out_of_sight.then_some((ModuleObjectOwner::EntryPoint, ModuleObjectUse::Escaped))
    }

    fn may_store_path_of_main_module(
        &self,
        e: ExprId,
        id: Option<BuiltinId>,
        holds_path: Option<BuiltinId>,
    ) -> bool {
        if id.is_some() && id == holds_path {
            return !self.is_plain_read(e);
        }
        id == Some(BuiltinId::Bun)
            && matches!(
                self.classify_use(e),
                MentionUse::Exposed | MentionUse::ReadByComputedKey
            )
    }

    #[inline(never)]
    fn push_module_object_mentions_at(
        &self,
        expr: ExprId,
        holds_path: Option<BuiltinId>,
        mentions: &mut Vec<ModuleObjectMention>,
    ) -> bool {
        let hir = self.input.hir;
        let state = self.state(expr);
        let id = mentioned_id(state).map(table::canonical_id);
        let may_store_path = self.may_store_path_of_main_module(expr, id, holds_path);
        if let Some((owner, object_use)) = self.find_require_out_of_sight(expr, state, id) {
            mentions.push(ModuleObjectMention {
                expr,
                owner,
                object_use,
            });
            return may_store_path;
        }
        if matches!(hir[expr].kind, ExprKind::This) {
            let is_evaluated = matches!(state, ExprState::Unresolved);
            let global = self.find_global_out_of_sight_through(expr);
            if is_evaluated && global.is_some_and(leads_to_main_module) {
                let (owner, object_use) = HOLDER_ESCAPED;
                mentions.push(ModuleObjectMention {
                    expr,
                    owner,
                    object_use,
                });
            }
            return may_store_path;
        }
        let stands_for_builtin = matches!(state, ExprState::Builtin(_) | ExprState::Held(_));
        if !stands_for_builtin
            && !matches!(hir[expr].kind, ExprKind::Index { .. })
            && hir.type_assertion_operand(expr).is_none()
        {
            return may_store_path;
        }
        let found = self.find_module_object_mention(expr).into_iter();
        for (owner, object_use) in found.chain(self.find_way_that_computed_key_reads(expr)) {
            mentions.push(ModuleObjectMention {
                expr,
                owner,
                object_use,
            });
        }
        self.push_ways_that_pattern_reads(expr, mentions);
        may_store_path
    }

    pub(super) fn collect_module_object_mentions(&mut self) {
        if self.input.dialect != SourceDialect::Program {
            return;
        }
        let hir = self.input.hir;
        let main = self.input.names.get(known::main);
        let holds_path = main.and_then(|main| table::own_member(BuiltinId::Bun, main));
        let holds_path = holds_path.map(table::canonical_id);
        let mut may_store_path = false;
        let mut mentions = Vec::new();
        let mut found_or_this = &self.found_or_this[..];
        let is_read_off =
            |&found: &ExprId| self.find_owner(found).is_some() || self.holds_main_module(found);
        if self.may_hold_made_require || found_or_this.iter().any(is_read_off) {
            for expr in self.evaluated_exprs() {
                while let [listed, rest @ ..] = found_or_this
                    && *listed < expr
                {
                    found_or_this = rest;
                }
                if self.may_hold_made_require
                    || found_or_this.first() == Some(&expr)
                    || matches!(hir[expr].kind, ExprKind::Index { .. })
                    || hir.type_assertion_operand(expr).is_some()
                {
                    may_store_path |=
                        self.push_module_object_mentions_at(expr, holds_path, &mut mentions);
                }
            }
        } else {
            for &expr in found_or_this {
                may_store_path |=
                    self.push_module_object_mentions_at(expr, holds_path, &mut mentions);
            }
        }
        if self.exposes_own_module_object {
            mentions.push(ModuleObjectMention {
                expr: ExprId::NONE,
                owner: ModuleObjectOwner::OwnFile,
                object_use: ModuleObjectUse::Object,
            });
        }
        if self.exposes_own_require {
            mentions.push(ModuleObjectMention {
                expr: ExprId::NONE,
                owner: ModuleObjectOwner::EntryPoint,
                object_use: ModuleObjectUse::Escaped,
            });
        }
        self.output.module_object_mentions = mentions;
        self.output.may_store_path_of_main_module = may_store_path;
    }
}
