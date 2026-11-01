//! The HMR wire protocol: message ids sent and received over the dev server WebSocket.
//! `src/codegen/bake-codegen.ts` reads these enums to generate the client-side copies.

use super::*;

/// `DevServer.ConsoleLog.Kind` — `enum(u8) { log = 'l', err = 'e' }`.
/// Discriminants MUST NOT change: `kind as u8` is sent across FFI to
/// `InspectorBunFrontendDevServerAgent__notifyConsoleLog`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum ConsoleLogKind {
    Log = b'l',
    Err = b'e',
}

/// `DevServer.MessageId` — first byte of every server→client HMR frame.
/// Discriminants are the HMR wire protocol and MUST match the client
/// (`generated.ts`).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum MessageId {
    Version = b'V',
    HotUpdate = b'u',
    Errors = b'e',
    MemoryVisualizer = b'M',
    SetUrlResponse = b'n',
    TestingWatchSynchronization = b'r',
}
impl MessageId {
    #[inline]
    pub(crate) fn char(self) -> u8 {
        self as u8
    }
}

/// `DevServer.IncomingMessageId` — first byte of every client→server HMR frame.
/// Discriminants are the HMR wire protocol and MUST match the client
/// (`generated.ts`).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum IncomingMessageId {
    Init = b'i',
    Subscribe = b's',
    SetUrl = b'n',
    TestingBatchEvents = b'H',
    ConsoleLog = b'l',
    UnrefSourceMap = b'u',
}

/// `DevServer.HmrTopic`. Discriminants are the HMR wire protocol and MUST
/// match the client.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum HmrTopic {
    HotUpdate = b'h',
    Errors = b'e',
    BrowserError = b'E',
    IncrementalVisualizer = b'v',
    MemoryVisualizer = b'M',
    TestingWatchSynchronization = b'r',
}

impl HmrTopic {
    /// `HmrTopic.max_count` — `@typeInfo(HmrTopic).@"enum".fields.len`.
    pub(crate) const MAX_COUNT: usize = 6;

    /// All variants in declaration order.
    pub(crate) const ALL: &[HmrTopic] = &[
        HmrTopic::HotUpdate,
        HmrTopic::Errors,
        HmrTopic::BrowserError,
        HmrTopic::IncrementalVisualizer,
        HmrTopic::MemoryVisualizer,
        HmrTopic::TestingWatchSynchronization,
    ];

    /// Maps the wire-byte discriminant back to the variant (`@enumFromInt`
    /// with range-check). `None` for unknown bytes.
    #[inline]
    pub(crate) fn from_u8(ch: u8) -> Option<HmrTopic> {
        match ch {
            b'h' => Some(HmrTopic::HotUpdate),
            b'e' => Some(HmrTopic::Errors),
            b'E' => Some(HmrTopic::BrowserError),
            b'v' => Some(HmrTopic::IncrementalVisualizer),
            b'M' => Some(HmrTopic::MemoryVisualizer),
            b'r' => Some(HmrTopic::TestingWatchSynchronization),
            _ => None,
        }
    }

    /// uWS topic name for this HMR channel. The leading `0xFF` byte cannot
    /// occur in WTF-8, so no topic string passed to `ServerWebSocket`
    /// `subscribe()`/`publish()` or `Server.publish()` can ever name it.
    #[inline]
    pub(crate) fn uws_topic(self) -> [u8; 2] {
        [0xFF, self as u8]
    }

    /// Maps a topic to its packed `HmrTopicBits` flag.
    #[inline]
    pub(crate) fn as_bit(self) -> crate::bake::dev_server::HmrTopicBits {
        use crate::bake::dev_server::HmrTopicBits;
        match self {
            HmrTopic::HotUpdate => HmrTopicBits::HOT_UPDATE,
            HmrTopic::Errors => HmrTopicBits::ERRORS,
            HmrTopic::BrowserError => HmrTopicBits::BROWSER_ERROR,
            HmrTopic::IncrementalVisualizer => HmrTopicBits::INCREMENTAL_VISUALIZER,
            HmrTopic::MemoryVisualizer => HmrTopicBits::MEMORY_VISUALIZER,
            HmrTopic::TestingWatchSynchronization => HmrTopicBits::TESTING_WATCH_SYNCHRONIZATION,
        }
    }
}

bitflags::bitflags! {
    // bitflags! requires explicit power-of-two values; field names match enum variants.
    #[derive(Default, Copy, Clone)]
    pub struct HmrTopicBits: u8 {
        const HOT_UPDATE = 1 << 0;
        const ERRORS = 1 << 1;
        const BROWSER_ERROR = 1 << 2;
        const INCREMENTAL_VISUALIZER = 1 << 3;
        const MEMORY_VISUALIZER = 1 << 4;
        const TESTING_WATCH_SYNCHRONIZATION = 1 << 5;
    }
}
