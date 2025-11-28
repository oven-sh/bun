//! This state node is used for expansions.
//!
//! If a word contains command substitution or glob expansion syntax then it
//! needs to do IO, so we have to keep track of the state for that.
//!
//! TODO PERF: in the case of expanding cmd args, we probably want to use the spawn args arena
//! otherwise the interpreter allocator
pub const Expansion = @This();

base: State,
node: *const ast.Atom,
parent: ParentPtr,
io: IO,

word_idx: u32,
current_out: std.array_list.Managed(u8),
state: union(enum) {
    normal,
    braces,
    glob,
    done,
    err: bun.shell.ShellErr,
},
child_state: union(enum) {
    idle,
    cmd_subst: struct {
        cmd: *Script,
        quoted: bool = false,
    },
    // TODO
    glob: struct {
        initialized: bool = false,
        walker: GlobWalker,
    },
},
out_exit_code: ExitCode = 0,
out: Result,
out_idx: u32,

pub const ParentPtr = StatePtrUnion(.{
    Cmd,
    Assigns,
    CondExpr,
    Subshell,
});

pub const ChildPtr = StatePtrUnion(.{
    // Cmd,
    Script,
});

pub const Result = union(enum) {
    array_of_slice: *std.array_list.Managed([:0]const u8),
    array_of_ptr: *std.array_list.Managed(?[*:0]const u8),
    single: struct {
        list: *std.array_list.Managed(u8),
        done: bool = false,
    },

    const PushAction = enum {
        /// We just copied the buf into the result, caller can just do
        /// `.clearRetainingCapacity()`
        copied,
        /// We took ownershipo of the result and placed the pointer in the buf,
        /// caller should remove any references to the underlying data.
        moved,
    };

    pub fn pushResultSliceOwned(this: *Result, buf: [:0]const u8) PushAction {
        if (comptime bun.Environment.allow_assert) {
            assert(buf[buf.len] == 0);
        }

        switch (this.*) {
            .array_of_slice => {
                bun.handleOom(this.array_of_slice.append(buf));
                return .moved;
            },
            .array_of_ptr => {
                bun.handleOom(this.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.ptr))));
                return .moved;
            },
            .single => {
                if (this.single.done) return .copied;
                bun.handleOom(this.single.list.appendSlice(buf[0 .. buf.len + 1]));
                this.single.done = true;
                return .copied;
            },
        }
    }

    pub fn pushResult(this: *Result, buf: *std.array_list.Managed(u8)) PushAction {
        if (comptime bun.Environment.allow_assert) {
            assert(buf.items[buf.items.len - 1] == 0);
        }

        switch (this.*) {
            .array_of_slice => {
                bun.handleOom(this.array_of_slice.append(buf.items[0 .. buf.items.len - 1 :0]));
                return .moved;
            },
            .array_of_ptr => {
                bun.handleOom(this.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.items.ptr))));
                return .moved;
            },
            .single => {
                if (this.single.done) return .copied;
                bun.handleOom(this.single.list.appendSlice(buf.items[0..]));
                return .copied;
            },
        }
    }
};

pub fn format(this: *const Expansion, writer: *std.Io.Writer) !void {
    try writer.print("Expansion(0x{x})", .{@intFromPtr(this)});
}

pub fn allocator(this: *Expansion) std.mem.Allocator {
    return this.base.allocator();
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellExecEnv,
    expansion: *Expansion,
    node: *const ast.Atom,
    parent: ParentPtr,
    out_result: Result,
    io: IO,
) void {
    log("Expansion(0x{x}) init", .{@intFromPtr(expansion)});
    expansion.* = .{
        .node = node,
        .base = State.initBorrowedAllocScope(.expansion, interpreter, shell_state, parent.scopedAllocator()),
        .parent = parent,

        .word_idx = 0,
        .state = .normal,
        .child_state = .idle,
        .out = out_result,
        .out_idx = 0,
        .current_out = undefined,
        .io = io,
    };
    expansion.current_out = std.array_list.Managed(u8).init(expansion.base.allocator());
}

