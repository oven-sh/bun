//! What ahead-of-time compilation asks of the types beyond what checking does.

mod classes;
mod flows;
mod identity;
mod integers;
mod javascript;
mod storage;

pub use classes::{ClassFacts, MethodStore, ReplacedMethods};
pub use identity::Identity;
pub use javascript::CodeOfImport;
pub use flows::{AddedOver, BuiltIn, Candidate, Literal, Membership, Noted, Place, Question, Questions, Reach, WhyForeign};
pub use storage::{Evaluates, Primitive, ReferenceRead, Storage};

use super::Checker;
use crate::atom::known;
use crate::hir::ExprsByKind;
use crate::program::FileId;
use crate::types::{TypeData, TypeId};
use std::sync::OnceLock;

/// A table by file. Each entry is made once, by whoever asks for it first, and is only read from then on. What is in it follows from
/// the trees and the symbols alone, so that it does not matter who that is.
struct ByFile<T>(OnceLock<Box<[OnceLock<T>]>>);

impl<T> Default for ByFile<T> {
    fn default() -> ByFile<T> {
        ByFile(OnceLock::new())
    }
}

impl<T> ByFile<T> {
    /// `files`: how many the program has.
    fn get_or_init(&self, files: usize, file: FileId, make: impl FnOnce() -> T) -> &T {
        self.0.get_or_init(|| (0..files).map(|_| OnceLock::new()).collect())[file.idx()].get_or_init(make)
    }
}

/// What holds for every checker of the program, a field for each part of this module that has such. It belongs to the program: it
/// mentions no type, nor anything else that is numbered by task. Each table is made once and is only read from then on. Whoever asks
/// first makes what follows from the trees and the symbols alone. Whoever sets the program up says what is for the bundler to say.
/// What takes types to find is noted file by file, by the task that has them, and put together when no task is running.
#[derive(Default)]
pub(super) struct Shared {
    /// `exprs_by_kind_of`
    exprs_by_kind: ByFile<ExprsByKind>,
    classes: classes::Shared,
    integers: integers::Shared,
    javascript: javascript::Shared,
    storage: storage::Shared,
}

/// What the queries of this module have found so far, a field for each part of it. It belongs to a checker.
#[derive(Default)]
pub(super) struct State {
    flows: flows::State,
    identity: identity::State,
    integers: integers::State,
    javascript: javascript::State,
    storage: storage::State,
}

impl<'p, 's> Checker<'p, 's> {
    /// `exprs_by_kind`, for a file that need not be the one the task is at. That keeps the index of one file. This one stays.
    fn exprs_by_kind_of(&self, file: FileId) -> &'p ExprsByKind {
        let program = self.p;
        program.aot.exprs_by_kind.get_or_init(program.files.modules.len(), file, || ExprsByKind::new(self.hir(file)))
    }

    /// Of an interface that extends `Array` or `ReadonlyArray`, such as `NodeArray<T>`, and of an intersection with an array, a tuple or
    /// such an interface, `number[] & { tag: string }`: the type of the elements. Its objects are arrays that have been given more
    /// properties. Not of a class that extends `Array`, nor of an intersection with one: what such a class makes has another prototype,
    /// where it may find other methods, and the engine does not take it for an array.
    pub fn element_of_array_subtype(&mut self, ty: TypeId) -> Option<TypeId> {
        let is_array = match self.data(ty) {
            TypeData::Ref { .. } => !self.is_array_or_tuple(ty) && !self.is_type_of_instances(ty) && self.is_array_like(ty),
            TypeData::Intersection(parts) => {
                !parts.iter().any(|&part| self.is_type_of_instances(part) && self.is_array_like(part))
                    && parts.iter().any(|&part| self.is_array_or_tuple(part) || self.element_of_array_subtype(part).is_some())
            }
            _ => false,
        };
        if !is_array {
            return None;
        }
        self.index_type_of_type(ty, TypeId::NUMBER)
    }

    /// `any`, `unknown`, `never`, `void`: no value is known for what it is by it.
    /// `{}`, `Object`, an interface without members: a string or a number is one as well. `object` is not meant.
    pub fn admits_primitives(&mut self, ty: TypeId) -> bool {
        ty != TypeId::OBJECT && !matches!(self.data(ty), TypeData::Union(_)) && (self.is_empty_object_type(ty) || ty == self.global_ref(known::Object, &[]))
    }

    pub fn says_nothing(&self, ty: TypeId) -> bool {
        ty.is_any() || ty.is_never() || matches!(ty, TypeId::UNKNOWN | TypeId::VOID | TypeId::UNRESOLVED)
    }
}
