//! The WHATWG URL Standard: <https://url.spec.whatwg.org>.

#![forbid(unsafe_code)]

mod authority;
mod buffer;
mod byte_url;
mod canonical;
mod class;
mod components;
mod domain;
mod error;
mod file_path;
pub mod form;
mod host;
mod input;
mod ipv4;
mod ipv6;
mod origin;
mod output;
mod parse;
mod parser;
mod path;
mod percent;
mod punycode;
mod record;
mod scheme;
mod setters;
mod url;

pub use byte_url::ByteUrl;
pub use domain::{OnError, domain_to_ascii, domain_to_unicode, name_to_ascii, name_to_unicode};
pub use error::{Error, Result};
pub use file_path::PathStyle;
pub use input::Input;
pub use parse::Punycode;
pub use record::{Record, Storage};
pub use scheme::Scheme;
pub use url::Url;
