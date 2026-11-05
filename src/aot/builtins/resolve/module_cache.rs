use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId};
use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KeyOfModuleCache {
    Text(Atom),
    Computed(ExprId),
}

pub fn is_module_cache(id: BuiltinId) -> bool {
    let tables = [
        BuiltinId::ModuleRequireCache,
        BuiltinId::ModuleRequirePrototypeCache,
        BuiltinId::NodeModule_cache,
    ];
    (tables.map(table::canonical_id)).contains(&table::canonical_id(id))
}

pub fn is_table_of_loaders(id: BuiltinId) -> bool {
    let tables = [
        BuiltinId::ModuleRequireExtensions,
        BuiltinId::ModuleRequirePrototypeExtensions,
        BuiltinId::NodeModule_extensions,
    ];
    (tables.map(table::canonical_id)).contains(&table::canonical_id(id))
}

pub(super) fn is_function_that_loader_calls(id: BuiltinId) -> bool {
    let functions = [
        BuiltinId::NodeModule_resolveFilename,
        BuiltinId::NodeModulePrototypeRequire,
    ];
    (functions.map(table::canonical_id)).contains(&table::canonical_id(id))
}

impl Resolver<'_, '_> {
    pub(super) fn note_use_of_function_that_loader_calls(&mut self, function: ExprId) {
        if self.is_stored_to(function) {
            self.expose(BuiltinId::NodeModule);
            self.expose(BuiltinId::ModuleObject);
        }
    }

    pub(super) fn note_use_of_table_of_loaders(&mut self, table: ExprId) {
        self.output.loses_sight_of_module_cache |= match self.find_member_of(table) {
            Some(loader) => self.is_deleted(loader) || self.is_stored_to(loader),
            None => match self.classify_use(table) {
                MentionUse::Inspected
                | MentionUse::Holder
                | MentionUse::ReadByComputedKey
                | MentionUse::Aliased => false,
                MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => true,
            },
        };
    }

    fn find_key_that_call_deletes(&self, table: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut operand = table;
        while let Parent::Expr(parent) = bound.parent_of_expr(operand)
            && hir.type_assertion_operand(parent) == Some(operand)
        {
            operand = parent;
        }
        let Parent::Expr(user) = bound.parent_of_expr(operand) else {
            return None;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let mut operands = hir.ids(hir[call].args);
        let is_deletion = mentioned_id(self.state(callee)).map(table::canonical_id)
            == Some(BuiltinId::ReflectDeleteProperty);
        let key = (operands.next() == Some(operand)).then(|| operands.next())?;
        key.filter(|&key: &ExprId| is_deletion && !matches!(hir[key].kind, ExprKind::Spread(_)))
    }

    fn is_stored_to(&self, entry: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut target = entry;
        while let Parent::Expr(parent) = bound.parent_of_expr(target)
            && hir.type_assertion_operand(parent) == Some(target)
        {
            target = parent;
        }
        bound.get_assignment_target(hir, target).is_some()
    }

    pub(super) fn note_use_of_module_cache(&mut self, table: ExprId) {
        let hir = self.input.hir;
        if let Some(entry) = self.find_member_of(table) {
            if self.is_deleted(entry) || self.is_stored_to(entry) {
                let key = match hir.member_key(entry) {
                    Some((_, MemberKey::Name(text) | MemberKey::PrivateName(text))) => {
                        KeyOfModuleCache::Text(text)
                    }
                    Some((_, MemberKey::Computed(key))) => KeyOfModuleCache::Computed(key),
                    None => unreachable!("find_member_of answers with an access"),
                };
                self.output.keys_taken_out_of_module_cache.push(key);
            }
            self.output.gets_at_entries_of_module_cache = true;
            return;
        }
        if let Some(key) = self.find_key_that_call_deletes(table) {
            let key = match hir.index_member_key(hir.skip_type_assertions(key)) {
                MemberKey::Name(text) | MemberKey::PrivateName(text) => {
                    KeyOfModuleCache::Text(text)
                }
                MemberKey::Computed(key) => KeyOfModuleCache::Computed(key),
            };
            self.output.gets_at_entries_of_module_cache = true;
            return self.output.keys_taken_out_of_module_cache.push(key);
        }
        let mention_use = self.classify_use(table);
        let gets_at_entries = !matches!(mention_use, MentionUse::Aliased);
        self.output.gets_at_entries_of_module_cache |= gets_at_entries;
        let is_handed_on = match mention_use {
            MentionUse::Inspected
            | MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Aliased => false,
            MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => true,
        };
        self.output.loses_sight_of_module_cache |= is_handed_on;
        self.output.hands_module_cache_on |= is_handed_on;
    }
}
