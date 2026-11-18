//! What the pages of `bun:desktop` may load, and how: the parts of the web platform that have no nodes.

/// An enum of keywords, with `parse` and `as_bytes`.
macro_rules! keywords {
    ($(#[$meta:meta])* $vis:vis enum $name:ident { $($(#[$of_variant:meta])* $variant:ident = $text:literal,)* }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        $vis enum $name {
            $($(#[$of_variant])* $variant,)*
        }

        impl $name {
            $vis const ALL: &[$name] = &[$($name::$variant,)*];

            $vis fn parse(text: &[u8]) -> Option<$name> {
                match text {
                    $($text => Some($name::$variant),)*
                    _ => None,
                }
            }

            $vis fn as_bytes(self) -> &'static [u8] {
                match self {
                    $($name::$variant => $text,)*
                }
            }
        }

        impl $crate::wire::Wire for $name {
            fn write(self, to: &mut $crate::wire::Writer) {
                to.put(&[self as u8]);
            }

            fn read(from: &mut $crate::wire::Reader<'_>) -> $crate::wire::Result<Self> {
                let [index] = from.take()?;
                $name::ALL.get(usize::from(index)).copied().ok_or($crate::wire::Malformed)
            }
        }
    };
}

pub mod channel;
pub mod client;

pub mod compiled;
pub mod convert;
pub mod csp;
pub mod dom;
pub mod encoding;
pub mod exec;
mod generated_bindgen;
pub mod headers;
pub mod held;
pub mod host;
pub mod hosts;
pub mod import_map;
pub mod input;
pub mod integrity;
pub mod js_embedder;
pub mod js_link;
pub use bun_threading::Guarded;

pub mod locks;
pub mod media;
pub mod mime;
pub mod net;
pub mod origin;
pub mod outside;
pub mod page;
pub mod pattern;
pub mod permissions_policy;
pub mod policy_container;
pub mod realm;
pub mod referrer;
pub mod remote;
pub mod renderer;
pub mod reporting;
pub mod request;
pub mod runtime;
pub mod scheme;
pub mod serial;
pub mod service;
pub mod sniff;
pub mod storage;
pub mod streams;
pub mod structured;
pub mod tasks;
pub mod time;
pub mod timers;
pub mod timing;
pub mod trace;
pub mod trust;
pub mod url;
pub mod url_pattern;
pub mod window_features;
pub mod wire;

type Bytes = Box<[u8]>;

/// `bun_core::fast_random()` gives all threads the same numbers.
fn random() -> u64 {
    let mut bytes = [0; 8];
    bun_boringssl_sys::rand_bytes(&mut bytes);
    u64::from_ne_bytes(bytes)
}
