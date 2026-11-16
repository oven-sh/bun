use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};

#[derive(Default, Clone, Copy)]
pub struct Signals<'a> {
    pub header_progress: Option<&'a AtomicBool>,
    pub response_body_streaming: Option<&'a AtomicBool>,
    pub aborted: Option<&'a AtomicBool>,
    pub cert_errors: Option<&'a AtomicBool>,
    pub body_receive_mode: Option<&'a AtomicU8>,
}

/// Receive backpressure high-water mark: bytes no consumer has taken, on either side of the
/// HTTP→JS hop. A body shorter than this completes unread, which frees its connection.
pub const BODY_HIGH_WATER_MARK: usize = 256 * 1024;

/// Receive backpressure for a body handed to JS. Whichever side holds bytes no consumer has
/// taken moves `Flowing -> Paused` once they reach the high-water mark; whoever takes them
/// moves `Paused -> Flowing` and schedules a resume. The transport applies `Paused` after the
/// next read. Two terminal states: `BufferAll` (a consumer wants the whole body) and
/// `Abandoned` (nothing will read it; the transport is being shut down, drop what arrives).
/// `Unclaimed`: `Flowing` before a consumer attaches. See `Signals::hold_for_consumer`.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BodyReceiveMode {
    Flowing = 0,
    Paused = 1,
    BufferAll = 2,
    Abandoned = 3,
    Unclaimed = 4,
}

impl BodyReceiveMode {
    #[inline]
    pub(crate) fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Paused,
            2 => Self::BufferAll,
            3 => Self::Abandoned,
            4 => Self::Unclaimed,
            _ => Self::Flowing,
        }
    }
}

impl<'a> Signals<'a> {
    #[inline]
    fn slot(self, field: Field) -> Option<&'a AtomicBool> {
        match field {
            Field::HeaderProgress => self.header_progress,
            Field::ResponseBodyStreaming => self.response_body_streaming,
            Field::Aborted => self.aborted,
            Field::CertErrors => self.cert_errors,
        }
    }

    pub(crate) fn get(self, field: Field) -> bool {
        self.slot(field).is_some_and(|a| a.load(Ordering::Relaxed))
    }

    /// Store `value` into the named signal slot if present. No-op when the
    /// slot is `None`.
    pub(crate) fn store(self, field: Field, value: bool, ordering: Ordering) {
        if let Some(a) = self.slot(field) {
            a.store(value, ordering);
        }
    }

    #[inline]
    pub(crate) fn is_receive_paused(self) -> bool {
        self.body_receive_mode
            .is_some_and(|a| a.load(Ordering::Acquire) == BodyReceiveMode::Paused as u8)
    }

    /// `Flowing`, `Paused` or `Unclaimed`: a consumer takes the body piece by piece.
    #[inline]
    pub(crate) fn is_demand_driven(self) -> bool {
        self.body_receive_mode.is_some_and(|a| {
            matches!(
                BodyReceiveMode::from_u8(a.load(Ordering::Acquire)),
                BodyReceiveMode::Flowing | BodyReceiveMode::Paused | BodyReceiveMode::Unclaimed
            )
        })
    }

    /// `Unclaimed -> Paused`: a whole body waits for the consumer, which resumes the transport.
    #[inline]
    pub(crate) fn hold_for_consumer(self) -> bool {
        self.body_receive_mode.is_some_and(|a| {
            a.compare_exchange(
                BodyReceiveMode::Unclaimed as u8,
                BodyReceiveMode::Paused as u8,
                Ordering::AcqRel,
                Ordering::Relaxed,
            )
            .is_ok()
        })
    }
}

pub struct Store {
    pub header_progress: AtomicBool,
    pub response_body_streaming: AtomicBool,
    pub aborted: AtomicBool,
    pub cert_errors: AtomicBool,
    pub(crate) body_receive_mode: AtomicU8,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            header_progress: AtomicBool::new(false),
            response_body_streaming: AtomicBool::new(false),
            aborted: AtomicBool::new(false),
            cert_errors: AtomicBool::new(false),
            body_receive_mode: AtomicU8::new(BodyReceiveMode::Flowing as u8),
        }
    }
}

impl Store {
    /// For a body whose consumer attaches after the response head arrives: `Unclaimed`.
    pub fn unclaimed() -> Self {
        Self {
            body_receive_mode: AtomicU8::new(BodyReceiveMode::Unclaimed as u8),
            ..Self::default()
        }
    }

    pub fn to(&self) -> Signals<'_> {
        Signals {
            header_progress: Some(&self.header_progress),
            response_body_streaming: Some(&self.response_body_streaming),
            aborted: Some(&self.aborted),
            cert_errors: Some(&self.cert_errors),
            body_receive_mode: None,
        }
    }

    pub fn to_with_backpressure(&self) -> Signals<'_> {
        Signals {
            body_receive_mode: Some(&self.body_receive_mode),
            ..self.to()
        }
    }

    #[inline]
    pub fn body_receive_mode(&self) -> BodyReceiveMode {
        BodyReceiveMode::from_u8(self.body_receive_mode.load(Ordering::Acquire))
    }

    #[inline]
    fn try_transition_receive_mode(&self, from: BodyReceiveMode, to: BodyReceiveMode) -> bool {
        self.body_receive_mode
            .compare_exchange(from as u8, to as u8, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    }

    /// `Flowing` or `Unclaimed -> Paused`. No-op in the other states.
    #[inline]
    pub fn pause_receive(&self) {
        let _ = self
            .body_receive_mode
            .try_update(Ordering::AcqRel, Ordering::Acquire, |mode| {
                matches!(
                    BodyReceiveMode::from_u8(mode),
                    BodyReceiveMode::Flowing | BodyReceiveMode::Unclaimed
                )
                .then_some(BodyReceiveMode::Paused as u8)
            });
    }

    /// A streaming consumer attached: `Unclaimed` or `Paused -> Flowing`. The caller resumes.
    #[inline]
    pub fn receive_on_demand(&self) {
        let _ = self
            .body_receive_mode
            .try_update(Ordering::AcqRel, Ordering::Acquire, |mode| {
                matches!(
                    BodyReceiveMode::from_u8(mode),
                    BodyReceiveMode::Unclaimed | BodyReceiveMode::Paused
                )
                .then_some(BodyReceiveMode::Flowing as u8)
            });
    }

    /// `Paused -> Flowing`. Returns whether it was paused, i.e. whether the caller has to
    /// schedule the transport's resume.
    #[inline]
    pub fn unpause_receive(&self) -> bool {
        self.try_transition_receive_mode(BodyReceiveMode::Paused, BodyReceiveMode::Flowing)
    }

    /// Terminal: never pause again. Returns whether it was paused.
    #[inline]
    pub fn receive_all(&self) -> bool {
        self.body_receive_mode
            .swap(BodyReceiveMode::BufferAll as u8, Ordering::AcqRel)
            == BodyReceiveMode::Paused as u8
    }

    /// Terminal.
    #[inline]
    pub fn abandon(&self) {
        self.body_receive_mode
            .store(BodyReceiveMode::Abandoned as u8, Ordering::Release);
    }
}

/// Selects one of the atomic flag fields of `Signals`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Field {
    HeaderProgress,
    ResponseBodyStreaming,
    Aborted,
    CertErrors,
}
