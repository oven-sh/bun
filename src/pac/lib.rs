//! An interpreter for proxy auto-config scripts. They come from the network, so they get no realm to run in.
//! A string is bytes, as Latin-1.
#![forbid(unsafe_code)]

mod builtins;
mod calendar;
mod globals;
mod machine;
mod syntax;

use std::net::IpAddr;

pub use globals::is_in_network;
pub use machine::Script;

/// What a script may learn. It may block.
pub trait Host {
    fn resolve(&self, name: &[u8]) -> Vec<IpAddr>;
    fn own_addresses(&self) -> Vec<IpAddr>;
    /// Milliseconds since the epoch.
    fn now(&self) -> f64;
    /// Milliseconds that local time is ahead of UTC.
    fn offset_at(&self, time: f64) -> f64;
}

#[derive(Debug)]
pub struct Failed;
