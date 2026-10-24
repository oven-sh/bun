use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::resolver::{ExprState, ResolvedValue, Resolver};
use super::{
    BuiltinPath, ModuleField, ModuleObjectMention, ModuleObjectOwner, ModuleObjectUse,
    SourceDialect,
};
use crate::builtins::table::{self, BuiltinId, Mutability};
use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable, Parent};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, MemberKey, NodeData, PatId, PatKind, PropKey, StmtId, StmtKind,
    UnOp,
};
use bun_sema::import_sites::is_made_require;
use smallvec::{SmallVec, smallvec};

fn field_of(member: BuiltinId) -> Option<ModuleField> {
    match member {
        BuiltinId::ModuleObjectId => Some(ModuleField::Id),
        BuiltinId::ModuleObjectFilename => Some(ModuleField::Filename),
        BuiltinId::ModuleObjectPath => Some(ModuleField::Path),
        BuiltinId::ModuleObjectLoaded => Some(ModuleField::Loaded),
        _ => None,
    }
}

// The value may be the module object of some file: nothing is concluded from it but what is done with such an object.
fn some_module_object() -> ResolvedValue {
    ResolvedValue::object(BuiltinPath {
        id: BuiltinId::ModuleObject,
        mutability: Mutability::ChangesOnItsOwn,
    })
}

/// `require.main`, `process.mainModule` and `module.parent` hold a module object, so a member of what they hold is a member of one.
pub(super) fn find_module_object_in(location: ResolvedValue) -> Option<ResolvedValue> {
    match table::canonical_id(location.path.id) {
        BuiltinId::ModuleRequireMain
        | BuiltinId::ProcessMainModule
        | BuiltinId::ModuleObjectParent => Some(some_module_object()),
        _ => None,
    }
}

/// `module.children[0]`.
pub(super) fn find_child_module(holder: ResolvedValue, key: MemberKey) -> Option<ResolvedValue> {
    let is_list = table::canonical_id(holder.path.id) == BuiltinId::ModuleObjectChildren;
    match key {
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

impl Resolver<'_, '_> {
    /// What `createRequire` has made has the members of a `require`, and is the `require` of no file.
    pub(super) fn find_made_require(&self, object: ExprId) -> Option<ResolvedValue> {
        let input = self.input;
        let is_made = self.loads_node_module
            && input.dialect == SourceDialect::Program
            && table::exists_on(BuiltinId::ModuleRequire, input.platform)
            && is_made_require(input.hir, input.bound, object);
        is_made.then(|| {
            ResolvedValue::object(BuiltinPath {
                id: BuiltinId::ModuleRequire,
                mutability: Mutability::ChangesOnItsOwn,
            })
        })
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

    // Whoever reads the result learns whether there is an object, and does not get the object.
    fn is_only_tested(&self, e: ExprId) -> bool {
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
                // `a && b` answers `a` only where `a` is no object.
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

    fn find_member_of(&self, object: ExprId) -> Option<ExprId> {
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

    fn is_plain_read(&self, member: ExprId) -> bool {
        !self.input.bound.is_write_access(self.input.hir, member) && !self.is_deleted(member)
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

    // Whether `object` is the module object of that file in every run. `process` is a global that another file may replace.
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
            // They have a mention of their own.
            BuiltinId::ModuleObjectParent | BuiltinId::ModuleObjectChildren => {
                self.is_plain_read(member)
            }
            _ => is_certain && field_of(id).is_some() && self.is_plain_read(member),
        }
    }

    fn find_use_of_object(&self, e: ExprId, owner: ModuleObjectOwner) -> Option<ModuleObjectUse> {
        if self.input.bound.is_write_access(self.input.hir, e) {
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
            MentionUse::Holder if self.is_answered_without_object(e, owner) => None,
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
        if !self.is_plain_read(member) {
            return None;
        }
        let member_use = match id {
            BuiltinId::ModuleObjectChildren => ModuleObjectUse::Children,
            BuiltinId::ModuleObjectParent if self.is_only_tested(member) => {
                ModuleObjectUse::ParentTested
            }
            BuiltinId::ModuleObjectParent => ModuleObjectUse::Parent,
            _ if self.is_certainly_of(object, owner) => ModuleObjectUse::Field(field_of(id)?),
            _ => return None,
        };
        Some((owner, member_use))
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
        let owner = match table::canonical_id(value.path.id) {
            // Whoever has let it into the binding or the list has been counted.
            BuiltinId::ModuleObject if is_held => return None,
            BuiltinId::ModuleObject => ModuleObjectOwner::OwnFile,
            BuiltinId::ModuleRequireMain | BuiltinId::ProcessMainModule => {
                ModuleObjectOwner::EntryPoint
            }
            id @ (BuiltinId::ModuleObjectChildren | BuiltinId::ModuleObjectParent) => {
                return self.find_use_of_member(e, id);
            }
            id if field_of(id).is_some() => return self.find_use_of_member(e, id),
            _ => return None,
        };
        let object_use = self.find_use_of_object(e, owner)?;
        Some((owner, object_use))
    }

    // `const { parent } = module`: a pattern reads the members that it names, and a rest element or a computed key reads any.
    fn find_ways_that_pattern_reads(
        &self,
        object: ExprId,
    ) -> SmallVec<[(ModuleObjectOwner, ModuleObjectUse); 2]> {
        let hir = self.input.hir;
        let mut ways = SmallVec::new();
        let Some(owner) = self.find_owner(object) else {
            return ways;
        };
        let MentionUse::Destructured(pattern) = self.classify_use(object) else {
            return ways;
        };
        let mut work_stack: SmallVec<[(ModuleObjectOwner, PatId); 2]> = smallvec![(owner, pattern)];
        while let Some((owner, pattern)) = work_stack.pop() {
            let PatKind::Object(props) = hir[pattern].kind else {
                continue;
            };
            for prop in props.iter() {
                let prop = &hir[prop];
                let member = match prop.key {
                    PropKey::Name(name) if !prop.is_rest => {
                        self.find_named_member(some_module_object(), name)
                    }
                    _ => {
                        ways.push((owner, ModuleObjectUse::Parent));
                        ways.push((owner, ModuleObjectUse::Children));
                        continue;
                    }
                };
                match member.map(|member| table::canonical_id(member.id)) {
                    Some(BuiltinId::ModuleObjectParent) => {
                        ways.push((owner, ModuleObjectUse::Parent));
                        work_stack.push((ModuleObjectOwner::Related, prop.value));
                    }
                    Some(BuiltinId::ModuleObjectChildren) => {
                        ways.push((owner, ModuleObjectUse::Children));
                    }
                    _ => {}
                }
            }
        }
        ways
    }

    pub(super) fn collect_module_object_mentions(&mut self) {
        if self.input.dialect != SourceDialect::Program {
            return;
        }
        let mut mentions = Vec::new();
        for expr in self.evaluated_exprs() {
            let found = self.find_module_object_mention(expr).into_iter();
            for (owner, object_use) in found.chain(self.find_ways_that_pattern_reads(expr)) {
                mentions.push(ModuleObjectMention {
                    expr,
                    owner,
                    object_use,
                });
            }
        }
        // A direct `eval`, `arguments`, `with` and `var module` come to the object where no expression names it.
        if self.exposes_own_module_object {
            mentions.push(ModuleObjectMention {
                expr: ExprId::NONE,
                owner: ModuleObjectOwner::OwnFile,
                object_use: ModuleObjectUse::Object,
            });
        }
        self.output.module_object_mentions = mentions;
    }
}
