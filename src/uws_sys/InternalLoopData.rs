use core::ffi::{c_char, c_int, c_void};

use crate::{udp, us_socket_t, ConnectingSocket, Loop, SocketGroup, Timer};
use bun_jsc::{self as jsc, EventLoopHandle, VM};

/// Opaque C handle from `us_internal_create_async`.
#[repr(C)]
pub struct us_internal_async {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

#[repr(C)]
pub struct InternalLoopData {
    pub sweep_timer: *mut Timer,
    pub sweep_timer_count: i32,
    pub wakeup_async: *mut us_internal_async,
    pub head: *mut SocketGroup,
    pub quic_head: *mut c_void,
    pub quic_next_tick_us: i64,
    pub quic_timer: *mut Timer,
    pub iterator: *mut SocketGroup,
    pub recv_buf: *mut u8,
    pub send_buf: *mut u8,
    pub ssl_data: *mut c_void,
    pub pre_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub post_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub closed_udp_head: *mut udp::Socket,
    pub closed_head: *mut us_socket_t,
    pub low_prio_head: *mut us_socket_t,
    pub low_prio_budget: i32,
    pub dns_ready_head: *mut ConnectingSocket,
    pub closed_connecting_head: *mut ConnectingSocket,
    // TODO(port): verify bun_threading::Mutex matches `bun.Mutex.ReleaseImpl.Type` C layout
    pub mutex: bun_threading::Mutex,
    pub parent_ptr: *mut c_void,
    pub parent_tag: c_char,
    pub iteration_nr: usize,
    // TODO(port): lifetime — LIFETIMES.tsv says JSC_BORROW `Option<&VM>`; using 'static to avoid
    // a struct lifetime param on this #[repr(C)] mirror of C `struct us_internal_loop_data_t`.
    pub jsc_vm: Option<&'static VM>,
    pub tick_depth: c_int,
}

impl InternalLoopData {
    const LIBUS_RECV_BUFFER_LENGTH: usize = 524288;

    pub fn recv_slice(&mut self) -> &mut [u8] {
        // SAFETY: `recv_buf` is malloc'd by C `us_internal_loop_data_init` with at least
        // LIBUS_RECV_BUFFER_LENGTH bytes and lives as long as the loop.
        unsafe { core::slice::from_raw_parts_mut(self.recv_buf, Self::LIBUS_RECV_BUFFER_LENGTH) }
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count > 0
    }

    pub fn set_parent_event_loop(&mut self, parent: EventLoopHandle) {
        match parent {
            EventLoopHandle::Js(ptr) => {
                self.parent_tag = 1;
                self.parent_ptr = ptr as *mut jsc::EventLoop as *mut c_void;
            }
            EventLoopHandle::Mini(ptr) => {
                self.parent_tag = 2;
                self.parent_ptr = ptr as *mut jsc::MiniEventLoop as *mut c_void;
            }
        }
    }

    pub fn get_parent(&self) -> EventLoopHandle {
        let parent = if self.parent_ptr.is_null() {
            panic!("Parent loop not set - pointer is null");
        } else {
            self.parent_ptr
        };
        match self.parent_tag {
            0 => panic!("Parent loop not set - tag is zero"),
            // SAFETY: tag 1 was set alongside a *mut jsc::EventLoop in set_parent_event_loop;
            // pointer is non-null (checked above) and outlives this loop data.
            1 => EventLoopHandle::Js(unsafe { &mut *parent.cast::<jsc::EventLoop>() }),
            // SAFETY: tag 2 was set alongside a *mut jsc::MiniEventLoop in set_parent_event_loop;
            // pointer is non-null (checked above) and outlives this loop data.
            2 => EventLoopHandle::Mini(unsafe { &mut *parent.cast::<jsc::MiniEventLoop>() }),
            _ => panic!("Parent loop data corrupted - tag is invalid"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/InternalLoopData.zig (73 lines)
//   confidence: medium
//   todos:      2
//   notes:      #[repr(C)] mirror of C us_internal_loop_data_t; mutex field type and EventLoopHandle variant payload shapes need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
