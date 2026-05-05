#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// PORTING.md crate map says `bun.String`/`bun.strings` → `bun_str`, but the
// workspace crate is named `bun_string`. Alias once here so draft modules that
// followed the guide compile without per-file edits.
extern crate bun_string as bun_str;

/// Crate-local shim for `bun_jsc` while that crate is under concurrent B-2
/// work and does not compile. Draft modules import `crate::jsc::…` instead of
/// `bun_jsc::…`; once `bun_jsc` is green, swap this for `pub use bun_jsc as jsc;`.
// TODO(b2-blocked): bun_jsc::* — replace this shim with `pub use bun_jsc as jsc;`.
pub mod jsc {
    macro_rules! opaque {
        ($($(#[$m:meta])* $name:ident),* $(,)?) => {
            $($(#[$m])* #[repr(transparent)] #[derive(Debug, Clone, Copy, Default)]
              pub struct $name(pub usize);)*
        };
    }
    opaque!(
        JSValue, JSGlobalObject, JSObject, JSCell, JSString, JSFunction, JSArray,
        JSPromise, CallFrame, VM, ArrayBuffer, MarkedArrayBuffer, JSUint8Array,
        Exception, ErrorCode, AnyPromise, AbortSignal, FetchHeaders,
    );
    pub type JsResult<T> = Result<T, JsError>;
    #[derive(Debug, Clone, Copy, Default)]
    pub struct JsError;
    #[derive(Debug, Default)]
    pub struct Strong<T>(core::marker::PhantomData<T>);
    #[derive(Debug, Default)]
    pub struct Weak<T>(core::marker::PhantomData<T>);
    pub mod virtual_machine {
        #[derive(Debug, Default)]
        pub struct VirtualMachine {
            pub active_tasks: u32,
        }
    }
    pub use virtual_machine::VirtualMachine as VirtualMachineRef;
}

// ─── un-gated in B-2 (heavy submodules re-gated inside each file) ────────
pub mod crypto;
pub mod server;
pub mod ffi;
pub mod socket;
#[path = "webcore.rs"]
pub mod webcore;
#[path = "node.rs"]
pub mod node;

pub mod bake;
pub mod shell;
pub mod cli;
pub mod napi;
#[path = "api.rs"]
pub mod api;

// Newly declared in B-2 (was in the "unwired" list).
pub mod image {
    #[path = "thumbhash.rs"]
    pub mod thumbhash;
    #[path = "quantize.rs"]
    pub mod quantize;
    #[path = "exif.rs"]
    pub mod exif;
    // Remaining image submodules (codec_*, Image, codecs, backend_*) depend on
    // bun_jsc / FFI sys crates and stay gated.
}

// Additional subdirectories present under src/runtime/ but not yet wired:
// dns_jsc, test_runner, timer, valkey_jsc, webview.
// These remain un-declared (blocked on bun_jsc method surface).

