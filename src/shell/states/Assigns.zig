/// In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
/// no effect on the environment of the shell, so we can skip them.
pub const Assigns = @This();

base: State,
node: []const ast.Assign,
parent: ParentPtr,
state: union(enum) {
    idle,
    expanding: struct {
        idx: u32 = 0,
        current_expansion_result: std.ArrayList([:0]const u8),
        expansion: Expansion,
    },
    err: bun.shell.ShellErr,
    done,
},
ctx: AssignCtx,
io: IO,

pub const ParentPtr = StatePtrUnion(.{
    Stmt,
    Binary,
    Cmd,
    Pipeline,
});

pub const ChildPtr = StatePtrUnion(.{
    Expansion,
});

pub inline fn deinit(this: *Assigns) void {
    if (this.state == .expanding) {
        this.state.expanding.current_expansion_result.deinit();
    }
    this.io.deinit();
}

pub inline fn start(this: *Assigns) void {
    return this.next();
}

pub fn init(
    this: *Assigns,
    interpreter: *Interpreter,
    shell_state: *ShellState,
    node: []const ast.Assign,
    ctx: AssignCtx,
    parent: ParentPtr,
    io: IO,
) void {
    this.* = .{
        .base = .{ .kind = .assign, .interpreter = interpreter, .shell = shell_state },
        .node = node,
        .parent = parent,
        .state = .idle,
        .ctx = ctx,
        .io = io,
    };
}

pub fn next(this: *Assigns) void {
    while (!(this.state == .done)) {
        switch (this.state) {
            .idle => {
                this.state = .{ .expanding = .{
                    .current_expansion_result = std.ArrayList([:0]const u8).init(bun.default_allocator),
                    .expansion = undefined,
                } };
                continue;
            },
            .expanding => {
                if (this.state.expanding.idx >= this.node.len) {
                    this.state = .done;
                    continue;
                }

                Expansion.init(
                    this.base.interpreter,
                    this.base.shell,
                    &this.state.expanding.expansion,
                    &this.node[this.state.expanding.idx].value,
                    Expansion.ParentPtr.init(this),
                    .{
                        .array_of_slice = &this.state.expanding.current_expansion_result,
                    },
                    this.io.copy(),
                );
                this.state.expanding.expansion.start();
                return;
            },
            .done => unreachable,
            .err => return this.parent.childDone(this, 1),
        }
    }

    this.parent.childDone(this, 0);
}

pub fn childDone(this: *Assigns, child: ChildPtr, exit_code: ExitCode) void {
    if (child.ptr.is(Expansion)) {
        const expansion = child.ptr.as(Expansion);
        if (exit_code != 0) {
            this.state = .{
                .err = expansion.state.err,
            };
            expansion.deinit();
            return;
        }
        var expanding = &this.state.expanding;

        const label = this.node[expanding.idx].label;

        if (expanding.current_expansion_result.items.len == 1) {
            const value = expanding.current_expansion_result.items[0];
            const ref = EnvStr.initRefCounted(value);
            defer ref.deref();
            this.base.shell.assignVar(this.base.interpreter, EnvStr.initSlice(label), ref, this.ctx);
            expanding.current_expansion_result = std.ArrayList([:0]const u8).init(bun.default_allocator);
        } else {
            const size = brk: {
                var total: usize = 0;
                const last = expanding.current_expansion_result.items.len -| 1;
                for (expanding.current_expansion_result.items, 0..) |slice, i| {
                    total += slice.len;
                    if (i != last) {
                        // for space
                        total += 1;
                    }
                }
                break :brk total;
            };

            const value = brk: {
                var merged = bun.default_allocator.allocSentinel(u8, size, 0) catch bun.outOfMemory();
                var i: usize = 0;
                const last = expanding.current_expansion_result.items.len -| 1;
                for (expanding.current_expansion_result.items, 0..) |slice, j| {
                    @memcpy(merged[i .. i + slice.len], slice[0..slice.len]);
                    i += slice.len;
                    if (j != last) {
                        merged[i] = ' ';
                        i += 1;
                    }
                }
                break :brk merged;
            };
            const value_ref = EnvStr.initRefCounted(value);
            defer value_ref.deref();

            this.base.shell.assignVar(this.base.interpreter, EnvStr.initSlice(label), value_ref, this.ctx);
            for (expanding.current_expansion_result.items) |slice| {
                bun.default_allocator.free(slice);
            }
            expanding.current_expansion_result.clearRetainingCapacity();
        }

        expanding.idx += 1;
        expansion.deinit();
        this.next();
        return;
    }

    @panic("Invalid child to Assigns expression, this indicates a bug in Bun. Please file a report on Github.");
}

pub const AssignCtx = enum {
    cmd,
    shell,
    exported,
};

const std = @import("std");
const bun = @import("bun");

const Allocator = std.mem.Allocator;

const Interpreter = bun.shell.Interpreter;
const InterpreterChildPtr = Interpreter.InterpreterChildPtr;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const ast = bun.shell.AST;
const ExitCode = bun.shell.ExitCode;
const GlobWalker = bun.shell.interpret.GlobWalker;
const ShellState = Interpreter.ShellState;
const StateKind = bun.shell.interpret.StateKind;
const State = bun.shell.Interpreter.State;
const throwShellErr = bun.shell.interpret.throwShellErr;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;
const EnvStr = bun.shell.interpret.EnvStr;

const Cmd = bun.shell.Interpreter.Cmd;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Subshell = bun.shell.Interpreter.Subshell;
const Expansion = bun.shell.Interpreter.Expansion;
const Stmt = bun.shell.Interpreter.Stmt;
const Binary = bun.shell.Interpreter.Binary;
const Pipeline = bun.shell.Interpreter.Pipeline;

const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const Maybe = JSC.Maybe;
const assert = bun.assert;
const Arena = bun.shell.interpret.Arena;
const Braces = bun.shell.interpret.Braces;
const OOM = bun.shell.interpret.OOM;
const WorkPoolTask = bun.shell.interpret.WorkPoolTask;
const WorkPool = bun.shell.interpret.WorkPool;
const Syscall = bun.shell.interpret.Syscall;
