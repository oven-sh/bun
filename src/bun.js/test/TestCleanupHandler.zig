const std = @import("std");
const bun = @import("root").bun;
const default_allocator = bun.default_allocator;
const string = bun.string;
const MutableString = bun.MutableString;
const strings = bun.strings;
const Output = bun.Output;
const jest = bun.JSC.Jest;
const Jest = jest.Jest;
const TestRunner = jest.TestRunner;
const DescribeScope = jest.DescribeScope;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSType = JSValue.JSType;
const JSError = JSC.JSError;
const JSObject = JSC.JSObject;
const CallFrame = JSC.CallFrame;
const ZigString = JSC.ZigString;
const Environment = bun.Environment;

const Cleanable = packed struct {
    ptr: Type = Type.Null,

    pub fn init(ptr: anytype) Cleanable {
        return Cleanable{ .ptr = Type.init(ptr) };
    }

    const Subprocess = bun.JSC.Subprocess;
    const TLSSocket = bun.JSC.API.TLSSocket;
    const TCPSocket = bun.JSC.API.TCPSocket;
    const Listener = bun.JSC.API.Listener;
    const HTTPServer = JSC.API.HTTPServer;
    const HTTPSServer = JSC.API.HTTPSServer;
    const DebugHTTPServer = JSC.API.DebugHTTPServer;
    const DebugHTTPSServer = JSC.API.DebugHTTPSServer;
    const ShellSubprocess = bun.shell.ShellSubprocess;

    pub const Type = bun.TaggedPointerUnion(.{
        Subprocess,
        TLSSocket,
        TCPSocket,
        Listener,
        HTTPServer,
        HTTPSServer,
        DebugHTTPServer,
        DebugHTTPSServer,
        ShellSubprocess,
    });
    const Tag = Type.Tag;
    const name = bun.meta.typeName;

    pub fn run(this: Cleanable, vm: *JSC.VirtualMachine) void {
        switch (this.ptr.tag()) {
            inline @field(Tag, name(Subprocess)),
            @field(Tag, name(TLSSocket)),
            @field(Tag, name(TCPSocket)),
            @field(Tag, name(Listener)),
            @field(Tag, name(HTTPServer)),
            @field(Tag, name(HTTPSServer)),
            @field(Tag, name(DebugHTTPServer)),
            @field(Tag, name(DebugHTTPSServer)),
            @field(Tag, name(ShellSubprocess)),
            => |tag| {
                this.ptr.as(
                    Type.typeFromTag(
                        @intFromEnum(
                            @field(
                                Tag,
                                @tagName(tag),
                            ),
                        ),
                    ),
                ).onCleanup(vm);
            },
            else => {
                bun.assert(false);
            },
        }
    }
};

pub const TestCleanupHandler = struct {
    cleanables: std.AutoArrayHashMapUnmanaged(Cleanable, u32) = .{},
    generation: u32 = 0,
    state: State = .none,

    const State = enum {
        none,
        waiting,
        running,
    };

    pub usingnamespace bun.New(@This());

    pub fn add(this: *TestCleanupHandler, ptr: anytype) void {
        _ = this.cleanables.getOrPutValue(bun.default_allocator, Cleanable.init(ptr), this.generation) catch bun.outOfMemory();
    }

    pub fn remove(this: *TestCleanupHandler, ptr: anytype) void {
        const cleanable = Cleanable.init(ptr);
        _ = this.cleanables.swapRemove(cleanable);
    }

    pub fn runAllAfter(this: *TestCleanupHandler, target: u32, vm: *JSC.VirtualMachine) void {
        vm.test_cleaner = null;
        const cleanables = this.cleanables.keys();
        const generations = this.cleanables.values();
        var i: usize = 0;
        for (generations, cleanables, 0..) |gen, cleanable, idx| {
            if (target <= gen) {
                cleanable.run(vm);
            } else {
                i = idx;
            }
        }

        this.cleanables.shrinkRetainingCapacity(i);
    }

    pub fn runAll(this: *TestCleanupHandler, vm: *JSC.VirtualMachine) void {
        const cleanables = this.cleanables;
        this.cleanables = .{};
        const ptrs = cleanables.keys();
        for (ptrs) |cleanable| {
            cleanable.run(vm);
        }
    }

    pub fn run(this: *TestCleanupHandler, expected_generation: u32, vm: *JSC.VirtualMachine) void {
        bun.assert(this.state != .running); // must not be re-entrant.
        this.state = .running;
        const cleanables = this.cleanables.keys();
        const generations = this.cleanables.values();

        var has_any_from_other_generations = false;
        var i: usize = 0;
        var last_i: usize = 0;
        while (i < this.cleanables.count()) {
            const generation = generations[i];
            if (generation != expected_generation) {
                has_any_from_other_generations = true;
                i += 1;
                last_i = i;
                continue;
            }

            cleanables[i].run(vm);

            i += 1;
        }

        this.cleanables.shrinkRetainingCapacity(last_i);
    }

    pub fn beginCycle(this: *TestCleanupHandler, vm: *JSC.VirtualMachine) u32 {
        bun.assert(this.state != .running);
        this.state = .waiting;
        vm.test_cleaner = this;
        return this.generation;
    }

    pub fn endCycle(this: *TestCleanupHandler, generation: u32, vm: *JSC.VirtualMachine) void {
        vm.test_cleaner = null;
        this.run(generation, vm);
        this.state = .none;
        if (generation == this.generation)
            this.generation +%= 1;
    }
};
