//! Output that repeats earlier output.
use alloc::vec::Vec;
use core::cell::Cell;
use core::mem::MaybeUninit;
use core::slice;

type Byte = Cell<MaybeUninit<u8>>;
type Chunks<const N: usize, const K: usize> = [Cell<MaybeUninit<[u8; N]>>; K];

#[inline(always)]
fn set<const N: usize>(to: &[Byte; N], bytes: [MaybeUninit<u8>; N]) {
    for (i, to) in to.iter().enumerate() {
        to.set(bytes[i]);
    }
}

/// Writes to the spare capacity of a `Vec`, which has the bytes once this is dropped.
pub struct Appender<'a> {
    vec: &'a mut Vec<u8>,
    all: &'a [Byte],
    /// The end of `all`. What is before it is initialized.
    rest: &'a [Byte],
    /// The length of `vec` if `rest` is empty.
    full_len: usize,
}

impl<'a> Appender<'a> {
    /// Sees up to `history` bytes of `vec`, and writes up to `room`.
    #[inline(always)]
    pub fn new(vec: &'a mut Vec<u8>, history: usize, room: usize) -> Self {
        let (history, room) = (history.min(vec.len()), room.min(vec.capacity() - vec.len()));
        let start = vec.as_mut_ptr().wrapping_add(vec.len() - history);
        // SAFETY: this is in the allocation, and nothing else gets at it while `vec` is borrowed.
        let all = unsafe { slice::from_raw_parts(start.cast(), history + room) };
        let (rest, full_len) = (&all[history..], vec.len() + room);
        Self {
            vec,
            all,
            rest,
            full_len,
        }
    }

    #[inline(always)]
    pub fn room(&self) -> usize {
        self.rest.len()
    }

    /// From the start of the history.
    #[inline(always)]
    pub fn position(&self) -> usize {
        self.all.len() - self.rest.len()
    }

    /// Where the next byte goes.
    #[inline(always)]
    pub fn as_ptr(&self) -> *const u8 {
        self.rest.as_ptr().cast()
    }

    /// The first `count` of `bytes`, if there is room for all.
    #[inline(always)]
    pub fn push<const N: usize>(&mut self, bytes: [u8; N], count: usize) {
        if let Some(to) = self.rest.first_chunk() {
            set(to, bytes.map(MaybeUninit::new));
            self.rest = &self.rest[count.min(N)..];
        }
    }

    /// `chunk` every `step` bytes, to cover `count`. `false` if `K` chunks do not fit.
    #[inline(always)]
    pub fn push_every<const N: usize, const K: usize>(
        &mut self,
        step: usize,
        chunk: [u8; N],
        count: usize,
    ) -> bool {
        let Some(to) = self.rest.as_chunks::<N>().0.first_chunk::<K>() else {
            return false;
        };
        let (mut at, count) = (0, count.min((K - 1) * N + 1));
        #[rustc_unroll(never)]
        while at < count {
            let to = to.as_flattened()[at..].first_chunk().unwrap();
            set(to, chunk.map(MaybeUninit::new));
            at += step.clamp(1, N);
        }
        self.rest = &self.rest[count..];
        true
    }

    /// `K` chunks from the end on, and as many from `distance` before it on.
    #[inline(always)]
    fn spans<const N: usize, const K: usize>(
        &self,
        distance: usize,
    ) -> Option<[&'a Chunks<N, K>; 2]> {
        const { assert!(size_of::<Chunks<N, K>>() == N * K && align_of::<Chunks<N, K>>() == 1) };
        let to = self.rest.as_chunks::<N>().0.first_chunk::<K>()?;
        if distance.wrapping_sub(1) >= self.position() {
            return None;
        }
        let from = self.all.as_ptr().with_addr(self.as_ptr().addr() - distance);
        // SAFETY: the layouts are alike. `from` starts in `all` and before `to`, so it ends first.
        Some(unsafe { [&*to.as_ptr().cast(), &*from.cast()] })
    }

    /// The bytes from `distance` before the end on, then zeros. `None` without room for as many.
    #[inline(always)]
    pub fn peek<const N: usize>(&self, distance: usize) -> Option<[u8; N]> {
        let [[to], [from]] = self.spans::<N, 1>(distance)?;
        to.set(MaybeUninit::new([0; N]));
        // SAFETY: each byte is before `rest` or in `to`.
        Some(unsafe { from.get().assume_init() })
    }

    /// Repeats `count` bytes from `distance` back. `false` if a chunk needs itself or `K` do not fit.
    #[inline(always)]
    pub fn push_again<const N: usize, const K: usize>(
        &mut self,
        distance: usize,
        count: usize,
        mut before_chunk: impl FnMut(usize),
    ) -> bool {
        let Some([to, from]) = self.spans::<N, K>(distance) else {
            return false;
        };
        if distance < count.min(N) {
            return false;
        }
        to[0].set(from[0].get());
        for at in (N..K * N).step_by(N) {
            if at >= count {
                break;
            }
            before_chunk(at / N);
            to[at / N].set(from[at / N].get());
        }
        self.rest = &self.rest[count.min(K * N)..];
        true
    }
}

impl Drop for Appender<'_> {
    #[inline(always)]
    fn drop(&mut self) {
        // SAFETY: what is before `rest` is initialized.
        unsafe { self.vec.set_len(self.full_len - self.rest.len()) }
    }
}
