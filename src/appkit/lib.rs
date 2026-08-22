//! Native macOS user interfaces for `Bun.AppKit`.
//!
//! This crate talks to AppKit through the Objective-C runtime, which it
//! `dlopen`s on first use so that nothing is linked into `bun` at startup.
//! It never names a JavaScript type: `bun_runtime` converts JS values into
//! the typed [`view::Prop`]s and [`window::Window`] setters defined here and
//! receives events back through the sink traits.
//!
//! Everything runs on the main thread, which is both the JavaScript thread
//! and the AppKit main thread; [`run_loop`] is what lets the two event loops
//! share it. Raw Objective-C and CoreFoundation calls live only in [`objc`]
//! and [`run_loop`]; `unsafe_code` is forbidden in every other module, and
//! every way `objc` offers to name a raw pointer, wrap an arbitrary object in
//! a typed wrapper, register a method implementation or allocate a protocol
//! type is an `unsafe fn` or private to it.
#![cfg(target_os = "macos")]
#![deny(unsafe_code)]

#[forbid(unsafe_code)]
mod named;
pub use named::Named;
pub(crate) use named::named_enum;

#[forbid(unsafe_code)]
pub mod app;
#[forbid(unsafe_code)]
pub mod color;
#[forbid(unsafe_code)]
pub mod error;
#[forbid(unsafe_code)]
pub mod font;
#[forbid(unsafe_code)]
pub mod geometry;
#[forbid(unsafe_code)]
pub mod gpu;
#[forbid(unsafe_code)]
pub mod menu;
#[allow(unsafe_code)]
pub(crate) mod objc;
#[allow(unsafe_code)]
pub(crate) mod run_loop;
#[forbid(unsafe_code)]
pub mod view;
#[forbid(unsafe_code)]
pub mod window;

pub use app::{ActivationPolicy, App, AppSink};
pub use color::{Color, SystemColor};
pub use error::{Error, Result};
pub use font::{Design, Font, Weight};
pub use geometry::{Insets, Point, Positive, Rect, Size};
pub use gpu::{Gpu, Storage};
pub use menu::ActionSelector;
pub use objc::NsStr;
/// Run-time (selector-by-name) messaging: `objc.classes`, `msgSend` and
/// `.native` in `bun:appkit`.
pub use objc::dynamic;
pub use objc::{DynClass, DynObject, DynValue};
pub use view::{Event, Kind, Prop, View, ViewSink};
pub use window::{SizeLimits, Window, WindowOptions, WindowSink};

/// Loads AppKit and Metal and checks every Objective-C binding compiled into
/// this build against the frameworks on this machine: the class or protocol
/// exists, it declares the selector, and its type encoding matches the Rust
/// signature; and every method of the classes this crate registers matches
/// its protocol or superclass declaration. Returns one line per mismatch;
/// empty means they agree.
pub fn verify_bindings() -> Result<Vec<String>> {
    objc::verify_bindings()
}
