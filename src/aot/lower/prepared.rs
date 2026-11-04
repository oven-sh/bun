use std::collections::hash_map::Entry;

use bun_sema::program::FileId;
use bun_threading::{Condvar, Guarded};
use rustc_hash::FxHashMap;

use super::scope::ScopeAnalysis;
use super::transpiled::TranspiledFile;
use crate::diagnostics::DiagnosticBuffer;

/// What the lowering of a file starts from and no checker is asked for.
pub(super) struct PreparedFile {
    pub(super) transpiled: Option<TranspiledFile>,
    pub(super) diagnostics: DiagnosticBuffer,
    pub(super) scopes: Option<ScopeAnalysis>,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<PreparedFile>();

enum Preparation {
    NotBegun,
    InProgress,
    Done(Box<PreparedFile>),
    LeftToTheVisit,
}

struct State {
    preparation: Preparation,
    is_being_lowered: bool,
}

/// The files that a second thread prepares while the first one checks them.
#[derive(Default)]
pub struct PreparedFiles {
    states: Guarded<FxHashMap<FileId, State>>,
    has_changed: Condvar,
}

impl PreparedFiles {
    /// False: the thread that visits the file has come for it, or another one prepares it.
    pub(super) fn begin(&self, file: FileId) -> bool {
        match self.states.lock().entry(file) {
            Entry::Vacant(entry) => {
                entry.insert(State {
                    preparation: Preparation::InProgress,
                    is_being_lowered: false,
                });
                true
            }
            Entry::Occupied(mut entry) => match entry.get().preparation {
                Preparation::NotBegun => {
                    entry.get_mut().preparation = Preparation::InProgress;
                    true
                }
                Preparation::InProgress | Preparation::Done(_) | Preparation::LeftToTheVisit => {
                    false
                }
            },
        }
    }

    pub(super) fn is_being_lowered(&self, file: FileId) -> bool {
        let states = self.states.lock();
        states.get(&file).is_some_and(|it| it.is_being_lowered)
    }

    pub(super) fn leave_to_the_visit(&self, file: FileId) {
        if let Some(state) = self.states.lock().get_mut(&file) {
            state.preparation = Preparation::LeftToTheVisit;
        }
        self.has_changed.notify_all();
    }

    pub(super) fn finish(&self, file: FileId, prepared: PreparedFile) {
        if let Some(state) = self.states.lock().get_mut(&file) {
            state.preparation = Preparation::Done(Box::new(prepared));
        }
        self.has_changed.notify_all();
    }

    /// The file has no early error.
    pub(super) fn note_lowering(&self, file: FileId) {
        let mut states = self.states.lock();
        let state = states.entry(file).or_insert(State {
            preparation: Preparation::NotBegun,
            is_being_lowered: false,
        });
        state.is_being_lowered = true;
    }

    /// For the thread that visits the file. No other thread reads the file for it once this returns.
    pub(super) fn take(&self, file: FileId) -> Option<PreparedFile> {
        let mut states = self.states.lock();
        loop {
            let state = states.entry(file).or_insert(State {
                preparation: Preparation::NotBegun,
                is_being_lowered: false,
            });
            match core::mem::replace(&mut state.preparation, Preparation::LeftToTheVisit) {
                Preparation::NotBegun | Preparation::LeftToTheVisit => return None,
                Preparation::Done(prepared) => return Some(*prepared),
                Preparation::InProgress => {
                    state.preparation = Preparation::InProgress;
                    self.has_changed.wait_guarded(&mut states);
                }
            }
        }
    }

    pub fn wait_and_drop(&self, file: FileId) {
        drop(self.take(file));
    }
}
