const WindowsNamedPipeContext = @This();

named_pipe: uws.WindowsNamedPipe,
socket: SocketType,

// task used to deinit the context in the next tick, vm is used to enqueue the task
vm: *jsc.VirtualMachine,
globalThis: *jsc.JSGlobalObject,
task: jsc.AnyTask,
task_event: EventState = .none,
is_open: bool = false,

pub const EventState = enum(u8) {
    deinit,
    none,
};

pub const SocketType = union(enum) {
    tls: *TLSSocket,
    tcp: *TCPSocket,
    none: void,
};

pub const new = bun.TrivialNew(WindowsNamedPipeContext);
const log = Output.scoped(.WindowsNamedPipeContext, .visible);

fn onOpen(this: *WindowsNamedPipeContext) void {
    this.is_open = true;
    switch (this.socket) {
        .tls => |tls| {
            const socket = TLSSocket.Socket.fromNamedPipe(&this.named_pipe);
            tls.onOpen(socket);
        },
        .tcp => |tcp| {
            const socket = TCPSocket.Socket.fromNamedPipe(&this.named_pipe);
            tcp.onOpen(socket);
        },
        .none => {},
    }
}

fn onData(this: *WindowsNamedPipeContext, decoded_data: []const u8) void {
    switch (this.socket) {
        .tls => |tls| {
            const socket = TLSSocket.Socket.fromNamedPipe(&this.named_pipe);
            tls.onData(socket, decoded_data);
        },
        .tcp => |tcp| {
            const socket = TCPSocket.Socket.fromNamedPipe(&this.named_pipe);
            tcp.onData(socket, decoded_data);
        },
        .none => {},
    }
}

fn onHandshake(this: *WindowsNamedPipeContext, success: bool, ssl_error: uws.us_bun_verify_error_t) void {
    switch (this.socket) {
        .tls => |tls| {
            const socket = TLSSocket.Socket.fromNamedPipe(&this.named_pipe);
            tls.onHandshake(socket, @intFromBool(success), ssl_error) catch {};
        },
        .tcp => |tcp| {
            const socket = TCPSocket.Socket.fromNamedPipe(&this.named_pipe);
            tcp.onHandshake(socket, @intFromBool(success), ssl_error) catch {};
        },
        .none => {},
    }
}

fn onEnd(this: *WindowsNamedPipeContext) void {
    switch (this.socket) {
        .tls => |tls| {
            const socket = TLSSocket.Socket.fromNamedPipe(&this.named_pipe);
            tls.onEnd(socket);
        },
        .tcp => |tcp| {
            const socket = TCPSocket.Socket.fromNamedPipe(&this.named_pipe);
            tcp.onEnd(socket);
        },
        .none => {},
    }
}

fn onWritable(this: *WindowsNamedPipeContext) void {
    switch (this.socket) {
        .tls => |tls| {
            const socket = TLSSocket.Socket.fromNamedPipe(&this.named_pipe);
            tls.onWritable(socket);
        },
        .tcp => |tcp| {
            const socket = TCPSocket.Socket.fromNamedPipe(&this.named_pipe);
            tcp.onWritable(socket);
        },
        .none => {},
    }
}

fn onError(this: *WindowsNamedPipeContext, err: bun.sys.Error) void {
    if (this.is_open) {
        switch (this.socket) {
            .tls => |tls| {
                tls.handleError(err.toJS(this.globalThis) catch return);
            },
            .tcp => |tcp| {
                tcp.handleError(err.toJS(this.globalThis) catch return);
            },
            else => {},
        }
    } else {
        switch (this.socket) {
            .tls => |tls| {
                tls.handleConnectError(err.errno) catch {};
            },
            .tcp => |tcp| {
                tcp.handleConnectError(err.errno) catch {};
            },
            else => {},
        }
    }
}

fn onTimeout(this: *WindowsNamedPipeContext) void {
    switch (this.socket) {
        .tls => |tls| {
            const socket = TLSSocket.Socket.fromNamedPipe(&this.named_pipe);
            tls.onTimeout(socket);
        },
        .tcp => |tcp| {
            const socket = TCPSocket.Socket.fromNamedPipe(&this.named_pipe);
            tcp.onTimeout(socket);
        },
        .none => {},
    }
}

fn onClose(this: *WindowsNamedPipeContext) void {
    const socket = this.socket;
    this.socket = .none;
    switch (socket) {
        .tls => |tls| {
            tls.onClose(TLSSocket.Socket.fromNamedPipe(&this.named_pipe), 0, null) catch {};
            tls.deref();
        },
        .tcp => |tcp| {
            tcp.onClose(TCPSocket.Socket.fromNamedPipe(&this.named_pipe), 0, null) catch {};
            tcp.deref();
        },
        .none => {},
    }

    this.deinitInNextTick();
}

