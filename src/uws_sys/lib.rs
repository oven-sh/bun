#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// B-1: gate Phase-A draft modules; expose opaque FFI handles only.
// Full bodies preserved on disk for B-2.
#[cfg(any())] pub mod quic;
#[cfg(any())] pub mod Timer;
#[cfg(any())] pub mod ConnectingSocket;
#[cfg(any())] pub mod BodyReaderMixin;
#[cfg(any())] pub mod SocketKind;
#[cfg(any())] pub mod udp;
#[cfg(any())] pub mod SocketGroup;
#[cfg(any())] pub mod WebSocket;
#[cfg(any())] pub mod us_socket_t;
#[cfg(any())] pub mod Loop;
#[cfg(any())] pub mod Response;
#[cfg(any())] pub mod App;
#[cfg(any())] pub mod InternalLoopData;
#[cfg(any())] pub mod ListenSocket;
#[cfg(any())] pub mod Request;
#[cfg(any())] pub mod SocketContext;
#[cfg(any())] pub mod h3;
#[cfg(any())] pub mod socket;

#[cfg(any())] pub mod vtable;
pub mod vtable_stub {
    pub struct VTable; // B-2: real socket dispatch vtable
}
pub use vtable_stub as vtable;

// Opaque FFI handles (Nomicon pattern) — what higher tiers actually need.
macro_rules! opaque {
    ($($name:ident),+ $(,)?) => {$(
        #[repr(C)] pub struct $name { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
    )+};
}
opaque!(us_socket_t, us_socket_context_t, us_loop_t, us_timer_t, us_listen_socket_t,
        uws_app_t, uws_req_t, uws_res_t, us_udp_socket_t, us_udp_packet_buffer_t,
        ConnectingSocket, us_bun_verify_error_t);

pub type Loop = us_loop_t;
pub type Socket = us_socket_t;
pub type SocketContext = us_socket_context_t;
pub type Timer = us_timer_t;
pub type ListenSocket = us_listen_socket_t;
pub type Request = uws_req_t;
pub type WindowsLoop = us_loop_t; // unified on libuv

pub mod udp { pub use super::{us_udp_socket_t as Socket, us_udp_packet_buffer_t as PacketBuffer}; }
