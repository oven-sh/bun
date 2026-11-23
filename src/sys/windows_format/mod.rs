//! Encoders and parsers for Windows data formats. They make no system calls.

#![forbid(unsafe_code)]

pub mod adapter_addresses;
pub(crate) mod addr_info;
pub mod command_line;
pub mod cpu_time;
pub mod crt_descriptors;
pub mod directory_changes;
pub(crate) mod environment;
pub(crate) mod file_time;
pub mod ipc_frame;
pub mod key_input;
pub mod open_flags;
pub(crate) mod path_syntax;
pub(crate) mod priority_class;
pub(crate) mod product_name;
pub(crate) mod reparse;
pub mod wtf16;

const AF_INET: u16 = 2;
const AF_INET6: u16 = 23;
