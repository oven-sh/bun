#[cfg(test)]
use core::sync::atomic::AtomicU64;
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

// How far a type is from the code of a file: the code mentions a type of level 0, and the fields of a type name types of the
// next level. A file defines the types up to the last level. What the fields of those name stays declared: whoever reads
// its fields mentions it.
pub(super) const LAST_DEFINITION_LEVEL: u8 = 1;
const LEVEL_COUNT: usize = LAST_DEFINITION_LEVEL as usize + 1;
// Beside the level of a definition: every file sees alike what the fields of the type name.
pub(super) const NAMES_THE_SAME_IN_EVERY_FILE: u8 = 1 << 7;
// Beside the level of a definition: the type is declared in a file of the program.
pub(super) const HAS_PLACE: u8 = 1 << 6;

// A type under a layout. The type of a literal has one layout in the file where the literal stands, which knows what the
// literal is written under, and another in the files that only see the type.
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
            LayoutKey::ObjectType { .. }
            | LayoutKey::Class(_)
            | LayoutKey::ConstructorFunction(_)
            | LayoutKey::Library(_)
            | LayoutKey::UntypedLiteral { .. }
            | LayoutKey::Container(_)
            | LayoutKey::TypeParameter(_)
            | LayoutKey::Environment { .. } => None,
        }
    }
}

// The first file, in the order of the files, that has defined each type at each level, among the files that are lowered for
// good. A file keeps no definition of a type that an earlier file has defined: the link keeps the first definition of each
// type. A type of the last level it leaves alone then: it would not go on to what the fields of the type name. The fields of a
// type of an earlier level it computes all the same, because what they name is not the same in every file: where two literals
// stand they are the types that are written, and a file that only sees them sees their normalized union, which is made of
// computed types. A file that left such a type to the file of the literals would never meet what only it sees. So what a file
// meets hangs on the file alone. Which files find an entry in time differs from one build to the next, and the program does
// not: the first file that meets a type finds none and defines it.
// Where every file sees alike what the fields name, a file that has gone on from the type has met all that a later file would
// meet, and has defined it or left it to a file before itself. The later file leaves such a type alone at every level.
#[derive(Default)]
pub struct DefinedObjectTypes {
    first_definers: ShardedMap<DefinedObjectType, FirstDefiners>,
    // The first file that has defined any type under each layout, and the first that has defined one with a place. The link shows
    // a layout under the name of its first definition with a place, and where none has one, of its first.
    first_definers_of_layouts: ShardedMap<TypeIdentity, AtomicU32>,
    first_placed_definers_of_layouts: ShardedMap<TypeIdentity, AtomicU32>,
    names_of_types: ShardedMap<TypeId, NamesOfObjectType>,
    // What each file has worked out and is not yet lowered for good.
    names_of_files: Guarded<FxHashMap<FileId, Vec<(TypeId, NamesOfObjectType)>>>,
}

// What the layout of an object type is known by. It hangs on the listed members of the type alone, so the first file that has
// put them in order and is lowered for good says it for all.
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

    // A file that is lowered again says it again.
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
        let of_layout = match self.first_definers_of_layouts.get_ref(&ty.names) {
            Some(first_definer) => first_definer,
            None => self.first_definers_of_layouts.insert_ref(ty.names, AtomicU32::new(u32::MAX)),
        };
        of_layout.fetch_min(definer.0, Ordering::Relaxed);
        if level & HAS_PLACE != 0 {
            let placed = &self.first_placed_definers_of_layouts;
            let of_layout = match placed.get_ref(&ty.names) {
                Some(first_definer) => first_definer,
                None => placed.insert_ref(ty.names, AtomicU32::new(u32::MAX)),
            };
            of_layout.fetch_min(definer.0, Ordering::Relaxed);
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
            first_definers.gone_on_for_all.fetch_min(definer.0, Ordering::Relaxed);
        }
    }

    pub(in crate::lower) fn is_defined_by_earlier_file(
        &self,
        ty: &DefinedObjectType,
        file: FileId,
    ) -> bool {
        #[cfg(test)]
        if late_answers::is_late(ty, file) {
            return false;
        }
        let Some(first_definers) = self.first_definers.get_ref(ty) else {
            return false;
        };
        let mut first_definers = first_definers.by_level.iter();
        first_definers.any(|first_definer| first_definer.load(Ordering::Relaxed) < file.0)
    }

    // `with_place`: by a definition that has a place.
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
        if late_answers::is_late(ty, file) {
            return false;
        }
        let first_definers = self.first_definers.get_ref(ty);
        first_definers.is_some_and(|first| first.gone_on_for_all.load(Ordering::Relaxed) < file.0)
    }
}

// In a build with many threads an earlier file may become known too late for any of the questions about it. A test says
// which: a test is a process of its own.
#[cfg(test)]
pub(crate) mod late_answers {
    use core::hash::BuildHasher;

    use super::{AtomicU64, DefinedObjectType, FileId, Ordering};

    pub(crate) const NONE: u64 = 0;
    pub(crate) const ALL: u64 = u64::MAX;

    // Any other number: about half of the answers, another half for each number.
    pub(crate) static CHOICE: AtomicU64 = AtomicU64::new(NONE);

    pub(super) fn is_late(ty: &DefinedObjectType, file: FileId) -> bool {
        match CHOICE.load(Ordering::Relaxed) {
            NONE => false,
            ALL => true,
            choice => rustc_hash::FxBuildHasher.hash_one((choice, ty, file)) & (1 << 40) != 0,
        }
    }
}

#[cfg(test)]
mod tests;
