//! What Windows and its programs hand to each other, apart from the calls that carry it.

#![forbid(unsafe_code)]

pub mod adapters;
pub mod command_line;
pub mod cpu_time;
pub mod crt_descriptors;
pub mod directory_changes;
pub(crate) mod environment;
pub(crate) mod file_time;
pub mod ipc_frame;
pub mod key_input;
pub(crate) mod names;
pub mod open_flags;
pub(crate) mod priority;
pub(crate) mod product_name;
pub(crate) mod reparse;
pub(crate) mod resolver;
pub mod wide;

const AF_INET: u16 = 2;
const AF_INET6: u16 = 23;
