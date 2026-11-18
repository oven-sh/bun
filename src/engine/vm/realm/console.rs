//! What the functions of `console` hand on to the embedder.

use bun_engine_text::StringRef;

use crate::{Cx, JsResult, Value};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MessageType {
    Log,
    Dir,
    DirXml,
    Table,
    Trace,
    StartGroup,
    StartGroupCollapsed,
    EndGroup,
    Clear,
    Assert,
    Timing,
    Profile,
    ProfileEnd,
    Image,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MessageLevel {
    Log,
    Warning,
    Error,
    Debug,
    Info,
}

/// Each finds the client in `GlobalObject::console_client`. A script may have run since it was last seen there.
pub struct ConsoleHooks {
    pub message: fn(&mut Cx, MessageType, MessageLevel, &[Value]) -> JsResult<()>,
    pub count: fn(&mut Cx, label: &StringRef) -> JsResult<()>,
    pub count_reset: fn(&mut Cx, label: &StringRef) -> JsResult<()>,
    pub profile: fn(&mut Cx, title: Option<&StringRef>) -> JsResult<()>,
    pub profile_end: fn(&mut Cx, title: Option<&StringRef>) -> JsResult<()>,
    pub take_heap_snapshot: fn(&mut Cx, title: Option<&StringRef>) -> JsResult<()>,
    pub time: fn(&mut Cx, label: &StringRef) -> JsResult<()>,
    pub time_log: fn(&mut Cx, label: &StringRef, &[Value]) -> JsResult<()>,
    pub time_end: fn(&mut Cx, label: &StringRef) -> JsResult<()>,
}

impl Cx {
    /// `None` if the realm has no client.
    #[inline]
    pub fn console(&self) -> Option<&'static ConsoleHooks> {
        let has_client = !self.global().console_client().get().is_null();
        self.embedder().console.get().filter(|_| has_client)
    }
}
