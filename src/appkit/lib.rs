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
//! and [`run_loop`]; `unsafe_code` is forbidden in every other module.
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
pub use menu::ActionSelector;
pub use objc::NsStr;
pub use view::{Event, Kind, Prop, View, ViewSink};
pub use window::{SizeLimits, Window, WindowOptions, WindowSink};