pub fn deinit(expansion: *Expansion) void {
    log("Expansion(0x{x}) deinit", .{@intFromPtr(expansion)});
    expansion.current_out.deinit();
    expansion.io.deinit();
    expansion.base.endScope();
}

pub fn start(this: *Expansion) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.child_state == .idle);
        assert(this.word_idx == 0);
    }

    this.state = .normal;
    return .{ .expansion = this };
}

pub fn next(this: *Expansion) Yield {
    while (!(this.state == .done or this.state == .err)) {
        switch (this.state) {
            .normal => {
                // initialize
                if (this.word_idx == 0) {
                    var has_unknown = false;
                    // + 1 for sentinel
                    const string_size = this.expansionSizeHint(this.node, &has_unknown);
                    bun.handleOom(this.current_out.ensureUnusedCapacity(string_size + 1));
                }

                while (this.word_idx < this.node.atomsLen()) {
                    if (this.expandVarAndCmdSubst(this.word_idx)) |yield| return yield;
                }

                if (this.word_idx >= this.node.atomsLen()) {
                    if (this.node.hasTildeExpansion() and this.node.atomsLen() > 1) {
                        const homedir = this.base.shell.getHomedir();
                        defer homedir.deref();
                        if (this.current_out.items.len > 0) {
                            switch (this.current_out.items[0]) {
                                '/', '\\' => {
                                    bun.handleOom(this.current_out.insertSlice(0, homedir.slice()));
                                },
                                else => {
                                    // TODO: Handle username
                                    bun.handleOom(this.current_out.insert(0, '~'));
                                },
                            }
                        }
                    }

                    // NOTE brace expansion + cmd subst has weird behaviour we don't support yet, ex:
                    // echo $(echo a b c){1,2,3}
                    // >> a b c1 a b c2 a b c3
                    if (this.node.has_brace_expansion()) {
                        this.state = .braces;
                        continue;
                    }

                    if (this.node.has_glob_expansion()) {
                        this.state = .glob;
                        continue;
                    }

                    this.pushCurrentOut();
                    this.state = .done;
                    continue;
                }

                // Shouldn't fall through to here
                assert(this.word_idx >= this.node.atomsLen());
                return .suspended;
            },
            .braces => {
                var arena = Arena.init(this.base.allocator());
                defer arena.deinit();
                const arena_allocator = arena.allocator();
                const brace_str = this.current_out.items[0..];
                var lexer_output = if (bun.strings.isAllASCII(brace_str)) lexer_output: {
                    @branchHint(.likely);
                    break :lexer_output bun.handleOom(Braces.Lexer.tokenize(arena_allocator, brace_str));
                } else lexer_output: {
                    break :lexer_output bun.handleOom(Braces.NewLexer(.wtf8).tokenize(arena_allocator, brace_str));
                };
                const expansion_count = Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]);

                const stack_max = comptime 16;
                comptime {
                    assert(@sizeOf([]std.array_list.Managed(u8)) * stack_max <= 256);
                }
                var maybe_stack_alloc = std.heap.stackFallback(@sizeOf([]std.array_list.Managed(u8)) * stack_max, arena_allocator);
                const stack_alloc = maybe_stack_alloc.get();
                const expanded_strings = bun.handleOom(stack_alloc.alloc(std.array_list.Managed(u8), expansion_count));

                for (0..expansion_count) |i| {
                    expanded_strings[i] = std.array_list.Managed(u8).init(this.base.allocator());
                }

                Braces.expand(
                    arena_allocator,
                    lexer_output.tokens.items[0..],
                    expanded_strings,
                    lexer_output.contains_nested,
                ) catch |err| switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                    error.UnexpectedToken => std.debug.panic(
                        "unexpected error from Braces.expand: UnexpectedToken",
                        .{},
                    ),
                };

                this.outEnsureUnusedCapacity(expansion_count);

                // Add sentinel values
                for (0..expansion_count) |i| {
                    bun.handleOom(expanded_strings[i].append(0));
                    switch (this.out.pushResult(&expanded_strings[i])) {
                        .copied => {
                            expanded_strings[i].deinit();
                        },
                        .moved => {
                            expanded_strings[i].clearRetainingCapacity();
                        },
                    }
                }

                if (this.node.has_glob_expansion()) {
                    this.state = .glob;
                } else {
                    this.state = .done;
                }
            },
            .glob => {
                return this.transitionToGlobState();
            },
            .done, .err => unreachable,
        }
    }

    if (this.state == .done) {
        return this.parent.childDone(this, 0);
    }

    // Parent will inspect the `this.state.err`
    if (this.state == .err) {
        return this.parent.childDone(this, 1);
    }

    unreachable;
}