fn runEvent(this: *WindowsNamedPipeContext) void {
    switch (this.task_event) {
        .deinit => {
            this.deinit();
        },
        .none => @panic("Invalid event state"),
    }
}

fn deinitInNextTick(this: *WindowsNamedPipeContext) void {
    bun.assert(this.task_event != .deinit);
    this.task_event = .deinit;
    this.vm.enqueueTask(jsc.Task.init(&this.task));
}

pub fn create(globalThis: *jsc.JSGlobalObject, socket: SocketType) *WindowsNamedPipeContext {
    const vm = globalThis.bunVM();
    const this = WindowsNamedPipeContext.new(.{
        .vm = vm,
        .globalThis = globalThis,
        .task = undefined,
        .socket = socket,
        .named_pipe = undefined,
    });

    // named_pipe owns the pipe (PipeWriter owns the pipe and will close and deinit it)
    this.named_pipe = uws.WindowsNamedPipe.from(bun.handleOom(bun.default_allocator.create(uv.Pipe)), .{
        .ctx = this,
        .onOpen = @ptrCast(&WindowsNamedPipeContext.onOpen),
        .onData = @ptrCast(&WindowsNamedPipeContext.onData),
        .onHandshake = @ptrCast(&WindowsNamedPipeContext.onHandshake),
        .onEnd = @ptrCast(&WindowsNamedPipeContext.onEnd),
        .onWritable = @ptrCast(&WindowsNamedPipeContext.onWritable),
        .onError = @ptrCast(&WindowsNamedPipeContext.onError),
        .onTimeout = @ptrCast(&WindowsNamedPipeContext.onTimeout),
        .onClose = @ptrCast(&WindowsNamedPipeContext.onClose),
    }, vm);
    this.task = jsc.AnyTask.New(WindowsNamedPipeContext, WindowsNamedPipeContext.runEvent).init(this);

    switch (socket) {
        .tls => |tls| {
            tls.ref();
        },
        .tcp => |tcp| {
            tcp.ref();
        },
        .none => {},
    }

    return this;
}

pub fn open(globalThis: *jsc.JSGlobalObject, fd: bun.FileDescriptor, ssl_config: ?jsc.API.ServerConfig.SSLConfig, socket: SocketType) !*uws.WindowsNamedPipe {
    // TODO: reuse the same context for multiple connections when possibles

    const this = WindowsNamedPipeContext.create(globalThis, socket);

    errdefer {
        switch (socket) {
            .tls => |tls| {
                tls.handleConnectError(@intFromEnum(bun.sys.SystemErrno.ENOENT)) catch {};
            },
            .tcp => |tcp| {
                tcp.handleConnectError(@intFromEnum(bun.sys.SystemErrno.ENOENT)) catch {};
            },
            .none => {},
        }
        this.deinitInNextTick();
    }
    try this.named_pipe.open(fd, ssl_config).unwrap();
    return &this.named_pipe;
}

pub fn connect(globalThis: *jsc.JSGlobalObject, path: []const u8, ssl_config: ?jsc.API.ServerConfig.SSLConfig, socket: SocketType) !*uws.WindowsNamedPipe {
    // TODO: reuse the same context for multiple connections when possibles

    const this = WindowsNamedPipeContext.create(globalThis, socket);
    errdefer {
        switch (socket) {
            .tls => |tls| {
                tls.handleConnectError(@intFromEnum(bun.sys.SystemErrno.ENOENT)) catch {};
            },
            .tcp => |tcp| {
                tcp.handleConnectError(@intFromEnum(bun.sys.SystemErrno.ENOENT)) catch {};
            },
            .none => {},
        }
        this.deinitInNextTick();
    }

    if (path[path.len - 1] == 0) {
        // is already null terminated
        const slice_z = path[0 .. path.len - 1 :0];
        try this.named_pipe.connect(slice_z, ssl_config).unwrap();
    } else {
        var path_buf: bun.PathBuffer = undefined;
        // we need to null terminate the path
        const len = @min(path.len, path_buf.len - 1);

        @memcpy(path_buf[0..len], path[0..len]);
        path_buf[len] = 0;
        const slice_z = path_buf[0..len :0];
        try this.named_pipe.connect(slice_z, ssl_config).unwrap();
    }
    return &this.named_pipe;
}

pub fn deinit(this: *WindowsNamedPipeContext) void {
    log("deinit", .{});
    const socket = this.socket;
    this.socket = .none;
    switch (socket) {
        .tls => |tls| {
            tls.deref();
        },
        .tcp => |tcp| {
            tcp.deref();
        },
        else => {},
    }

    this.named_pipe.deinit();
    bun.destroy(this);
}

const bun = @import("bun");
const Output = bun.Output;
const jsc = bun.jsc;
const uws = bun.uws;
const uv = bun.windows.libuv;

const TCPSocket = jsc.API.TCPSocket;
const TLSSocket = jsc.API.TLSSocket;
