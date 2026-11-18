//! Taking frames off the stack, and putting them back in another place (JavaScript Promise Integration).
//!
//! No register has a value across a call, and the only addresses of the stack in frames are those that chain them.

use core::num::NonZeroUsize;
use core::ptr;

use bun_engine_wasm_compiler::abi::{callee_word, frame};
use bun_engine_wasm_format::FuncIndex;

use crate::call::ExitFrame;
use crate::frames::{Frame, entry_above};
use crate::instance::Instance;
use crate::interpreted::Header;
use crate::value::HostCell;

const WORD: usize = size_of::<usize>();
const BELOW_EXIT: usize = ExitFrame::SIZE as usize;
const HEADER: core::ops::Range<usize> = frame::INSTANCE as usize..frame::ARGUMENTS as usize;

/// From that of the stub which calls the host up to that of the stub which the host has called.
pub struct Frames<'a> {
    exit: usize,
    entry: usize,
    instance: &'a Instance,
    import: FuncIndex,
}

impl<'a> Frames<'a> {
    /// `None` if the host has called without a stub.
    ///
    /// # Safety
    /// `exit` is the frame pointer of a stub for the import, which stays meanwhile.
    pub(crate) unsafe fn above(
        instance: &'a Instance,
        import: FuncIndex,
        exit: usize,
    ) -> Option<Self> {
        // SAFETY: the caller's.
        let (entry, is_of_stub) = unsafe {
            let (fp, return_address) = (entry_above(exit), 0);
            (fp, Frame { fp, return_address }.is_of_entry_stub())
        };
        is_of_stub.then_some(Self {
            exit,
            entry,
            instance,
            import,
        })
    }

    /// The frame pointer of who has called WebAssembly.
    pub fn caller(&self) -> usize {
        // SAFETY: on the stack.
        unsafe { Frame::caller_of(self.entry) }.fp
    }

    pub fn word_count(&self) -> usize {
        if !self.instance.engine().compiles() {
            let records = self.interpreted_frames().count() * Record::WORDS;
            return Saved::PREFIX + records + self.interpreted_values().len() / WORD;
        }
        (self.entry + HEADER.end - (self.exit - BELOW_EXIT)) / WORD
    }

    /// If the call of the host ends with [`crate::Interrupted::Suspended`], the entry returns.
    pub fn save(&self, words: &mut [usize]) {
        assert!(words.len() == self.word_count());
        if !self.instance.engine().compiles() {
            return self.save_interpreted(words);
        }
        let first = ptr::with_exposed_provenance(self.exit - BELOW_EXIT);
        // SAFETY: on the stack.
        unsafe { ptr::copy_nonoverlapping(first, words.as_mut_ptr(), words.len()) };
        // In place of what links the entry to its caller.
        words[words.len() - HEADER.end / WORD] = self.entry;
    }
}

impl Frames<'_> {
    fn header(&self, fp: usize) -> &Header {
        // SAFETY: from the chain.
        unsafe { &*ptr::with_exposed_provenance(fp) }
    }

    /// Without that of the entry.
    fn interpreted_frames(&self) -> impl Iterator<Item = &Header> {
        let caller =
            |&fp: &usize| Some(self.header(fp).caller.get()).filter(|&it| it != self.entry);
        core::iter::successors(Some(self.exit), caller).map(|fp| self.header(fp))
    }

    fn interpreted_values(&self) -> core::ops::Range<usize> {
        self.header(self.entry).slots..self.instance.store().interpreted_values().end
    }

    fn save_interpreted(&self, words: &mut [usize]) {
        let values = self.interpreted_values();
        let (words, for_values) = words.split_at_mut(words.len() - values.len() / WORD);
        let (prefix, records) = words.split_at_mut(Saved::PREFIX);
        let records = records.as_chunks_mut().0;
        for (record, frame) in records.iter_mut().zip(self.interpreted_frames()) {
            *record = [
                frame.instance.get(),
                frame.callee.get() as usize,
                frame.return_address.get(),
                (frame.slots - values.start) / WORD,
            ];
        }
        records[0][1] = callee_word(self.import) as usize;
        // SAFETY: just below the frame of an entry, and slots that are in use.
        unsafe {
            let function = ptr::with_exposed_provenance::<usize>(self.entry - WORD).read();
            prefix.copy_from_slice(&[function, records.len()]);
            let first = ptr::with_exposed_provenance(values.start);
            ptr::copy_nonoverlapping(first, for_values.as_mut_ptr(), for_values.len());
        }
    }
}

/// The instance, the callee, the return address and the first slot of a frame of an interpreter.
#[derive(Clone, Copy)]
pub(crate) struct Record(pub(crate) [usize; Self::WORDS]);

impl Record {
    const WORDS: usize = 4;
}

/// What is saved of the frames of an interpreter.
pub(crate) struct Saved<'a>(&'a [usize]);

impl<'a> Saved<'a> {
    /// The function that the host has called, and the number of records.
    const PREFIX: usize = 2;

    pub(crate) fn new(words: &'a [usize]) -> Self {
        Self(words)
    }

    pub(crate) fn function(&self) -> HostCell {
        HostCell(NonZeroUsize::new(self.0[0]).expect("a cell"))
    }

    pub(crate) fn record_count(&self) -> usize {
        self.0[1]
    }

    /// Counting from the outermost.
    pub(crate) fn record(&self, index: usize) -> Record {
        Record(self.0[Self::PREFIX..].as_chunks().0[self.record_count() - 1 - index])
    }

    pub(crate) fn values(&self) -> &'a [usize] {
        &self.0[Self::PREFIX + self.record_count() * Record::WORDS..]
    }
}

/// How many bytes so many saved words take below the frame pointer of the entry.
pub fn size_below_entry(word_count: usize) -> usize {
    (word_count * WORD).strict_sub(HEADER.end)
}

/// Returns the frame pointer for [`crate::Engine::end_of_host_call_stub`], or from which to unwind.
///
/// # Safety
/// The words are from [`Frames::save`] on this thread, have not been restored, and what they refer to is alive.
/// `entry` is the frame pointer of a stub that the host has called, with that much room below it.
pub unsafe fn restore(words: &[usize], entry: usize) -> usize {
    let (below, rest) = words.split_at(size_below_entry(words.len()) / WORD);
    let distance = entry.wrapping_sub(rest[0]);
    let exit = entry - size_of_val(below) + BELOW_EXIT;
    let at = ptr::with_exposed_provenance_mut::<usize>;
    // SAFETY: the caller's.
    unsafe {
        ptr::copy_nonoverlapping(below.as_ptr(), at(exit - BELOW_EXIT), below.len());
        let header = &rest[HEADER.start / WORD..];
        ptr::copy_nonoverlapping(header.as_ptr(), at(entry + HEADER.start), header.len());
        let mut fp = exit;
        while fp != entry {
            let caller = at(fp).read().wrapping_add(distance);
            at(fp).write(caller);
            fp = caller;
        }
    }
    exit
}
