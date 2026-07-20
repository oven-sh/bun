use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};

#[derive(Default, Clone, Copy)]
pub struct Signals {
    // Non-owning pointers into a `Store` held by the caller (BACKREF per
    // PORTING.md); the `Store` outlives every `Signals` derived from it.
    pub header_progress: Option<NonNull<AtomicBool>>,
    pub response_body_streaming: Option<NonNull<AtomicBool>>,
    pub aborted: Option<NonNull<AtomicBool>>,
    pub cert_errors: Option<NonNull<AtomicBool>>,
    pub upgraded: Option<NonNull<AtomicBool>>,
    pub body_receive_mode: Option<NonNull<AtomicU8>>,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BodyReceiveMode {
    /// Pause the transport after each delivered body chunk until JS pulls.
    AutoPause = 0,
    /// `callback` won the CAS; transport should be paused until JS pulls.
    Paused = 1,
    /// `.arrayBuffer()`/`.text()`/etc attached — never pause.
    BufferAll = 2,
    /// Cancelled or abandoned — never pause, callback discards bytes.
    Ignore = 3,
}

impl BodyReceiveMode {
    #[inline]
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Paused,
            2 => Self::BufferAll,
            3 => Self::Ignore,
            _ => Self::AutoPause,
        }
    }
}

impl Signals {
    /// Resolve `field` to a [`BackRef`] over its `AtomicBool` slot, if wired.
    ///
    /// Centralises the back-reference upgrade so [`get`]/[`store`] are
    /// unsafe-free. Every non-None pointer here was created via
    /// `NonNull::from(&store.<field>)` in `Store::to` (or an equivalent
    /// caller-side `NonNull::from(&signal_store.<field>)`); the BACKREF
    /// invariant — the `Store` outlives every `Signals` derived from it — is
    /// exactly the [`bun_ptr::BackRef`] contract, so the safe `From<NonNull>`
    /// + `Deref` path applies. `AtomicBool` is `Sync` interior-mutable, so a
    /// shared `&` (via `BackRef::Deref`) suffices for both load and store.
    ///
    /// [`BackRef`]: bun_ptr::BackRef
    #[inline]
    fn slot(&self, field: Field) -> Option<bun_ptr::BackRef<AtomicBool>> {
        let ptr: NonNull<AtomicBool> = match field {
            Field::HeaderProgress => self.header_progress,
            Field::ResponseBodyStreaming => self.response_body_streaming,
            Field::Aborted => self.aborted,
            Field::CertErrors => self.cert_errors,
            Field::Upgraded => self.upgraded,
        }?;
        Some(bun_ptr::BackRef::from(ptr))
    }

    pub fn get(self, field: Field) -> bool {
        self.slot(field).is_some_and(|a| a.load(Ordering::Relaxed))
    }

    /// Store `value` into the named signal slot if present. No-op when the
    /// slot is `None`.
    pub fn store(self, field: Field, value: bool, ordering: Ordering) {
        if let Some(a) = self.slot(field) {
            a.store(value, ordering);
        }
    }

    #[inline]
    pub fn is_receive_paused(self) -> bool {
        self.body_receive_mode
            .map(bun_ptr::BackRef::from)
            .is_some_and(|a| a.load(Ordering::Acquire) == BodyReceiveMode::Paused as u8)
    }
}

pub struct Store {
    pub header_progress: AtomicBool,
    pub response_body_streaming: AtomicBool,
    pub aborted: AtomicBool,
    pub cert_errors: AtomicBool,
    pub upgraded: AtomicBool,
    pub body_receive_mode: AtomicU8,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            header_progress: AtomicBool::new(false),
            response_body_streaming: AtomicBool::new(false),
            aborted: AtomicBool::new(false),
            cert_errors: AtomicBool::new(false),
            upgraded: AtomicBool::new(false),
            body_receive_mode: AtomicU8::new(BodyReceiveMode::AutoPause as u8),
        }
    }
}

impl Store {
    pub fn to(&mut self) -> Signals {
        Signals {
            header_progress: Some(NonNull::from(&self.header_progress)),
            response_body_streaming: Some(NonNull::from(&self.response_body_streaming)),
            aborted: Some(NonNull::from(&self.aborted)),
            cert_errors: Some(NonNull::from(&self.cert_errors)),
            upgraded: Some(NonNull::from(&self.upgraded)),
            body_receive_mode: None,
        }
    }

    pub fn to_with_backpressure(&mut self) -> Signals {
        Signals {
            body_receive_mode: Some(NonNull::from(&self.body_receive_mode)),
            ..self.to()
        }
    }

    #[inline]
    pub fn body_receive_mode(&self) -> BodyReceiveMode {
        BodyReceiveMode::from_u8(self.body_receive_mode.load(Ordering::Acquire))
    }

    #[inline]
    pub fn try_transition_receive_mode(&self, from: BodyReceiveMode, to: BodyReceiveMode) -> bool {
        self.body_receive_mode
            .compare_exchange(from as u8, to as u8, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    }

    /// Unconditionally move to a terminal mode (`BufferAll`/`Ignore`).
    /// Returns whether the previous state was `Paused`.
    #[inline]
    pub fn set_receive_mode_terminal(&self, mode: BodyReceiveMode) -> bool {
        debug_assert!(matches!(
            mode,
            BodyReceiveMode::BufferAll | BodyReceiveMode::Ignore
        ));
        self.body_receive_mode.swap(mode as u8, Ordering::AcqRel) == BodyReceiveMode::Paused as u8
    }
}

/// Selects one of the atomic flag fields of `Signals`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Field {
    HeaderProgress,
    ResponseBodyStreaming,
    Aborted,
    CertErrors,
    Upgraded,
}
