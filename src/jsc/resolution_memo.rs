//! What a VM has of `bun_resolver::resolution_memo`. `VirtualMachine::resolve_without_on_resolve` reads and fills it.

use bun_core::String;
use bun_resolver::resolution_memo::ResolutionMemo as Memo;
pub(crate) use bun_resolver::resolution_memo::{Kind, Lookup, Slot};

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Use {
    /// Until the first resolution.
    #[default]
    Undecided,
    Off,
    On,
}

/// What to do with the answer of the resolver, once it has run.
#[derive(Clone, Copy)]
pub(crate) enum Ticket {
    None,
    Put(Slot),
    Refresh(Slot),
}

#[derive(Default)]
pub(crate) struct ResolutionMemo {
    pub(crate) r#use: Use,
    pub(crate) answers: Memo,
    /// In builds with assertions: the answer of the last resolver run for a pair, whether `answers` keeps it or not.
    pub(crate) last_answers: Option<Box<Memo>>,
}

impl ResolutionMemo {
    /// An input of this VM's resolver changed that `bun_resolver::resolution_epoch` does not guard.
    pub(crate) fn forget(&mut self) {
        self.answers.forget();
        if let Some(last_answers) = &mut self.last_answers {
            last_answers.forget();
        }
    }
}

/// The string of an answer, without another count of its reference.
#[inline]
pub(crate) fn into_string(answer: bun_core::WTFString) -> String {
    String::adopt_wtf_impl(answer.into_raw())
}
