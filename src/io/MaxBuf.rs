use core::cell::Cell;
use core::ptr::NonNull;

/// Tracks remaining byte budget for a subprocess stdout/stderr pipe.
/// Dual-owned by the `Subprocess` and the pipe reader; freed when both disown it.
///
/// All mutable state is `Cell<T>` so the struct is only ever accessed via
/// `&MaxBuf` (shared, `SharedReadOnly` provenance). This is required because
/// the overflow callback fired from `on_read_bytes` re-enters via a sibling
/// `NonNull<MaxBuf>` and writes `owned_by_subprocess` — a `&mut MaxBuf` on the
/// caller's stack would be a Stacked-Borrows violation. With `Cell` the whole
/// re-entrancy path is `&MaxBuf`-only and the aliasing question disappears.
pub struct MaxBuf {
    /// `false` after subprocess finalize.
    pub owned_by_subprocess: Cell<bool>,
    /// `false` after pipereader finalize.
    pub owned_by_reader: Cell<bool>,
    /// If this goes negative, `on_max_buffer` is called on the subprocess.
    pub remaining_bytes: Cell<i64>,
    // (once both are cleared, it is freed)
}

// TODO(port): LIFETIMES.tsv classifies the caller fields (Subprocess.{stdout,stderr}_maxbuf,
// {Posix,Windows}BufferedReader.maxbuf) as SHARED → Option<Arc<MaxBuf>>. The fn params below
// (`ptr: &mut Option<NonNull<MaxBuf>>`, `value: Option<NonNull<MaxBuf>>`) and the hand-rolled
// heap::alloc/disowned()/destroy() refcount will not typecheck against those field types in
// Phase B — reconcile by retyping to Option<Arc<MaxBuf>> and dropping destroy()/disowned().
impl MaxBuf {
    pub fn create_for_subprocess(
        ptr: &mut Option<NonNull<MaxBuf>>,
        initial: Option<i64>,
    ) {
        let Some(initial) = initial else {
            *ptr = None;
            return;
        };
        *ptr = Some(bun_core::heap::into_raw_nn(Box::new(MaxBuf {
            owned_by_subprocess: Cell::new(true),
            owned_by_reader: Cell::new(false),
            remaining_bytes: Cell::new(initial),
        })));
    }

    fn disowned(&self) -> bool {
        !self.owned_by_subprocess.get() && !self.owned_by_reader.get()
    }

    /// # Safety
    /// `this` must have been allocated by `create_for_subprocess` (i.e. via `heap::alloc`)
    /// and must be fully disowned.
    unsafe fn destroy(this: NonNull<MaxBuf>) {
        debug_assert!(unsafe { this.as_ref() }.disowned());
        // SAFETY: paired with heap::alloc in `create_for_subprocess`.
        drop(unsafe { bun_core::heap::take(this.as_ptr()) });
    }

    pub fn remove_from_subprocess(ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(this_nn) = *ptr else { return };
        // SAFETY: `this_nn` came from `create_for_subprocess` (heap::alloc); allocation is
        // live until `destroy`. `&MaxBuf` only — all mutation through `Cell`, so the
        // re-entrant `on_read_bytes` path that may still be on the stack holds a
        // compatible shared borrow.
        let this = unsafe { this_nn.as_ref() };
        debug_assert!(this.owned_by_subprocess.get());
        this.owned_by_subprocess.set(false);
        *ptr = None;
        if this.disowned() {
            // SAFETY: both owners cleared ⇒ disowned(); paired with heap::alloc.
            unsafe { MaxBuf::destroy(this_nn) };
        }
    }

    pub fn add_to_pipereader(value: Option<NonNull<MaxBuf>>, ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(value_nn) = value else { return };
        debug_assert!(ptr.is_none());
        *ptr = Some(value_nn);
        // SAFETY: `value` is a live MaxBuf created by `create_for_subprocess`.
        let v = unsafe { value_nn.as_ref() };
        debug_assert!(!v.owned_by_reader.get());
        v.owned_by_reader.set(true);
    }

    pub fn remove_from_pipereader(ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(this_nn) = *ptr else { return };
        // SAFETY: `ptr` was populated by `add_to_pipereader`; allocation is live until `destroy`.
        let this = unsafe { this_nn.as_ref() };
        debug_assert!(this.owned_by_reader.get());
        this.owned_by_reader.set(false);
        *ptr = None;
        if this.disowned() {
            // SAFETY: just established `disowned()`; allocation originated from heap::alloc.
            unsafe { MaxBuf::destroy(this_nn) };
        }
    }

    pub fn transfer_to_pipereader(
        prev: &mut Option<NonNull<MaxBuf>>,
        next: &mut Option<NonNull<MaxBuf>>,
    ) {
        if prev.is_none() {
            return;
        }
        *next = *prev;
        *prev = None;
    }

    /// Returns `true` if this read pushed the budget negative *and* the
    /// subprocess still owns it (i.e. the caller should fire
    /// `BufferedReaderParentLink::on_max_buffer_overflow`).
    ///
    /// Takes `NonNull` (not `&mut self`) because the overflow callback the
    /// caller fires next is contractually required to call
    /// `remove_from_subprocess`, which writes `owned_by_subprocess` through a
    /// sibling pointer to this same allocation. With `Cell` fields a shared
    /// `&MaxBuf` is sufficient and the re-entrancy is sound; the single
    /// `unsafe` is the `NonNull → &MaxBuf` projection (the back-ref invariant:
    /// `this` is live while `owned_by_reader` is set, which every caller has
    /// just checked via `Some(maxbuf)`).
    pub fn on_read_bytes(this: NonNull<MaxBuf>, bytes: u64) -> bool {
        // SAFETY: caller holds `this` from a live `Option<NonNull<MaxBuf>>`
        // populated by `add_to_pipereader`; allocation is live until
        // `remove_from_pipereader` (which the caller has not yet run). Shared
        // borrow only — all mutation goes through `Cell`.
        let this = unsafe { this.as_ref() };
        let delta = i64::try_from(bytes).unwrap_or(0);
        let remaining = this.remaining_bytes.get().checked_sub(delta).unwrap_or(-1);
        this.remaining_bytes.set(remaining);
        remaining < 0 && this.owned_by_subprocess.get()
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
    Stdout,
    Stderr,
}

// ported from: src/io/MaxBuf.zig
