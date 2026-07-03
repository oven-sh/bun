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
    /// The owning `Subprocess` (plus how to notify it), or `.none` after
    /// subprocess finalize. See [`OwningSubprocess`]. Private: `dispatch_overflow`
    /// reads the stored `on_max_buffer` fn from it and calls it, so letting safe
    /// code write this field would bypass the `unsafe` `create_for_subprocess`
    /// contract. Only ever touched inside this module.
    owned_by_subprocess: Cell<OwningSubprocess>,
    /// `false` after pipereader finalize.
    pub owned_by_reader: Cell<bool>,
    /// If this goes negative, `on_max_buffer` is called on the subprocess.
    pub remaining_bytes: Cell<i64>,
    // (once both are cleared, it is freed)
}

/// The owning `Subprocess` of a [`MaxBuf`], carried on the `MaxBuf` itself so
/// the overflow kill survives the pipe being handed to a `FileReader` (whose
/// own vtable has no subprocess back-reference) when stdout/stderr is read as a
/// `ReadableStream`. Erased (`NonNull<()>`) because `Subprocess` lives in the
/// downstream `bun_runtime` crate; `on_max_buffer` recovers the concrete type.
#[derive(Copy, Clone)]
pub enum OwningSubprocess {
    /// Subprocess has disowned this `MaxBuf` (finalize / spawn error / overflow).
    None,
    /// Live back-pointer to the subprocess plus the fn that kills it — the same
    /// `BufferedReaderParentLink::on_max_buffer_overflow` dispatch, reached from
    /// the `MaxBuf` instead of the reader's vtable.
    Owned {
        ptr: NonNull<()>,
        on_max_buffer: unsafe fn(NonNull<()>, NonNull<MaxBuf>),
    },
}

impl OwningSubprocess {
    fn is_some(self) -> bool {
        matches!(self, OwningSubprocess::Owned { .. })
    }
    fn is_none(self) -> bool {
        matches!(self, OwningSubprocess::None)
    }
}

// TODO(refactor): LIFETIMES.tsv classifies the caller fields (Subprocess.{stdout,stderr}_maxbuf,
// {Posix,Windows}BufferedReader.maxbuf) as SHARED → Option<Arc<MaxBuf>>. The fn params below
// (`ptr: &mut Option<NonNull<MaxBuf>>`, `value: Option<NonNull<MaxBuf>>`) and the hand-rolled
// heap::alloc/disowned()/destroy() refcount will not typecheck against those field types —
// reconcile by retyping to Option<Arc<MaxBuf>> and dropping destroy()/disowned().
impl MaxBuf {
    /// Single nonnull-asref projection for the dual-owner back-pointer.
    ///
    /// Type invariant: every `NonNull<MaxBuf>` reachable from a subprocess or
    /// pipe-reader slot was created by `create_for_subprocess` and stays live
    /// until both owners have disowned it and `destroy` runs. All fields are
    /// `Cell<_>`, so the shared `&MaxBuf` returned here is sufficient for every
    /// mutation path and re-entrancy through the overflow callback is sound.
    #[inline]
    fn live<'a>(this: &'a NonNull<MaxBuf>) -> &'a MaxBuf {
        // SAFETY: type invariant — see doc comment above.
        unsafe { this.as_ref() }
    }

    /// # Safety
    /// `owner.ptr` must stay live until `remove_from_subprocess` clears it (on
    /// finalize, spawn error, or overflow); on overflow `owner.on_max_buffer` is
    /// called with it. The pairing cannot be checked here, hence `unsafe`.
    pub unsafe fn create_for_subprocess(
        owner: OwningSubprocess,
        ptr: &mut Option<NonNull<MaxBuf>>,
        initial: Option<i64>,
    ) {
        let Some(initial) = initial else {
            *ptr = None;
            return;
        };
        *ptr = Some(bun_core::heap::into_raw_nn(Box::new(MaxBuf {
            owned_by_subprocess: Cell::new(owner),
            owned_by_reader: Cell::new(false),
            remaining_bytes: Cell::new(initial),
        })));
    }

    fn disowned(&self) -> bool {
        self.owned_by_subprocess.get().is_none() && !self.owned_by_reader.get()
    }

    /// Module-private teardown. Safe `fn` because the precondition is the
    /// module-level type invariant already documented on [`live`]: every
    /// `NonNull<MaxBuf>` reachable here was allocated by
    /// `create_for_subprocess`, and both call sites have just established
    /// `disowned()` (asserted below). The single `unsafe` op — reclaiming the
    /// `Box` — is wrapped at its use.
    fn destroy(this: NonNull<MaxBuf>) {
        debug_assert!(Self::live(&this).disowned());
        // SAFETY: type invariant — `this` was produced by
        // `bun_core::heap::into_raw_nn` in `create_for_subprocess` and is
        // freed exactly once (both owner flags now `false`).
        drop(unsafe { bun_core::heap::take(this.as_ptr()) });
    }

    pub fn remove_from_subprocess(ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(this_nn) = *ptr else { return };
        let this = Self::live(&this_nn);
        debug_assert!(this.owned_by_subprocess.get().is_some());
        this.owned_by_subprocess.set(OwningSubprocess::None);
        *ptr = None;
        if this.disowned() {
            MaxBuf::destroy(this_nn);
        }
    }

    pub fn add_to_pipereader(value: Option<NonNull<MaxBuf>>, ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(value_nn) = value else { return };
        debug_assert!(ptr.is_none());
        *ptr = Some(value_nn);
        let v = Self::live(&value_nn);
        debug_assert!(!v.owned_by_reader.get());
        v.owned_by_reader.set(true);
    }

    pub fn remove_from_pipereader(ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(this_nn) = *ptr else { return };
        let this = Self::live(&this_nn);
        debug_assert!(this.owned_by_reader.get());
        this.owned_by_reader.set(false);
        *ptr = None;
        if this.disowned() {
            MaxBuf::destroy(this_nn);
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
        let this = Self::live(&this);
        let delta = i64::try_from(bytes).unwrap_or(0);
        let remaining = this.remaining_bytes.get().checked_sub(delta).unwrap_or(-1);
        this.remaining_bytes.set(remaining);
        remaining < 0 && this.owned_by_subprocess.get().is_some()
    }

    /// Kill the owning subprocess after an overflow. The
    /// `BufferedReaderParentLink::on_max_buffer_overflow` handler calls this; the
    /// dispatch fn is read off the `MaxBuf` (not the reader), so it fires whether
    /// the pipe is still read by its `SubprocessPipeReader` or by a `FileReader`.
    pub fn dispatch_overflow(this: NonNull<MaxBuf>) {
        if let OwningSubprocess::Owned { ptr, on_max_buffer } =
            Self::live(&this).owned_by_subprocess.get()
        {
            // SAFETY: `ptr`/`on_max_buffer` were paired in `create_for_subprocess`
            // and cleared in `remove_from_subprocess`; the subprocess outlives its
            // `MaxBuf` slot, so `ptr` is live while the variant is `Owned`.
            unsafe { on_max_buffer(ptr, this) };
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
    Stdout,
    Stderr,
}