fn transitionToGlobState(this: *Expansion) Yield {
    var arena = Arena.init(this.base.allocator());
    this.child_state = .{ .glob = .{ .walker = .{} } };
    const pattern = this.current_out.items[0..];

    const cwd = this.base.shell.cwd();

    switch (GlobWalker.initWithCwd(
        &this.child_state.glob.walker,
        &arena,
        pattern,
        cwd,
        false,
        false,
        false,
        false,
        false,
    ) catch |err| bun.handleOom(err)) {
        .result => {},
        .err => |e| {
            this.state = .{ .err = bun.shell.ShellErr.newSys(e) };
            return .{ .expansion = this };
        },
    }

    var task = ShellGlobTask.createOnMainThread(&this.child_state.glob.walker, this);
    task.schedule();
    return .suspended;
}

pub fn expandVarAndCmdSubst(this: *Expansion, start_word_idx: u32) ?Yield {
    switch (this.node.*) {
        .simple => |*simp| {
            const is_cmd_subst = this.expandSimpleNoIO(simp, &this.current_out, true);
            if (is_cmd_subst) {
                const io: IO = .{
                    .stdin = this.base.rootIO().stdin.ref(),
                    .stdout = .pipe,
                    .stderr = this.base.rootIO().stderr.ref(),
                };
                const shell_state = switch (this.base.shell.dupeForSubshell(this.base.allocScope(), this.base.allocator(), io, .cmd_subst)) {
                    .result => |s| s,
                    .err => |e| {
                        this.base.throw(&bun.shell.ShellErr.newSys(e));
                        return .failed;
                    },
                };
                var script = Script.init(this.base.interpreter, shell_state, &this.node.simple.cmd_subst.script, Script.ParentPtr.init(this), io);
                this.child_state = .{
                    .cmd_subst = .{
                        .cmd = script,
                        .quoted = simp.cmd_subst.quoted,
                    },
                };
                return script.start();
            } else {
                this.word_idx += 1;
            }
        },
        .compound => |cmp| {
            const starting_offset: usize = if (this.node.hasTildeExpansion()) brk: {
                this.word_idx += 1;
                break :brk 1;
            } else 0;
            for (cmp.atoms[start_word_idx + starting_offset ..]) |*simple_atom| {
                const is_cmd_subst = this.expandSimpleNoIO(simple_atom, &this.current_out, true);
                if (is_cmd_subst) {
                    const io: IO = .{
                        .stdin = this.base.rootIO().stdin.ref(),
                        .stdout = .pipe,
                        .stderr = this.base.rootIO().stderr.ref(),
                    };
                    const shell_state = switch (this.base.shell.dupeForSubshell(this.base.allocScope(), this.base.allocator(), io, .cmd_subst)) {
                        .result => |s| s,
                        .err => |e| {
                            this.base.throw(&bun.shell.ShellErr.newSys(e));
                            return .failed;
                        },
                    };
                    var script = Script.init(this.base.interpreter, shell_state, &simple_atom.cmd_subst.script, Script.ParentPtr.init(this), io);
                    this.child_state = .{
                        .cmd_subst = .{
                            .cmd = script,
                            .quoted = simple_atom.cmd_subst.quoted,
                        },
                    };
                    return script.start();
                } else {
                    this.word_idx += 1;
                    this.child_state = .idle;
                }
            }
        },
    }

    return null;
}

