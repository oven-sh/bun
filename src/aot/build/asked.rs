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

pub(crate) enum Tape {
    Off,
    Written(Vec<Said>),
    Read(Vec<Said>, usize),
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
pub(crate) struct KeptForTask {
    said_of_functions: FxHashMap<(FileId, FnId), Rc<[Said]>>,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn kept_for_task(&mut self) -> &mut KeptForTask {
        if !self.c.translator.as_ref().is_some_and(|kept| kept.is::<KeptForTask>()) {
            self.c.translator = Some(Box::<KeptForTask>::default());
        }
        self.c.translator.as_mut().and_then(|kept| kept.downcast_mut()).expect("it was put there above")
    }

    fn shares_with_other_tasks(&self) -> bool {
        self.file != NO_FILE && !self.c.is_warming_up()
    }

    pub(super) fn ask<T: Answer>(&mut self, question: impl FnOnce(&mut Checker<'p, 's>) -> T) -> T {
        if let Tape::Read(said, at) = &mut self.tape {
            let answer = said.get(*at).copied().and_then(T::of);
            *at += 1;
            if let Some(answer) = answer {
                return answer;
            }
        }
        let answer = question(&mut *self.c);
        if let Tape::Written(said) = &mut self.tape {
            said.push(answer.said());
        }
        answer
    }

    pub(super) fn declare_function_of_another_file(&mut self, file: FileId, func: FnId, class: Option<(FileId, ClassId)>) -> FuncId {
        let (shared, shares, knows_uses) = (self.shared, self.shares_with_other_tasks(), self.c.knows_uses_of_functions());
        let known: Option<Vec<Said>> = match shared.said_of_functions.get_ref(&(file, func, knows_uses)).filter(|_| shares) {
            Some(said) => Some(said.to_vec()),
            None => self.kept_for_task().said_of_functions.get(&(file, func)).map(|said| said.to_vec()),
        };
        let tape = match known {
            Some(said) => Tape::Read(said, 0),
            None => Tape::Written(Vec::new()),
        };
        let around = std::mem::replace(&mut self.tape, tape);
        let id = self.declare_function_anew(file, func, class);
        if let Tape::Written(said) = std::mem::replace(&mut self.tape, around) {
            let mentions_published_types_alone = said.iter().all(|said| match *said {
                Said::Type(Some(ty)) | Said::TypeAndFlag(ty, _) => !ty.is_local(),
                _ => true,
            });
            if mentions_published_types_alone && shares && !self.c.has_answers_that_depend_on_order() {
                shared.said_of_functions.insert_ref((file, func, knows_uses), said.into_boxed_slice());
            } else {
                self.kept_for_task().said_of_functions.insert((file, func), said.into());
            }
        }
        id
    }
}
