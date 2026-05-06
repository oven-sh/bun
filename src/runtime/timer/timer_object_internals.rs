//! `TimerObjectInternals` — fields shared by `TimeoutObject` / `ImmediateObject`.
//!
//! B-2 un-gate: struct + `Flags` packed-u32 state machine are real;
//! `run_immediate_task()` + helpers (`event_loop_timer`/`ref_`/`deref_`/
//! `set_enable_keeping_event_loop_alive`/`run`) un-gated for the
//! `RUN_IMMEDIATE_HOOK` dispatch path. `init()`/`cancel()`/`fire()` bodies
//! stay in the gated draft (`TimerObjectInternals.rs`).

use core::mem::offset_of;

use crate::jsc::{generated::JSImmediate, Debugger, JSGlobalObject, JSValue, JsRef, VirtualMachine};

use super::{EventLoopTimer, EventLoopTimerState, ImmediateObject, Kind, TimeoutObject, ID};

/// Data that TimerObject and ImmediateObject have in common.
#[repr(C)]
pub struct TimerObjectInternals {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub id: i32,
    pub interval: u32, // Zig: u31
    pub this_value: JsRef,
    pub flags: Flags,
    /// `bun test --isolate` generation this timer was created in.
    pub generation: u32,
}

impl Default for TimerObjectInternals {
    fn default() -> Self {
        Self {
            id: -1,
            interval: 0,
            this_value: JsRef::empty(),
            flags: Flags::default(),
            generation: 0,
        }
    }
}

/// Zig: `packed struct(u32)` with mixed-width fields. Layout (LSB→MSB):
///   epoch:u25, kind:u2, has_cleared_timer:1, is_keeping_event_loop_alive:1,
///   has_accessed_primitive:1, has_js_ref:1, in_callback:1
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Flags(u32);

impl Default for Flags {
    fn default() -> Self {
        // has_js_ref=true, everything else 0
        Self(1 << 30)
    }
}

impl Flags {
    const EPOCH_MASK: u32 = (1 << 25) - 1;
    const KIND_SHIFT: u32 = 25;
    const KIND_MASK: u32 = 0b11 << Self::KIND_SHIFT;
    const HAS_CLEARED_TIMER: u32 = 1 << 27;
    const IS_KEEPING_EVENT_LOOP_ALIVE: u32 = 1 << 28;
    const HAS_ACCESSED_PRIMITIVE: u32 = 1 << 29;
    const HAS_JS_REF: u32 = 1 << 30;
    const IN_CALLBACK: u32 = 1 << 31;

    #[inline] pub fn epoch(self) -> u32 { self.0 & Self::EPOCH_MASK }
    #[inline] pub fn set_epoch(&mut self, v: u32) {
        self.0 = (self.0 & !Self::EPOCH_MASK) | (v & Self::EPOCH_MASK);
    }
    #[inline] pub fn kind(self) -> Kind {
        // SAFETY: stored value always written via set_kind (range 0..=2)
        unsafe { core::mem::transmute::<u8, Kind>(((self.0 & Self::KIND_MASK) >> Self::KIND_SHIFT) as u8) }
    }
    #[inline] pub fn set_kind(&mut self, k: Kind) {
        self.0 = (self.0 & !Self::KIND_MASK) | ((k as u32) << Self::KIND_SHIFT);
    }
    #[inline] pub fn has_cleared_timer(self) -> bool { self.0 & Self::HAS_CLEARED_TIMER != 0 }
    #[inline] pub fn set_has_cleared_timer(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_CLEARED_TIMER } else { self.0 &= !Self::HAS_CLEARED_TIMER }
    }
    #[inline] pub fn is_keeping_event_loop_alive(self) -> bool { self.0 & Self::IS_KEEPING_EVENT_LOOP_ALIVE != 0 }
    #[inline] pub fn set_is_keeping_event_loop_alive(&mut self, v: bool) {
        if v { self.0 |= Self::IS_KEEPING_EVENT_LOOP_ALIVE } else { self.0 &= !Self::IS_KEEPING_EVENT_LOOP_ALIVE }
    }
    #[inline] pub fn has_accessed_primitive(self) -> bool { self.0 & Self::HAS_ACCESSED_PRIMITIVE != 0 }
    #[inline] pub fn set_has_accessed_primitive(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_ACCESSED_PRIMITIVE } else { self.0 &= !Self::HAS_ACCESSED_PRIMITIVE }
    }
    #[inline] pub fn has_js_ref(self) -> bool { self.0 & Self::HAS_JS_REF != 0 }
    #[inline] pub fn set_has_js_ref(&mut self, v: bool) {
        if v { self.0 |= Self::HAS_JS_REF } else { self.0 &= !Self::HAS_JS_REF }
    }
    #[inline] pub fn in_callback(self) -> bool { self.0 & Self::IN_CALLBACK != 0 }
    #[inline] pub fn set_in_callback(&mut self, v: bool) {
        if v { self.0 |= Self::IN_CALLBACK } else { self.0 &= !Self::IN_CALLBACK }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/TimerObjectInternals.zig
//   confidence: high (struct/flags only)
//   notes:      this_value: JsRef → JSValue placeholder until bun_jsc.
// ──────────────────────────────────────────────────────────────────────────