/// Remove a set of values from the beginning and end of a slice.
pub fn trim(slice: []u8, values_to_strip: []const u8) []u8 {
    var begin: usize = 0;
    var end: usize = slice.len;
    while (begin < end and std.mem.indexOfScalar(u8, values_to_strip, slice[begin]) != null) : (begin += 1) {}
    while (end > begin and std.mem.indexOfScalar(u8, values_to_strip, slice[end - 1]) != null) : (end -= 1) {}
    return slice[begin..end];
}

/// 1. Turn all newlines into spaces
/// 2. Strip last newline if it exists
/// 3. Trim leading, trailing, and consecutive whitespace
fn postSubshellExpansion(this: *Expansion, stdout_: []u8) void {
    // 1. and 2.
    var stdout = convertNewlinesToSpaces(stdout_);

    // Trim leading & trailing whitespace
    stdout = trim(stdout, " \n  \r\t");
    if (stdout.len == 0) return;

    // Trim consecutive
    var prev_whitespace: bool = false;
    var a: usize = 0;
    var b: usize = 1;
    for (stdout[0..], 0..) |c, i| {
        if (prev_whitespace) {
            if (c != ' ') {
                a = i;
                b = i + 1;
                prev_whitespace = false;
            }
            continue;
        }

        b = i + 1;
        if (c == ' ') {
            b = i;
            prev_whitespace = true;
            bun.handleOom(this.current_out.appendSlice(stdout[a..b]));
            this.pushCurrentOut();
        }
    }
    // "aa bbb"

    bun.handleOom(this.current_out.appendSlice(stdout[a..b]));
}

fn convertNewlinesToSpaces(stdout_: []u8) []u8 {
    var stdout = brk: {
        if (stdout_.len == 0) return stdout_;
        if (stdout_[stdout_.len -| 1] == '\n') break :brk stdout_[0..stdout_.len -| 1];
        break :brk stdout_[0..];
    };

    if (stdout.len == 0) {
        return stdout;
    }

    // From benchmarks the SIMD stuff only is faster when chars >= 64
    if (stdout.len < 64) {
        convertNewlinesToSpacesSlow(0, stdout);
        return stdout[0..];
    }

    const needles: @Vector(16, u8) = @splat('\n');
    const spaces: @Vector(16, u8) = @splat(' ');
    var i: usize = 0;
    while (i + 16 <= stdout.len) : (i += 16) {
        const haystack: @Vector(16, u8) = stdout[i..][0..16].*;
        stdout[i..][0..16].* = @select(u8, haystack == needles, spaces, haystack);
    }

    if (i < stdout.len) convertNewlinesToSpacesSlow(i, stdout);
    return stdout[0..];
}

fn convertNewlinesToSpacesSlow(i: usize, stdout: []u8) void {
    for (stdout[i..], i..) |c, j| {
        if (c == '\n') {
            stdout[j] = ' ';
        }
    }
}

pub fn childDone(this: *Expansion, child: ChildPtr, exit_code: ExitCode) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state != .done and this.state != .err);
        assert(this.child_state != .idle);
    }

    // Command substitution
    if (child.ptr.is(Script)) {
        if (comptime bun.Environment.allow_assert) {
            assert(this.child_state == .cmd_subst);
        }

        // This branch is true means that we expanded
        // a single command substitution and it failed.
        //
        // This information is propagated to `Cmd` because in the case
        // that the command substitution would be expanded to the
        // command name (e.g. `$(lkdfjsldf)`), and it fails, the entire
        // command should fail with the exit code of the command
        // substitution.
        if (exit_code != 0 and
            this.node.* == .simple and
            this.node.simple == .cmd_subst)
        {
            this.out_exit_code = exit_code;
        }

        const stdout = this.child_state.cmd_subst.cmd.base.shell.buffered_stdout().slice();
        if (!this.child_state.cmd_subst.quoted) {
            this.postSubshellExpansion(stdout);
        } else {
            const trimmed = std.mem.trimRight(u8, stdout, " \n\t\r");
            bun.handleOom(this.current_out.appendSlice(trimmed));
        }

        this.word_idx += 1;
        this.child_state = .idle;
        child.deinit();
        return .{ .expansion = this };
    }

    @panic("Invalid child to Expansion, this indicates a bug in Bun. Please file a report on Github.");
}

