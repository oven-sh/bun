//! What has happened in the engine that scripts are told of.

use std::borrow::Cow;

use crate::tree::NodeId;
use crate::values::Str;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Playback {
    Ready,
    Finish,
    Unfinish,
    Cancel { was_pending: bool },
    Remove,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Stage {
    Run,
    Start,
    Iteration,
    End,
    Cancel,
}

#[derive(Clone)]
pub(crate) struct CssEvent {
    pub(crate) is_transition: bool,
    pub(crate) stage: Stage,
    pub(crate) name: Str,
    pub(crate) elapsed_seconds: f64,
    pub(crate) pseudo: Cow<'static, str>,
    pub(crate) animation: u32,
    pub(crate) scheduled: f64,
}

#[derive(Clone, Copy)]
pub(crate) enum TimeEvent {
    Begin,
    Repeat,
    End,
}

#[derive(Clone)]
pub(crate) enum ForNode {
    Css(CssEvent),
    Scroll {
        has_ended: bool,
    },
    /// With the targets in the block axis and in the inline axis.
    Snap {
        has_ended: bool,
        targets: [NodeId; 2],
    },
    ContentVisibility {
        skipped: bool,
    },
    Smil(TimeEvent),
}

pub(crate) enum EngineEvent {
    Playback(u32, Playback),
    ScrollRequest { request: u32, was_interrupted: bool },
    Node(NodeId, ForNode),
}
