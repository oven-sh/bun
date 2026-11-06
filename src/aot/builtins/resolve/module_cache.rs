//! What a file does with the table of loaded modules, `require.cache` and `Module._cache`: which entries it takes out, and whether the table goes
//! where somebody else may take one out. Whoever reads the table takes nothing out.

use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId};
use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey, StmtKind};

/// `delete require.cache[key]`, `require.cache[key] = undefined`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KeyOfModuleCache {
    Text(Atom),
    Computed(ExprId),
}

pub(super) fn is_module_cache(id: BuiltinId) -> bool {
    let tables = [
        BuiltinId::ModuleRequireCache,
        BuiltinId::ModuleRequirePrototypeCache,
        BuiltinId::NodeModule_cache,
    ];
    (tables.map(table::canonical_id)).contains(&table::canonical_id(id))
}

pub(super) fn is_table_of_loaders(id: BuiltinId) -> bool {
    let tables = [
        BuiltinId::ModuleRequireExtensions,
        BuiltinId::ModuleRequirePrototypeExtensions,
        BuiltinId::NodeModule_extensions,
    ];
    (tables.map(table::canonical_id)).contains(&table::canonical_id(id))
}

impl Resolver<'_, '_> {
    /// `require.extensions[".js"] = loader`: the next `require()` of such a file hands it to the loader, as if the file had been taken out of the table of
    /// loaded modules. Whoever reads a loader changes none.
    pub(super) fn note_use_of_table_of_loaders(&mut self, table: ExprId, id: BuiltinId) {
        self.output.loses_sight_of_module_cache |= match self.find_member_of(table) {
            Some(loader) => self.is_deleted(loader) || self.is_stored_to(loader),
            None => match self.classify_use(table) {
                MentionUse::Inspected
                | MentionUse::Holder
                | MentionUse::ReadByComputedKey
                | MentionUse::Aliased
                | MentionUse::SearchedFor(_)
                | MentionUse::SearchedForKeysOf(_) => false,
                MentionUse::StoredInto(symbol) => !self.holds(symbol, id),
                MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => true,
            },
        };
    }

    // `Object.values(require.cache ?? {})`, `for (const path in require.cache)`
    fn is_only_listed(&self, table: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = table;
        loop {
            let parent = match bound.parent_of_expr(node) {
                Parent::Expr(parent) => parent,
                Parent::Stmt(statement) => {
                    return matches!(hir[statement].kind, StmtKind::ForIn { .. });
                }
                _ => return false,
            };
            match hir[parent].kind {
                _ if hir.type_assertion_operand(parent) == Some(node) => {}
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    ..
                } => {}
                ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(node) => {
                    let callee = hir.skip_type_assertions(hir[call].callee);
                    return matches!(
                        mentioned_id(self.state(callee)).map(table::canonical_id),
                        Some(BuiltinId::ObjectValues | BuiltinId::ObjectEntries)
                    );
                }
                _ => return false,
            }
            node = parent;
        }
    }

    // `Reflect.deleteProperty(require.cache, key)`
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

    // `require.cache[key] = undefined`, `[require.cache[key]] = []`, `(require.cache[key] as unknown) &&= null`
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

    /// `table`: an expression that stands for the table, under the id `id`.
    pub(super) fn note_use_of_module_cache(&mut self, table: ExprId, id: BuiltinId) {
        let hir = self.input.hir;
        if let Some(entry) = self.find_member_of(table) {
            // `require()` takes a falsy entry for none, so a store takes the entry out as a deletion does. Whoever reads an entry takes none out.
            let is_stored_to = self.is_stored_to(entry);
            if self.is_deleted(entry) || is_stored_to {
                let key = match hir.member_key(entry) {
                    Some((_, MemberKey::Name(text) | MemberKey::PrivateName(text))) => {
                        KeyOfModuleCache::Text(text)
                    }
                    Some((_, MemberKey::Computed(key))) => KeyOfModuleCache::Computed(key),
                    None => unreachable!("find_member_of answers with an access"),
                };
                self.output.keys_taken_out_of_module_cache.push(key);
                if is_stored_to {
                    self.output.keys_stored_in_module_cache.push(key);
                }
            }
            return;
        }
        if let Some(key) = self.find_key_that_call_deletes(table) {
            let key = match hir.index_member_key(hir.skip_type_assertions(key)) {
                MemberKey::Name(text) | MemberKey::PrivateName(text) => {
                    KeyOfModuleCache::Text(text)
                }
                MemberKey::Computed(key) => KeyOfModuleCache::Computed(key),
            };
            return self.output.keys_taken_out_of_module_cache.push(key);
        }
        let is_handed_on = match self.classify_use(table) {
            MentionUse::Inspected
            | MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Aliased
            | MentionUse::SearchedFor(_)
            | MentionUse::SearchedForKeysOf(_) => false,
            MentionUse::StoredInto(symbol) => !self.holds(symbol, id),
            MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => {
                !self.is_only_listed(table)
            }
        };
        self.output.hands_module_cache_on |= is_handed_on;
        self.output.loses_sight_of_module_cache |= is_handed_on;
    }
}
