use bun_sema::program::FileId;

struct Importer {
    file: FileId,
    index: u32,
    ancestor_index_of_importer: u32,
}

struct HoldUp {
    ahead: usize,
    until_end_of: u32,
}

#[derive(Copy, Clone, Default)]
struct Marks {
    index_on_stack: u32,
    /// What was passed runs no later than the importer it was passed in.
    load_that_passed: u32,
}

/// What `JSC::EvaluationAheadOfLink` does at run time, for a load that finds nothing loaded.
#[derive(Default)]
pub(super) struct EvaluationAheadOfLink {
    path: Vec<Importer>,
    stack: Vec<FileId>,
    marks: Vec<Marks>,
    last_index: u32,
    ancestor_index: u32,
    ahead: Vec<FileId>,
    taken: usize,
    hold_up: Option<HoldUp>,
    pub(super) is_below_deferred_import: bool,
    load: u32,
}

impl EvaluationAheadOfLink {
    pub(super) fn begin(&mut self, file_count: usize) {
        self.marks.resize(file_count, Marks::default());
        for file in self.stack.drain(..) {
            self.marks[file.idx()].index_on_stack = 0;
        }
        self.path.clear();
        self.ahead.clear();
        (self.last_index, self.ancestor_index) = (0, u32::MAX);
        (self.taken, self.hold_up) = (0, None);
        self.is_below_deferred_import = false;
        self.load += 1;
    }

    pub(super) fn enter(&mut self, file: FileId) {
        self.last_index += 1;
        let index = self.last_index;
        self.stack.push(file);
        self.marks[file.idx()].index_on_stack = index;
        self.path.push(Importer {
            file,
            index,
            ancestor_index_of_importer: core::mem::replace(&mut self.ancestor_index, index),
        });
    }

    pub(super) fn leave(&mut self) {
        let left = self.path.pop().expect("a module was entered");
        if self.ancestor_index < left.index {
            let hold_up = self.hold_up.get_or_insert(HoldUp {
                ahead: self.ahead.len(),
                until_end_of: u32::MAX,
            });
            hold_up.until_end_of = hold_up.until_end_of.min(self.ancestor_index);
        } else {
            self.hold_up.take_if(|it| left.index <= it.until_end_of);
            while let Some(member) = self.stack.pop() {
                self.marks[member.idx()].index_on_stack = 0;
                if member == left.file {
                    break;
                }
                if !self.is_below_deferred_import {
                    self.marks[member.idx()].load_that_passed = self.load;
                }
            }
        }
        self.ancestor_index = self.ancestor_index.min(left.ancestor_index_of_importer);
    }

    pub(super) fn come_back_to(&mut self, file: FileId) {
        let index = self.marks[file.idx()].index_on_stack;
        if index != 0 {
            self.ancestor_index = self.ancestor_index.min(index);
        }
    }

    pub(super) fn count_modules_ahead(&self) -> usize {
        self.ahead.len()
    }

    pub(super) fn pass_import(&mut self, file: FileId, modules_ahead_of_it: usize) {
        let marks = &mut self.marks[file.idx()];
        if self.is_below_deferred_import || marks.index_on_stack != 0 {
            return;
        }
        let load = core::mem::replace(&mut marks.load_that_passed, self.load);
        if load == self.load || self.hold_up.is_some() {
            return;
        }
        self.ahead.truncate(modules_ahead_of_it);
        self.taken = self.taken.min(modules_ahead_of_it);
        self.ahead.push(file);
    }

    /// The modules that run before the CommonJS file that the walk has come to.
    pub(super) fn take_modules_ahead(&mut self) -> &[FileId] {
        let ahead = (self.hold_up.as_ref()).map_or(self.ahead.len(), |hold_up| hold_up.ahead);
        let first = core::mem::replace(&mut self.taken, ahead);
        &self.ahead[first..ahead]
    }
}
