use core::sync::atomic::{AtomicU32, Ordering};

use bun_sema::check::aot::{ObjectOrigin, TypeIdentity};
use bun_sema::local::MaybeLocal;
use bun_sema::program::FileId;
use bun_sema::types::TypeId;
use bun_sema::util::ShardedMap;
use bun_threading::Guarded;
use rustc_hash::FxHashMap;

use crate::ir::LayoutKey;

// What a file says of the fields of a type is the same in every file that is checked, and the same in every file that is not.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ObjectTypeKey {
    pub origin: ObjectOrigin,
    pub identity: TypeIdentity,
    pub is_checked: bool,
}

// How far a type is from the code of a file: the code mentions a type of level 0, and the fields of a type name types of the next level.
pub(super) const LAST_DEFINITION_LEVEL: u8 = 1;
const LEVEL_COUNT: usize = LAST_DEFINITION_LEVEL as usize + 1;
// Beside the level of a definition: every file sees alike what the fields of the type name.
pub(super) const NAMES_THE_SAME_IN_EVERY_FILE: u8 = 1 << 7;
// Beside the level of a definition: the type is declared in a file of the program.
pub(super) const HAS_PLACE: u8 = 1 << 6;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct DefinedObjectType {
    names: TypeIdentity,
    ty: ObjectTypeKey,
}