fn onGlobWalkDone(this: *Expansion, task: *ShellGlobTask) Yield {
    log("{f} onGlobWalkDone", .{this});
    if (comptime bun.Environment.allow_assert) {
        assert(this.child_state == .glob);
    }

    if (task.err) |*err| {
        switch (err.*) {
            .syscall => {
                this.base.throw(&bun.shell.ShellErr.newSys(task.err.?.syscall));
            },
            .unknown => |errtag| {
                this.base.throw(&.{
                    .custom = bun.handleOom(this.base.allocator().dupe(u8, @errorName(errtag))),
                });
            },
        }
    }

    if (task.result.items.len == 0) {
        // In variable assignments, a glob that fails to match should not produce an error, but instead expand to just the pattern
        if (this.parent.ptr.is(Assigns) or (this.parent.ptr.is(Cmd) and this.parent.ptr.as(Cmd).state == .expanding_assigns)) {
            this.pushCurrentOut();
            this.child_state.glob.walker.deinit(true);
            this.child_state = .idle;
            this.state = .done;
            return .{ .expansion = this };
        }

        const msg = bun.handleOom(std.fmt.allocPrint(this.base.allocator(), "no matches found: {s}", .{this.child_state.glob.walker.pattern}));
        this.state = .{
            .err = bun.shell.ShellErr{
                .custom = msg,
            },
        };
        this.child_state.glob.walker.deinit(true);
        this.child_state = .idle;
        return .{ .expansion = this };
    }

    for (task.result.items) |sentinel_str| {
        // The string is allocated in the glob walker arena and will be freed, so needs to be duped here
        const duped = bun.handleOom(this.base.allocator().dupeZ(u8, sentinel_str[0..sentinel_str.len]));
        switch (this.out.pushResultSliceOwned(duped)) {
            .copied => {
                this.base.allocator().free(duped);
            },
            .moved => {},
        }
    }

    this.word_idx += 1;
    this.child_state.glob.walker.deinit(true);
    this.child_state = .idle;
    this.state = .done;
    return .{ .expansion = this };
}

/// If the atom is actually a command substitution then does nothing and returns true
pub fn expandSimpleNoIO(this: *Expansion, atom: *const ast.SimpleAtom, str_list: *std.array_list.Managed(u8), comptime expand_tilde: bool) bool {
    switch (atom.*) {
        .Text => |txt| {
            bun.handleOom(str_list.appendSlice(txt));
        },
        .Var => |label| {
            bun.handleOom(str_list.appendSlice(this.expandVar(label)));
        },
        .VarArgv => |int| {
            bun.handleOom(str_list.appendSlice(this.expandVarArgv(int)));
        },
        .asterisk => {
            bun.handleOom(str_list.append('*'));
        },
        .double_asterisk => {
            bun.handleOom(str_list.appendSlice("**"));
        },
        .brace_begin => {
            bun.handleOom(str_list.append('{'));
        },
        .brace_end => {
            bun.handleOom(str_list.append('}'));
        },
        .comma => {
            bun.handleOom(str_list.append(','));
        },
        .tilde => {
            if (expand_tilde) {
                const homedir = this.base.shell.getHomedir();
                defer homedir.deref();
                bun.handleOom(str_list.appendSlice(homedir.slice()));
            } else bun.handleOom(str_list.append('~'));
        },
        .cmd_subst => {
            // TODO:
            // if the command substution is comprised of solely shell variable assignments then it should do nothing
            // if (atom.cmd_subst.* == .assigns) return false;
            return true;
        },
    }
    return false;
}

pub fn appendSlice(this: *Expansion, buf: *std.array_list.Managed(u8), slice: []const u8) void {
    _ = this;
    bun.handleOom(buf.appendSlice(slice));
}

pub fn pushCurrentOut(this: *Expansion) void {
    if (this.current_out.items.len == 0) return;
    if (this.current_out.items[this.current_out.items.len - 1] != 0) bun.handleOom(this.current_out.append(0));
    switch (this.out.pushResult(&this.current_out)) {
        .copied => {
            this.current_out.clearRetainingCapacity();
        },
        .moved => {
            this.current_out = std.array_list.Managed(u8).init(this.base.allocator());
        },
    }
}

