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
pub(crate) enum Said {
    Flag(bool),
    Kinds(u16),
    Type(Option<TypeId>),
    TypeAndFlag(TypeId, bool),
    Integers(Option<(i64, i64)>),
}

pub(crate) enum Tape<'c> {
    Off,
    Written(Vec<Said>),
    ReadShared(&'c [Said], usize),
    ReadLocal(Rc<[Said]>, usize),
}

pub(crate) trait Answer: Copy {
    fn said(self) -> Said;
    fn of(said: Said) -> Option<Self>;
}

impl Answer for bool {
    fn said(self) -> Said {
        Said::Flag(self)
    }
    fn of(said: Said) -> Option<bool> {
        if let Said::Flag(flag) = said { Some(flag) } else { None }
    }
}

impl Answer for u16 {
    fn said(self) -> Said {
        Said::Kinds(self)
    }
    fn of(said: Said) -> Option<u16> {
        if let Said::Kinds(kinds) = said { Some(kinds) } else { None }
    }
}

impl Answer for Option<TypeId> {
    fn said(self) -> Said {
        Said::Type(self)
    }
    fn of(said: Said) -> Option<Option<TypeId>> {
        if let Said::Type(ty) = said { Some(ty) } else { None }
    }
}

impl Answer for (TypeId, bool) {
    fn said(self) -> Said {
        Said::TypeAndFlag(self.0, self.1)
    }
    fn of(said: Said) -> Option<(TypeId, bool)> {
        if let Said::TypeAndFlag(ty, flag) = said { Some((ty, flag)) } else { None }
    }
}

impl Answer for Storage {
    fn said(self) -> Said {
        Said::TypeAndFlag(self.ty, self.starts_undefined)
    }
    fn of(said: Said) -> Option<Storage> {
        if let Said::TypeAndFlag(ty, starts_undefined) = said { Some(Storage { ty, starts_undefined }) } else { None }
    }
}

impl Answer for Option<(i64, i64)> {
    fn said(self) -> Said {
        Said::Integers(self)
    }
    fn of(said: Said) -> Option<Option<(i64, i64)>> {
        if let Said::Integers(integers) = said { Some(integers) } else { None }
    }
}

#[derive(Default)]
pub(crate) struct TaskCache {
    function_facts: FxHashMap<(FileId, FnId), Rc<[Said]>>,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn task_cache(&mut self) -> &mut TaskCache {
        if !self.c.translator.as_ref().is_some_and(|kept| kept.is::<TaskCache>()) {
            self.c.translator = Some(Box::<TaskCache>::default());
        }
        self.c.translator.as_mut().and_then(|kept| kept.downcast_mut()).expect("it was put there above")
    }

    fn shares_across_tasks(&self) -> bool {
        self.file != NO_FILE && !self.c.is_warming_up()
    }

    pub(super) fn query<T: Answer>(&mut self, question: impl FnOnce(&mut Checker<'p, 's>) -> T) -> T {
        let told = match &mut self.tape {
            Tape::ReadShared(said, at) => Some((said.get(*at).copied(), at)),
            Tape::ReadLocal(said, at) => Some((said.get(*at).copied(), at)),
            _ => None,
        };
        if let Some((said, at)) = told {
            *at += 1;
            if let Some(answer) = said.and_then(T::of) {
                return answer;
            }
        }
        let answer = question(&mut *self.c);
        if let Tape::Written(said) = &mut self.tape {
            said.push(answer.said());
        }
        answer
    }

    pub(super) fn declare_imported_function(&mut self, file: FileId, func: FnId, class: Option<(FileId, ClassId)>) -> FuncId {
        let (shared, shares, knows_uses) = (self.shared, self.shares_across_tasks(), self.c.has_merged_function_uses());
        let tape = match shared.function_facts.get_ref(&(file, func, knows_uses)).filter(|_| shares) {
            Some(said) => Tape::ReadShared(said, 0),
            None => match self.task_cache().function_facts.get(&(file, func)) {
                Some(said) => Tape::ReadLocal(Rc::clone(said), 0),
                None => Tape::Written(Vec::new()),
            },
        };
        let around = std::mem::replace(&mut self.tape, tape);
        let id = self.redeclare_function(file, func, class);
        if let Tape::Written(said) = std::mem::replace(&mut self.tape, around) {
            let references_only_published_types = said.iter().all(|said| match *said {
                Said::Type(Some(ty)) | Said::TypeAndFlag(ty, _) => !ty.is_local(),
                _ => true,
            });
            if references_only_published_types && shares && !self.c.has_order_dependent_results() {
                shared.function_facts.insert_ref((file, func, knows_uses), said.into_boxed_slice());
            } else {
                self.task_cache().function_facts.insert((file, func), said.into());
            }
        }
        id
    }
}