impl DefinedObjectType {
    // `None`: the layout has a home, which defines it.
    pub fn new(layout: LayoutKey, ty: ObjectTypeKey) -> Option<DefinedObjectType> {
        match layout {
            LayoutKey::ObjectType {
                origin: ObjectOrigin::Computed,
                instantiation,
            } => Some(DefinedObjectType {
                names: instantiation,
                ty,
            }),
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct DefinedObjectTypes {
    first_definers: ShardedMap<DefinedObjectType, FirstDefiners>,
    first_definers_of_layouts: ShardedMap<TypeIdentity, AtomicU32>,
    first_placed_definers_of_layouts: ShardedMap<TypeIdentity, AtomicU32>,
    names_of_types: ShardedMap<TypeId, NamesOfObjectType>,
    names_of_files: Guarded<FxHashMap<FileId, Vec<(TypeId, NamesOfObjectType)>>>,
    #[cfg(test)]
    late_answers: late_answers::Choice,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct NamesOfObjectType {
    pub identity: TypeIdentity,
    pub is_empty: bool,
    // Which of the names the type requires, and which are methods.
    pub flags: TypeIdentity,
}

struct FirstDefiners {
    by_level: [AtomicU32; LEVEL_COUNT],
    // Among the definers below the last level, where the fields name the same in every file.
    gone_on_for_all: AtomicU32,
}

impl DefinedObjectTypes {
    pub(super) fn find_names(&self, ty: TypeId) -> Option<NamesOfObjectType> {
        self.names_of_types.get_ref(&ty).copied()
    }

    pub(super) fn hold_names_of_file(&self, file: FileId, names: Vec<(TypeId, NamesOfObjectType)>) {
        self.names_of_files.lock().insert(file, names);
    }

    pub fn publish_names_of_file(&self, file: FileId) {
        let names = self.names_of_files.lock().remove(&file);
        for (ty, names) in names.into_iter().flatten() {
            // Another task has another type under the number of a type that one task alone knows.
            if !ty.is_local() {
                self.names_of_types.insert_ref(ty, names);
            }
        }
    }

    pub fn add_definition(&self, ty: DefinedObjectType, level: u8, definer: FileId) {
        let add_definer_of_layout = |first_definers: &ShardedMap<TypeIdentity, AtomicU32>| {
            let first_definer = match first_definers.get_ref(&ty.names) {
                Some(first_definer) => first_definer,
                None => first_definers.insert_ref(ty.names, AtomicU32::new(u32::MAX)),
            };
            first_definer.fetch_min(definer.0, Ordering::Relaxed);
        };
        add_definer_of_layout(&self.first_definers_of_layouts);
        if level & HAS_PLACE != 0 {
            add_definer_of_layout(&self.first_placed_definers_of_layouts);
        }
        let first_definers = match self.first_definers.get_ref(&ty) {
            Some(first_definers) => first_definers,
            None => {
                let nobody = FirstDefiners {
                    by_level: [const { AtomicU32::new(u32::MAX) }; LEVEL_COUNT],
                    gone_on_for_all: AtomicU32::new(u32::MAX),
                };
                self.first_definers.insert_ref(ty, nobody)
            }
        };
        let names_the_same = level & NAMES_THE_SAME_IN_EVERY_FILE != 0;
        let level = level & !(NAMES_THE_SAME_IN_EVERY_FILE | HAS_PLACE);
        first_definers.by_level[level as usize].fetch_min(definer.0, Ordering::Relaxed);
        if names_the_same && level < LAST_DEFINITION_LEVEL {
            first_definers
                .gone_on_for_all
                .fetch_min(definer.0, Ordering::Relaxed);
        }
    }

    pub(in crate::lower) fn is_defined_by_earlier_file(
        &self,
        ty: &DefinedObjectType,
        file: FileId,
    ) -> bool {
        #[cfg(test)]
        if self.late_answers.is_late(ty, file) {
            return false;
        }
        let Some(first_definers) = self.first_definers.get_ref(ty) else {
            return false;
        };
        let mut first_definers = first_definers.by_level.iter();
        first_definers.any(|first_definer| first_definer.load(Ordering::Relaxed) < file.0)
    }

    pub(in crate::lower) fn is_layout_defined_by_earlier_file(
        &self,
        layout: LayoutKey,
        file: FileId,
        with_place: bool,
    ) -> bool {
        let LayoutKey::ObjectType {
            origin: ObjectOrigin::Computed,
            instantiation,
        } = layout
        else {
            return false;
        };
        let first_definers = match with_place {
            true => &self.first_placed_definers_of_layouts,
            false => &self.first_definers_of_layouts,
        };
        let first_definer = first_definers.get_ref(&instantiation);
        first_definer.is_some_and(|first| first.load(Ordering::Relaxed) < file.0)
    }

    pub(in crate::lower) fn has_earlier_file_gone_on_for_all(
        &self,
        ty: &DefinedObjectType,
        file: FileId,
    ) -> bool {
        #[cfg(test)]
        if self.late_answers.is_late(ty, file) {
            return false;
        }
        let first_definers = self.first_definers.get_ref(ty);
        first_definers.is_some_and(|first| first.gone_on_for_all.load(Ordering::Relaxed) < file.0)
    }
}

// In a build with many threads an earlier file may become known too late for any of the questions about it.
#[cfg(test)]
pub(crate) mod late_answers {
    use core::cell::Cell;
    use core::hash::BuildHasher;

    use super::{DefinedObjectType, FileId};

    pub(crate) const NONE: u64 = 0;
    pub(crate) const ALL: u64 = u64::MAX;

    thread_local! {
        static CHOICE: Cell<u64> = const { Cell::new(NONE) };
    }

    // Any other number: about half of the answers, another half for each number. It holds for the builds that this thread starts in `run`.
    pub(crate) fn with_choice<R>(choice: u64, run: impl FnOnce() -> R) -> R {
        let outer = CHOICE.replace(choice);
        let result = run();
        CHOICE.set(outer);
        result
    }

    pub(super) struct Choice(u64);

    impl Default for Choice {
        fn default() -> Choice {
            Choice(CHOICE.get())
        }
    }

    impl Choice {
        pub(super) fn is_late(&self, ty: &DefinedObjectType, file: FileId) -> bool {
            match self.0 {
                NONE => false,
                ALL => true,
                choice => rustc_hash::FxBuildHasher.hash_one((choice, ty, file)) & (1 << 40) != 0,
            }
        }
    }
}

#[cfg(test)]
mod tests;
