/// A non-owning reference to either the JS event loop or the mini event loop.
pub const EventLoopHandle = union(EventLoopKind) {
    js: *jsc.EventLoop,
    mini: *MiniEventLoop,

    pub fn globalObject(this: EventLoopHandle) ?*jsc.JSGlobalObject {
        return switch (this) {
            .js => this.js.global,
            .mini => null,
        };
    }

    pub fn stdout(this: EventLoopHandle) *jsc.WebCore.Blob.Store {
        return switch (this) {
            .js => this.js.virtual_machine.rareData().stdout(),
            .mini => this.mini.stdout(),
        };
    }

    pub fn bunVM(this: EventLoopHandle) ?*VirtualMachine {
        if (this == .js) {
            return this.js.virtual_machine;
        }

        return null;
    }

    pub fn stderr(this: EventLoopHandle) *jsc.WebCore.Blob.Store {
        return switch (this) {
            .js => this.js.virtual_machine.rareData().stderr(),
            .mini => this.mini.stderr(),
        };
    }

    pub fn cast(this: EventLoopHandle, comptime tag: EventLoopKind) tag.Type() {
        return @field(this, @tagName(tag));
    }

    pub fn enter(this: EventLoopHandle) void {
        switch (this) {
            .js => this.js.enter(),
            .mini => {},
        }
    }

    pub fn exit(this: EventLoopHandle) void {
        switch (this) {
            .js => this.js.exit(),
            .mini => {},
        }
    }

    pub fn init(context: anytype) EventLoopHandle {
        const Context = @TypeOf(context);
        return switch (Context) {
            *VirtualMachine => .{ .js = context.eventLoop() },
            *jsc.EventLoop => .{ .js = context },
            *jsc.MiniEventLoop => .{ .mini = context },
            *AnyEventLoop => switch (context.*) {
                .js => .{ .js = context.js },
                .mini => .{ .mini = &context.mini },
            },
            EventLoopHandle => context,
            else => @compileError("Invalid context type for EventLoopHandle.init " ++ @typeName(Context)),
        };
    }

    pub fn filePolls(this: EventLoopHandle) *bun.Async.FilePoll.Store {
        return switch (this) {
            .js => this.js.virtual_machine.rareData().filePolls(this.js.virtual_machine),
            .mini => this.mini.filePolls(),
        };
    }

    pub fn putFilePoll(this: *EventLoopHandle, poll: *Async.FilePoll) void {
        switch (this.*) {
            .js => this.js.virtual_machine.rareData().filePolls(this.js.virtual_machine).put(poll, this.js.virtual_machine, poll.flags.contains(.was_ever_registered)),
            .mini => this.mini.filePolls().put(poll, &this.mini, poll.flags.contains(.was_ever_registered)),
        }
    }

    pub fn enqueueTaskConcurrent(this: EventLoopHandle, context: EventLoopTaskPtr) void {
        switch (this) {
            .js => {
                this.js.enqueueTaskConcurrent(context.js);
            },
            .mini => {
                this.mini.enqueueTaskConcurrent(context.mini);
            },
        }
    }

    pub fn loop(this: EventLoopHandle) *bun.uws.Loop {
        return switch (this) {
            .js => this.js.usocketsLoop(),
            .mini => this.mini.loop,
        };
    }

    pub fn pipeReadBuffer(this: EventLoopHandle) []u8 {
        return switch (this) {
            .js => this.js.pipeReadBuffer(),
            .mini => this.mini.pipeReadBuffer(),
        };
    }

    pub const platformEventLoop = loop;

    pub fn ref(this: EventLoopHandle) void {
        this.loop().ref();
    }

    pub fn unref(this: EventLoopHandle) void {
        this.loop().unref();
    }

    pub inline fn createNullDelimitedEnvMap(this: @This(), alloc: Allocator) ![:null]?[*:0]const u8 {
        return switch (this) {
            .js => this.js.virtual_machine.transpiler.env.map.createNullDelimitedEnvMap(alloc),
            .mini => this.mini.env.?.map.createNullDelimitedEnvMap(alloc),
        };
    }

    pub inline fn allocator(this: EventLoopHandle) Allocator {
        return switch (this) {
            .js => this.js.virtual_machine.allocator,
            .mini => this.mini.allocator,
        };
    }

    pub inline fn topLevelDir(this: EventLoopHandle) []const u8 {
        return switch (this) {
            .js => this.js.virtual_machine.transpiler.fs.top_level_dir,
            .mini => this.mini.top_level_dir,
        };
    }

    pub inline fn env(this: EventLoopHandle) *bun.DotEnv.Loader {
        return switch (this) {
            .js => this.js.virtual_machine.transpiler.env,
            .mini => this.mini.env.?,
        };
    }
};

pub const EventLoopTask = union(EventLoopKind) {
    js: jsc.ConcurrentTask,
    mini: jsc.AnyTaskWithExtraContext,

    pub fn init(kind: EventLoopKind) EventLoopTask {
        switch (kind) {
            .js => return .{ .js = .{} },
            .mini => return .{ .mini = .{} },
        }
    }

    pub fn fromEventLoop(loop: jsc.EventLoopHandle) EventLoopTask {
        switch (loop) {
            .js => return .{ .js = .{} },
            .mini => return .{ .mini = .{} },
        }
    }
};

pub const EventLoopTaskPtr = union {
    js: *jsc.ConcurrentTask,
    mini: *jsc.AnyTaskWithExtraContext,
};

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Async = bun.Async;

const jsc = bun.jsc;
const AnyEventLoop = jsc.AnyEventLoop;
const EventLoopKind = jsc.EventLoopKind;
const MiniEventLoop = jsc.MiniEventLoop;
const VirtualMachine = jsc.VirtualMachine;
