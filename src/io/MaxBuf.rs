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
    /// Direct link to the owning `Subprocess` so overflow dispatch does not
    /// depend on the pipe reader's parent vtable (which changes to `FileReader`
    /// once the `.stdout`/`.stderr` stream getter is touched). `None` after
    /// subprocess finalize or once the overflow callback has fired.
    pub owned_by_subprocess: Cell<Option<Owner>>,
    /// `false` after pipereader finalize.
    pub owned_by_reader: Cell<bool>,
    /// If this goes negative, `on_max_buffer` is called on the subprocess.
    pub remaining_bytes: Cell<i64>,
    // (once both are cleared, it is freed)
}

/// Erased back-pointer to the owning `Subprocess` plus its overflow handler.
/// `on_overflow` must call [`MaxBuf::remove_from_subprocess`] on the matching
/// slot (so the callback fires at most once) and then kill the child.
#[derive(Copy, Clone)]
pub struct Owner {
    pub ptr: NonNull<()>,
    pub on_overflow: unsafe fn(NonNull<()>, NonNull<MaxBuf>),
}

/// How far the read that crosses `maxBuffer` may overshoot it: one Node-sized
/// stdio read. Must stay nonzero, Node's `spawnSync` documents `stdout`
/// exceeding `maxBuffer` by up to one read.
const OVERREAD_ALLOWANCE: u64 = 64 * 1024;

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

    pub fn create_for_subprocess(
        ptr: &mut Option<NonNull<MaxBuf>>,
        initial: Option<i64>,
        owner: Owner,
    ) {
        let Some(initial) = initial else {
            *ptr = None;
            return;
        };
        *ptr = Some(bun_core::heap::into_raw_nn(Box::new(MaxBuf {
            owned_by_subprocess: Cell::new(Some(owner)),
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
        this.owned_by_subprocess.set(None);
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
    /// subprocess still owns it, in which case the owner's overflow callback
    /// has already been fired (so the caller only needs to stop reading).
    ///
    /// Takes `NonNull` (not `&mut self`) because the overflow callback is
    /// contractually required to call `remove_from_subprocess`, which writes
    /// `owned_by_subprocess` through a sibling pointer to this same
    /// allocation. With `Cell` fields a shared `&MaxBuf` is sufficient and the
    /// re-entrancy is sound; the single `unsafe` is the `NonNull → &MaxBuf`
    /// projection (the back-ref invariant: `this` is live while
    /// `owned_by_reader` is set, which every caller has just checked via
    /// `Some(maxbuf)`).
    pub fn on_read_bytes(this: NonNull<MaxBuf>, bytes: u64) -> bool {
        let mb = Self::live(&this);
        let delta = i64::try_from(bytes).unwrap_or(0);
        let remaining = mb.remaining_bytes.get().checked_sub(delta).unwrap_or(-1);
        mb.remaining_bytes.set(remaining);
        if remaining >= 0 {
            return false;
        }
        let Some(owner) = mb.owned_by_subprocess.get() else {
            return false;
        };
        // SAFETY: `owner.ptr` is the `Subprocess` that called
        // `create_for_subprocess`; it stays live while `owned_by_subprocess`
        // is `Some` (cleared in `remove_from_subprocess`, called from
        // `Subprocess::finalize` and from the callback itself). The callback
        // never frees `this` — `owned_by_reader` is set on every caller path.
        unsafe { (owner.on_overflow)(owner.ptr, this) };
        true
    }

    /// Trims `buf` to the remaining budget plus `OVERREAD_ALLOWANCE`: unclamped,
    /// a 256 KB scratch read off a socketpair overshoots `maxBuffer` by hundreds
    /// of KB. Never empties a non-empty `buf` (that would read as EOF).
    pub fn clamp_read_buf(this: Option<NonNull<MaxBuf>>, buf: &mut [u8]) -> &mut [u8] {
        let Some(this) = this else {
            return buf;
        };
        let remaining = u64::try_from(Self::live(&this).remaining_bytes.get()).unwrap_or(0);
        let limit =
            usize::try_from(remaining.saturating_add(OVERREAD_ALLOWANCE)).unwrap_or(usize::MAX);
        let len = buf.len().min(limit);
        &mut buf[..len]
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
    Stdout,
    Stderr,
}
