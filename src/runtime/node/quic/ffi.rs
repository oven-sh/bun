use core::ffi::c_void;

/// SAFETY CONTRACT (the single audited deref for every `node:quic` callback):
///
/// * Every context pointer the shim hands back — the engine's `owner`
///   (`ea_stream_if_ctx` / `peer_ctx`), a conn-ctx, or a stream-ctx — is a
///   pointer we ourselves installed: a `bun_core::heap::into_raw` allocation of
///   `QuicEndpoint`, `QuicSession`, or `QuicStream`, whose first field is the
///   `*const NqVtable` that `packages/bun-usockets/src/node_quic_shim.c` reads
///   back via `*(us_nq_vtable**)ctx`. Those structs are `#[repr(C)]` precisely
///   so that first-field read stays valid, and the shim never invents or
///   offsets a context pointer.
/// * The only other value the shim can pass is NULL — teardown clears the
///   conn/stream ctx (and lsquic passes NULL for crypto/mini-conn streams that
///   never got one), so a null check is the whole liveness test. A non-null
///   ctx is a live `T`: the owning JS wrapper keeps the allocation alive until
///   after the engine that could call us is destroyed.
/// * lsquic only calls into us from `process_conns`/`packet_in` on the JS
///   thread, so the returned `&T` cannot race another thread, and every
///   mutable field of these types is `Cell`-based (shared-ref interior
///   mutability), so `&T` is the right reference to hand the callback body.
///
/// The caller must not hold the returned reference past the callback.
pub(crate) unsafe fn ctx_ref<'a, T>(ctx: *mut c_void) -> Option<&'a T> {
    if ctx.is_null() {
        return None;
    }
    // SAFETY: per the contract above, a non-null ctx is a live `T` we
    // installed, and we are on the JS thread that owns it.
    Some(unsafe { &*ctx.cast::<T>() })
}

macro_rules! lsquic_callback {
    () => {};

    (
        $(#[$meta:meta])*
        $vis:vis fn $name:ident(
            $ctx:ident: *mut c_void as $r:ident: &$ty:ty $(, $arg:ident: $argty:ty)* $(,)?
        ) -> $ret:ty = $default:expr; $body:block
        $($rest:tt)*
    ) => {
        $(#[$meta])*
        $vis unsafe extern "C" fn $name(
            $ctx: *mut ::core::ffi::c_void $(, $arg: $argty)*
        ) -> $ret {
            // SAFETY: `ctx_ref` documents the shim's context-pointer contract.
            let Some($r) = (unsafe { $crate::node::quic::ffi::ctx_ref::<$ty>($ctx) }) else {
                return $default;
            };
            $body
        }
        lsquic_callback! { $($rest)* }
    };

    (
        $(#[$meta:meta])*
        $vis:vis fn $name:ident(
            $ctx:ident: *mut c_void as $r:ident: &$ty:ty $(, $arg:ident: $argty:ty)* $(,)?
        ) $body:block
        $($rest:tt)*
    ) => {
        $(#[$meta])*
        $vis unsafe extern "C" fn $name($ctx: *mut ::core::ffi::c_void $(, $arg: $argty)*) {
            // SAFETY: `ctx_ref` documents the shim's context-pointer contract.
            let Some($r) = (unsafe { $crate::node::quic::ffi::ctx_ref::<$ty>($ctx) }) else {
                return;
            };
            $body
        }
        lsquic_callback! { $($rest)* }
    };

    (
        $(#[$meta:meta])*
        $vis:vis fn $name:ident(
            $r:ident: &$ty:ty $(, $arg:ident: $argty:ty)* $(,)?
        ) -> $ret:ty = $default:expr; $body:block
        $($rest:tt)*
    ) => {
        lsquic_callback! {
            $(#[$meta])*
            $vis fn $name(ctx: *mut c_void as $r: &$ty $(, $arg: $argty)*) -> $ret = $default; $body
        }
        lsquic_callback! { $($rest)* }
    };

    (
        $(#[$meta:meta])*
        $vis:vis fn $name:ident(
            $r:ident: &$ty:ty $(, $arg:ident: $argty:ty)* $(,)?
        ) $body:block
        $($rest:tt)*
    ) => {
        lsquic_callback! {
            $(#[$meta])*
            $vis fn $name(ctx: *mut c_void as $r: &$ty $(, $arg: $argty)*) $body
        }
        lsquic_callback! { $($rest)* }
    };
}

pub(super) use lsquic_callback;