fn expandVar(this: *const Expansion, label: []const u8) []const u8 {
    const value = this.base.shell.shell_env.get(EnvStr.initSlice(label)) orelse brk: {
        break :brk this.base.shell.export_env.get(EnvStr.initSlice(label)) orelse return "";
    };
    defer value.deref();
    return value.slice();
}

fn expandVarArgv(this: *const Expansion, original_int: u8) []const u8 {
    var int = original_int;
    switch (this.base.interpreter.event_loop) {
        .js => |event_loop| {
            if (int == 0) return bun.selfExePath() catch "";
            int -= 1;

            const vm = event_loop.virtual_machine;
            if (vm.main.len > 0) {
                if (int == 0) return vm.main;
                int -= 1;
            }

            if (vm.worker) |worker| {
                if (int >= worker.argv.len) return "";
                return this.base.interpreter.getVmArgsUtf8(worker.argv, int);
            }
            const argv = vm.argv;
            if (int >= argv.len) return "";
            return argv[int];
        },
        .mini => {
            const ctx = this.base.interpreter.command_ctx;
            if (int >= 1 + ctx.passthrough.len) return "";
            if (int == 0) return ctx.positionals[ctx.positionals.len - 1 - int];
            return ctx.passthrough[int - 1];
        },
    }
}

fn currentWord(this: *Expansion) *const ast.SimpleAtom {
    return switch (this.node) {
        .simple => &this.node.simple,
        .compound => &this.node.compound.atoms[this.word_idx],
    };
}

/// Returns the size of the atom when expanded.
/// If the calculation cannot be computed trivially (cmd substitution, brace expansion), this value is not accurate and `has_unknown` is set to true
fn expansionSizeHint(this: *const Expansion, atom: *const ast.Atom, has_unknown: *bool) usize {
    return switch (@as(ast.Atom.Tag, atom.*)) {
        .simple => this.expansionSizeHintSimple(&atom.simple, has_unknown),
        .compound => {
            if (atom.compound.brace_expansion_hint) {
                has_unknown.* = true;
            }

            var out: usize = 0;
            for (atom.compound.atoms) |*simple| {
                out += this.expansionSizeHintSimple(simple, has_unknown);
            }
            return out;
        },
    };
}

fn expansionSizeHintSimple(this: *const Expansion, simple: *const ast.SimpleAtom, has_unknown: *bool) usize {
    return switch (simple.*) {
        .Text => |txt| txt.len,
        .Var => |label| this.expandVar(label).len,
        .VarArgv => |int| this.expandVarArgv(int).len,
        .brace_begin, .brace_end, .comma, .asterisk => 1,
        .double_asterisk => 2,
        .cmd_subst => |subst| {
            _ = subst; // autofix

            // TODO check if the command substitution is comprised entirely of assignments or zero-sized things
            // if (@as(ast.CmdOrAssigns.Tag, subst.*) == .assigns) {
            //     return 0;
            // }
            has_unknown.* = true;
            return 0;
        },
        .tilde => {
            has_unknown.* = true;
            return 0;
        },
    };
}

fn outEnsureUnusedCapacity(this: *Expansion, additional: usize) void {
    switch (this.out) {
        .array_of_ptr => {
            bun.handleOom(this.out.array_of_ptr.ensureUnusedCapacity(additional));
        },
        .array_of_slice => {
            bun.handleOom(this.out.array_of_slice.ensureUnusedCapacity(additional));
        },
        .single => {},
    }
}

