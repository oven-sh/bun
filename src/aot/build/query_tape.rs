use super::FileBuild;
use crate::fragment::NO_FILE;
use crate::id::FuncId;
use bun_sema::check::{Checker, Storage};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::local::MaybeLocal;
use bun_sema::program::FileId;
use bun_sema::types::TypeId;
use rustc_hash::FxHashMap;
use std::rc::Rc;

#[derive(Copy, Clone)]
pub(crate) enum RecordedAnswer {
    Flag(bool),
    Kinds(u16),
    Type(Option<TypeId>),
    TypeAndFlag(TypeId, bool),
    Integers(Option<(i64, i64)>),
}

pub(crate) enum Tape<'c> {
    Off,
    Written(Vec<RecordedAnswer>),
    ReadShared(&'c [RecordedAnswer], usize),
    ReadLocal(Rc<[RecordedAnswer]>, usize),
}

pub(crate) trait Recordable: Copy {
    fn recorded(self) -> RecordedAnswer;
    fn from_recorded(recorded: RecordedAnswer) -> Option<Self>;
}

impl Recordable for bool {
    fn recorded(self) -> RecordedAnswer {
        RecordedAnswer::Flag(self)
    }
    fn from_recorded(recorded: RecordedAnswer) -> Option<bool> {
        if let RecordedAnswer::Flag(flag) = recorded { Some(flag) } else { None }
    }
}

impl Recordable for u16 {
    fn recorded(self) -> RecordedAnswer {
        RecordedAnswer::Kinds(self)
    }
    fn from_recorded(recorded: RecordedAnswer) -> Option<u16> {
        if let RecordedAnswer::Kinds(kinds) = recorded { Some(kinds) } else { None }
    }
}

impl Recordable for Option<TypeId> {
    fn recorded(self) -> RecordedAnswer {
        RecordedAnswer::Type(self)
    }
    fn from_recorded(recorded: RecordedAnswer) -> Option<Option<TypeId>> {
        if let RecordedAnswer::Type(ty) = recorded { Some(ty) } else { None }
    }
}

impl Recordable for (TypeId, bool) {
    fn recorded(self) -> RecordedAnswer {
        RecordedAnswer::TypeAndFlag(self.0, self.1)
    }
    fn from_recorded(recorded: RecordedAnswer) -> Option<(TypeId, bool)> {
        if let RecordedAnswer::TypeAndFlag(ty, flag) = recorded { Some((ty, flag)) } else { None }
    }
}

impl Recordable for Storage {
    fn recorded(self) -> RecordedAnswer {
        RecordedAnswer::TypeAndFlag(self.ty, self.starts_undefined)
    }
    fn from_recorded(recorded: RecordedAnswer) -> Option<Storage> {
        if let RecordedAnswer::TypeAndFlag(ty, starts_undefined) = recorded { Some(Storage { ty, starts_undefined }) } else { None }
    }
}

impl Recordable for Option<(i64, i64)> {
    fn recorded(self) -> RecordedAnswer {
        RecordedAnswer::Integers(self)
    }
    fn from_recorded(recorded: RecordedAnswer) -> Option<Option<(i64, i64)>> {
        if let RecordedAnswer::Integers(integers) = recorded { Some(integers) } else { None }
    }
}

#[derive(Default)]
pub(crate) struct TaskCache {
    function_facts: FxHashMap<(FileId, FnId), Rc<[RecordedAnswer]>>,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn task_cache(&mut self) -> &mut TaskCache {
        if !self.c.translator.as_ref().is_some_and(|retained| retained.is::<TaskCache>()) {
            self.c.translator = Some(Box::<TaskCache>::default());
        }
        self.c.translator.as_mut().and_then(|retained| retained.downcast_mut()).expect("it was put there above")
    }

    fn shares_across_tasks(&self) -> bool {
        self.file != NO_FILE && !self.c.is_warming_up()
    }

    pub(super) fn query<T: Recordable>(&mut self, question: impl FnOnce(&mut Checker<'p, 's>) -> T) -> T {
        let told = match &mut self.tape {
            Tape::ReadShared(recorded, at) => Some((recorded.get(*at).copied(), at)),
            Tape::ReadLocal(recorded, at) => Some((recorded.get(*at).copied(), at)),
            _ => None,
        };
        if let Some((recorded, at)) = told {
            *at += 1;
            if let Some(answer) = recorded.and_then(T::from_recorded) {
                return answer;
            }
        }
        let answer = question(&mut *self.c);
        if let Tape::Written(recorded) = &mut self.tape {
            recorded.push(answer.recorded());
        }
        answer
    }

    pub(super) fn declare_imported_function(&mut self, file: FileId, func: FnId, class: Option<(FileId, ClassId)>) -> FuncId {
        let (shared, shares, knows_uses) = (self.shared, self.shares_across_tasks(), self.c.has_merged_function_uses());
        let tape = match shared.function_facts.get_ref(&(file, func, knows_uses)).filter(|_| shares) {
            Some(recorded) => Tape::ReadShared(recorded, 0),
            None => match self.task_cache().function_facts.get(&(file, func)) {
                Some(recorded) => Tape::ReadLocal(Rc::clone(recorded), 0),
                None => Tape::Written(Vec::new()),
            },
        };
        let around = std::mem::replace(&mut self.tape, tape);
        let id = self.redeclare_function(file, func, class);
        if let Tape::Written(recorded) = std::mem::replace(&mut self.tape, around) {
            let references_only_published_types = recorded.iter().all(|recorded| match *recorded {
                RecordedAnswer::Type(Some(ty)) | RecordedAnswer::TypeAndFlag(ty, _) => !ty.is_local(),
                _ => true,
            });
            if references_only_published_types && shares && !self.c.has_order_dependent_results() {
                shared.function_facts.insert_ref((file, func, knows_uses), recorded.into_boxed_slice());
            } else {
                self.task_cache().function_facts.insert((file, func), recorded.into());
            }
        }
        id
    }
}
