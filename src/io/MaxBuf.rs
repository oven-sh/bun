use core::ptr::NonNull;

/// CYCLEBREAK(vtable): the owning subprocess lives in `bun_jsc::Subprocess`
/// (T6); io (T2) stores it opaquely and calls back through this vtable when
/// the byte budget overflows. `bun_runtime` provides the static instance.
/// PERF(port): was inline switch (cold — fires once per maxBuffer overflow).
pub struct MaxBufOwnerVTable {
    /// Called when `remaining_bytes` drops below 0. `owner` is the erased
    /// `*mut Subprocess`; `this` is the overflowing MaxBuf. Implementor must
    /// determine which slot (`stderr_maxbuf` / `stdout_maxbuf`) `this` occupies,
    /// call `MaxBuf::remove_from_subprocess` on it, then invoke
    /// `Subprocess::on_max_buffer(kind)`.
    pub on_overflow: unsafe fn(owner: NonNull<()>, this: NonNull<MaxBuf>),
}

/// Tracks remaining byte budget for a subprocess stdout/stderr pipe.
/// Dual-owned by the `Subprocess` and the pipe reader; freed when both disown it.
pub struct MaxBuf {
    /// `None` after subprocess finalize.
    // TODO(port): lifetime — raw backref to the owning Subprocess (BACKREF); not in LIFETIMES.tsv
    pub owned_by_subprocess: Option<(NonNull<()>, &'static MaxBufOwnerVTable)>,
    /// `false` after pipereader finalize.
    pub owned_by_reader: bool,
    /// If this goes negative, `on_max_buffer` is called on the subprocess.
    pub remaining_bytes: i64,
    // (once both are cleared, it is freed)
}

// TODO(port): LIFETIMES.tsv classifies the caller fields (Subprocess.{stdout,stderr}_maxbuf,
// {Posix,Windows}BufferedReader.maxbuf) as SHARED → Option<Arc<MaxBuf>>. The fn params below
// (`ptr: &mut Option<NonNull<MaxBuf>>`, `value: Option<NonNull<MaxBuf>>`) and the hand-rolled
// Box::into_raw/disowned()/destroy() refcount will not typecheck against those field types in
// Phase B — reconcile by retyping to Option<Arc<MaxBuf>> (with interior mutability for the
// ownership flags) and dropping destroy()/disowned().
impl MaxBuf {
    pub fn create_for_subprocess(
        owner: NonNull<()>,
        vtable: &'static MaxBufOwnerVTable,
        ptr: &mut Option<NonNull<MaxBuf>>,
        initial: Option<i64>,
    ) {
        let Some(initial) = initial else {
            *ptr = None;
            return;
        };
        // SAFETY: `owner` outlives this MaxBuf's `owned_by_subprocess` slot — the Subprocess
        // clears it via `remove_from_subprocess` in its finalize path before being dropped.
        let maxbuf = Box::into_raw(Box::new(MaxBuf {
            owned_by_subprocess: Some((owner, vtable)),
            owned_by_reader: false,
            remaining_bytes: initial,
        }));
        // SAFETY: Box::into_raw never returns null.
        *ptr = Some(unsafe { NonNull::new_unchecked(maxbuf) });
    }

    fn disowned(&self) -> bool {
        self.owned_by_subprocess.is_none() && !self.owned_by_reader
    }

    /// # Safety
    /// `this` must have been allocated by `create_for_subprocess` (i.e. via `Box::into_raw`)
    /// and must be fully disowned.
    unsafe fn destroy(this: NonNull<MaxBuf>) {
        debug_assert!(unsafe { this.as_ref() }.disowned());
        // SAFETY: paired with Box::into_raw in `create_for_subprocess`.
        drop(unsafe { Box::from_raw(this.as_ptr()) });
    }

    pub fn remove_from_subprocess(ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(this_nn) = *ptr else { return };
        // SAFETY: `ptr` came from `create_for_subprocess`; allocation is live until `destroy`.
        let this = unsafe { &mut *this_nn.as_ptr() };
        debug_assert!(this.owned_by_subprocess.is_some());
        this.owned_by_subprocess = None;
        *ptr = None;
        if this.disowned() {
            // SAFETY: just established `disowned()`; allocation originated from Box::into_raw.
            unsafe { MaxBuf::destroy(this_nn) };
        }
    }

    pub fn add_to_pipereader(value: Option<NonNull<MaxBuf>>, ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(value_nn) = value else { return };
        debug_assert!(ptr.is_none());
        *ptr = Some(value_nn);
        // SAFETY: `value` is a live MaxBuf created by `create_for_subprocess`.
        let v = unsafe { &mut *value_nn.as_ptr() };
        debug_assert!(!v.owned_by_reader);
        v.owned_by_reader = true;
    }

    pub fn remove_from_pipereader(ptr: &mut Option<NonNull<MaxBuf>>) {
        let Some(this_nn) = *ptr else { return };
        // SAFETY: `ptr` was populated by `add_to_pipereader`; allocation is live until `destroy`.
        let this = unsafe { &mut *this_nn.as_ptr() };
        debug_assert!(this.owned_by_reader);
        this.owned_by_reader = false;
        *ptr = None;
        if this.disowned() {
            // SAFETY: just established `disowned()`; allocation originated from Box::into_raw.
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

    pub fn on_read_bytes(&mut self, bytes: u64) {
        let delta = i64::try_from(bytes).unwrap_or(0);
        self.remaining_bytes = self.remaining_bytes.checked_sub(delta).unwrap_or(-1);
        if self.remaining_bytes < 0 {
            if let Some((owner_nn, vtable)) = self.owned_by_subprocess {
                let this_nn = NonNull::from(&mut *self);
                // SAFETY: `owned_by_subprocess` is cleared by the Subprocess before it is dropped
                // (see `remove_from_subprocess`), so the pointer is valid while Some.
                // CYCLEBREAK(vtable): the stderr/stdout slot lookup + on_max_buffer
                // call moves to bun_runtime's `MaxBufOwnerVTable` impl.
                unsafe { (vtable.on_overflow)(owner_nn, this_nn) };
            }
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
    Stdout,
    Stderr,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/MaxBuf.zig (86 lines)
//   confidence: medium
//   todos:      3
//   notes:      manual dual-ownership via raw NonNull (BACKREF to Subprocess); LIFETIMES.tsv says caller fields are Option<Arc<MaxBuf>> — reconcile in Phase B; Subprocess access now via MaxBufOwnerVTable (CYCLEBREAK)
// ──────────────────────────────────────────────────────────────────────────