pub const ShellGlobTask = struct {
    const debug = bun.Output.scoped(.ShellGlobTask, .hidden);

    task: WorkPoolTask = .{ .callback = &runFromThreadPool },

    /// Not owned by this struct
    expansion: *Expansion,
    /// Not owned by this struct
    walker: *GlobWalker,

    result: std.array_list.Managed([:0]const u8),
    event_loop: jsc.EventLoopHandle,
    concurrent_task: jsc.EventLoopTask,
    // This is a poll because we want it to enter the uSockets loop
    ref: bun.Async.KeepAlive = .{},
    err: ?Err = null,
    alloc_scope: bun.AllocationScope,

    const This = @This();

    pub const Err = union(enum) {
        syscall: Syscall.Error,
        unknown: anyerror,

        pub fn toJS(this: Err, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .syscall => |err| err.toJS(globalThis),
                .unknown => |err| jsc.ZigString.fromBytes(@errorName(err)).toJS(globalThis),
            };
        }
    };

    pub fn createOnMainThread(walker: *GlobWalker, expansion: *Expansion) *This {
        debug("createOnMainThread", .{});
        var alloc_scope = bun.AllocationScope.init(bun.default_allocator);
        var this = bun.handleOom(alloc_scope.allocator().create(This));
        this.* = .{
            .alloc_scope = alloc_scope,
            .event_loop = expansion.base.eventLoop(),
            .concurrent_task = jsc.EventLoopTask.fromEventLoop(expansion.base.eventLoop()),
            .walker = walker,
            .expansion = expansion,
            .result = std.array_list.Managed([:0]const u8).init(this.alloc_scope.allocator()),
        };

        this.ref.ref(this.event_loop);

        return this;
    }

    pub fn runFromThreadPool(task: *WorkPoolTask) void {
        debug("runFromThreadPool", .{});
        var this: *This = @fieldParentPtr("task", task);
        switch (this.walkImpl()) {
            .result => {},
            .err => |e| {
                this.err = .{ .syscall = e };
            },
        }
        this.onFinish();
    }

    fn walkImpl(this: *This) Maybe(void) {
        debug("walkImpl", .{});

        var iter = GlobWalker.Iterator{ .walker = this.walker };
        defer iter.deinit();
        switch (bun.handleOom(iter.init())) {
            .err => |err| return .{ .err = err },
            else => {},
        }

        while (switch (iter.next() catch |e| OOM(e)) {
            .err => |err| return .{ .err = err },
            .result => |matched_path| matched_path,
        }) |path| {
            bun.handleOom(this.result.append(path));
        }

        return .success;
    }

    pub fn runFromMainThread(this: *This) void {
        debug("runFromJS", .{});
        this.expansion.onGlobWalkDone(this).run();
        this.ref.unref(this.event_loop);
    }

    pub fn runFromMainThreadMini(this: *This, _: *void) void {
        this.runFromMainThread();
    }

    pub fn schedule(this: *This) void {
        debug("schedule", .{});
        WorkPool.schedule(&this.task);
    }

    pub fn onFinish(this: *This) void {
        debug("onFinish", .{});
        if (this.event_loop == .js) {
            this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn deinit(this: *This) void {
        debug("deinit", .{});
        this.result.deinit();
        var alloc_scope = this.alloc_scope;
        alloc_scope.allocator().destroy(this);
        alloc_scope.deinit();
    }
};

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const assert = bun.assert;
const Maybe = bun.sys.Maybe;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
const ast = bun.shell.AST;

const Interpreter = bun.shell.Interpreter;
const Assigns = bun.shell.Interpreter.Assigns;
const Cmd = bun.shell.Interpreter.Cmd;
const CondExpr = bun.shell.Interpreter.CondExpr;
const IO = bun.shell.Interpreter.IO;
const Script = bun.shell.Interpreter.Script;
const ShellExecEnv = Interpreter.ShellExecEnv;
const State = bun.shell.Interpreter.State;
const Subshell = bun.shell.Interpreter.Subshell;

const Arena = bun.shell.interpret.Arena;
const Braces = bun.shell.interpret.Braces;
const EnvStr = bun.shell.interpret.EnvStr;
const GlobWalker = bun.shell.interpret.GlobWalker;
const OOM = bun.shell.interpret.OOM;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const Syscall = bun.shell.interpret.Syscall;
const WorkPool = bun.shell.interpret.WorkPool;
const WorkPoolTask = bun.shell.interpret.WorkPoolTask;
const log = bun.shell.interpret.log;
