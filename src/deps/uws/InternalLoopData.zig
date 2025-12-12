pub const InternalLoopData = extern struct {
    pub const us_internal_async = opaque {};

    sweep_timer: ?*Timer,
    sweep_timer_count: i32,
    wakeup_async: ?*us_internal_async,
    head: ?*SocketContext,
    iterator: ?*SocketContext,
    closed_context_head: ?*SocketContext,
    recv_buf: [*]u8,
    send_buf: [*]u8,
    ssl_data: ?*anyopaque,
    pre_cb: ?*fn (?*Loop) callconv(.c) void,
    post_cb: ?*fn (?*Loop) callconv(.c) void,
    closed_udp_head: ?*udp.Socket,
    closed_head: ?*us_socket_t,
    low_prio_head: ?*us_socket_t,
    low_prio_budget: i32,
    dns_ready_head: *ConnectingSocket,
    closed_connecting_head: *ConnectingSocket,
    mutex: bun.Mutex.ReleaseImpl.Type,
    parent_ptr: ?*anyopaque,
    parent_tag: c_char,
    iteration_nr: usize,
    jsc_vm: ?*jsc.VM,

    pub fn recvSlice(this: *InternalLoopData) []u8 {
        return this.recv_buf[0..LIBUS_RECV_BUFFER_LENGTH];
    }

    pub fn shouldEnableDateHeaderTimer(this: *const InternalLoopData) bool {
        return this.sweep_timer_count > 0;
    }

    pub fn setParentEventLoop(this: *InternalLoopData, parent: jsc.EventLoopHandle) void {
        switch (parent) {
            .js => |ptr| {
                this.parent_tag = 1;
                this.parent_ptr = ptr;
            },
            .mini => |ptr| {
                this.parent_tag = 2;
                this.parent_ptr = ptr;
            },
        }
    }

    pub fn getParent(this: *InternalLoopData) jsc.EventLoopHandle {
        const parent = this.parent_ptr orelse @panic("Parent loop not set - pointer is null");
        return switch (this.parent_tag) {
            0 => @panic("Parent loop not set - tag is zero"),
            1 => .{ .js = bun.cast(*jsc.EventLoop, parent) },
            2 => .{ .mini = bun.cast(*jsc.MiniEventLoop, parent) },
            else => @panic("Parent loop data corrupted - tag is invalid"),
        };
    }

    const LIBUS_RECV_BUFFER_LENGTH = 524288;
};

const bun = @import("bun");
const jsc = bun.jsc;

const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const Loop = uws.Loop;
const SocketContext = uws.SocketContext;
const Timer = uws.Timer;
const udp = uws.udp;
const us_socket_t = uws.us_socket_t;
