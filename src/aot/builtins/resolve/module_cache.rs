//! What a file does with the table of loaded modules, `require.cache` and `Module._cache`: which entries it takes out, and whether the table goes
//! where somebody else may take one out. Whoever reads the table takes nothing out. And whether the file gets at what an entry holds.

use super::mention_use::MentionUse;
use super::mentions::mentioned_id;
use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::Parent;
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey, StmtKind};

/// `delete require.cache[key]`, `require.cache[key] = undefined`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KeyOfModuleCache {
    Text(Atom),
    Computed(ExprId),
}

enum Listed {
    Keys,
    Entries,
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
    fn find_what_is_listed(&self, table: ExprId) -> Option<Listed> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = table;
        loop {
            let parent = match bound.parent_of_expr(node) {
                Parent::Expr(parent) => parent,
                Parent::Stmt(statement) => {
                    let is_walked = matches!(hir[statement].kind, StmtKind::ForIn { .. });
                    return is_walked.then_some(Listed::Keys);
                }
                _ => return None,
            };
            match hir[parent].kind {
                _ if hir.type_assertion_operand(parent) == Some(node) => {}
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    ..
                } => {}
                ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(node) => {
                    let callee = hir.skip_type_assertions(hir[call].callee);
                    return match mentioned_id(self.state(callee)).map(table::canonical_id)? {
                        BuiltinId::ObjectKeys
                        | BuiltinId::ObjectGetOwnPropertyNames
                        | BuiltinId::ReflectOwnKeys => Some(Listed::Keys),
                        BuiltinId::ObjectValues | BuiltinId::ObjectEntries => Some(Listed::Entries),
                        _ => None,
                    };
                }
                _ => return None,
            }
            node = parent;
        }
    }

    // Native code gets the value, or a function of this file does.
    fn is_operand_of_call(&self, e: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = e;
        while let Parent::Expr(parent) = bound.parent_of_expr(node) {
            match hir[parent].kind {
                _ if hir.type_assertion_operand(parent) == Some(node) => {}
                ExprKind::Call(call) | ExprKind::New(call) => return hir[call].callee != node,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                }
                | ExprKind::Cond { .. } => {}
                _ => return false,
            }
            node = parent;
        }
        false
    }

    // `value === plugin`: whoever reads the result learns whether it is an object that he has, and looks for no member of it.
    fn is_compared_by_identity(&self, e: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = e;
        while let Parent::Expr(parent) = bound.parent_of_expr(node)
            && hir.type_assertion_operand(parent) == Some(node)
        {
            node = parent;
        }
        matches!(
            bound.parent_of_expr(node),
            Parent::Expr(parent) if matches!(
                hir[parent].kind,
                ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, .. }
            )
        )
    }

    // `require.cache[key].exports === plugin`, `if (require.cache[key])`: the file learns whether the entry is there and whether it exports a value that the
    // file has already. It reads no export, and stores nothing in the entry.
    fn is_entry_only_compared(&self, entry: ExprId) -> bool {
        let hir = self.input.hir;
        if self.is_compared_by_identity(entry) || self.is_only_tested(entry) {
            return true;
        }
        let Some(member) = self.find_member_of(entry) else {
            return false;
        };
        matches!(hir.member_key(member), Some((_, MemberKey::Name(name))) if name == known::exports)
            && !self.is_deleted(member)
            && !self.is_stored_to(member)
            && self.is_compared_by_identity(member)
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
                self.output.gets_at_entries_of_module_cache = true;
            } else if !self.is_entry_only_compared(entry) {
                self.output.gets_at_entries_of_module_cache = true;
                self.output.reads_entries_of_module_cache = true;
            }
            return;
        }
        let listed = self.find_what_is_listed(table);
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
        let gets_at_entries = match (&listed, &mention_use) {
            (Some(Listed::Keys), _) | (None, MentionUse::Aliased) => false,
            (None, &MentionUse::StoredInto(symbol)) => !self.holds(symbol, id),
            // `key in require.cache`, `if (require.cache)`. `Object.defineProperty(require.cache, key, entry)` stores an entry.
            (None, MentionUse::Inspected | MentionUse::SearchedFor(_)) => {
                self.is_operand_of_call(table)
            }
            _ => true,
        };
        self.output.gets_at_entries_of_module_cache |= gets_at_entries;
        self.output.reads_entries_of_module_cache |= gets_at_entries;
        let is_handed_on = match mention_use {
            MentionUse::Inspected
            | MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Aliased
            | MentionUse::SearchedFor(_)
            | MentionUse::SearchedForKeysOf(_) => false,
            MentionUse::StoredInto(symbol) => !self.holds(symbol, id),
            MentionUse::Called(_) | MentionUse::Destructured(_) | MentionUse::Exposed => {
                listed.is_none()
            }
        };
        self.output.hands_module_cache_on |= is_handed_on;
        self.output.loses_sight_of_module_cache |= is_handed_on;
    }
}
