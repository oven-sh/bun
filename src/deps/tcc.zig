pub const TCCState = State;
pub const TCCErrorFunc = ?*const fn (?*anyopaque, [*:0]const u8) callconv(.C) void;
fn ErrorFunc(Ctx: type) type {
    return fn (ctx: ?*Ctx, msg: [*:0]const u8) callconv(.C) void;
}
pub extern fn tcc_new() ?*TCCState;
pub extern fn tcc_delete(s: *TCCState) void;
pub extern fn tcc_set_lib_path(s: *TCCState, path: [*:0]const u8) void;
pub extern fn tcc_set_error_func(s: *TCCState, error_opaque: ?*anyopaque, error_func: TCCErrorFunc) void;
pub extern fn tcc_get_error_func(s: *TCCState) TCCErrorFunc;
pub extern fn tcc_get_error_opaque(s: *TCCState) ?*anyopaque;
pub extern fn tcc_set_options(s: *TCCState, str: [*:0]const u8) c_int;
pub extern fn tcc_add_include_path(s: *TCCState, pathname: [*:0]const u8) c_int;
pub extern fn tcc_add_sysinclude_path(s: *TCCState, pathname: [*:0]const u8) c_int;
pub extern fn tcc_define_symbol(s: *TCCState, sym: [*:0]const u8, value: [*:0]const u8) void;
pub extern fn tcc_undefine_symbol(s: *TCCState, sym: [*:0]const u8) void;
pub extern fn tcc_add_file(s: *TCCState, filename: [*:0]const u8) c_int;
pub extern fn tcc_compile_string(s: *TCCState, buf: [*:0]const u8) c_int;
pub extern fn tcc_set_output_type(s: *TCCState, output_type: c_int) c_int;
pub extern fn tcc_add_library_path(s: *TCCState, pathname: [*:0]const u8) c_int;
pub extern fn tcc_add_library(s: *TCCState, libraryname: [*:0]const u8) c_int;
pub extern fn tcc_add_symbol(s: *TCCState, name: [*:0]const u8, val: *const anyopaque) c_int;
pub extern fn tcc_output_file(s: *TCCState, filename: [*:0]const u8) c_int;
pub extern fn tcc_run(s: *TCCState, argc: c_int, argv: [*c][*c]u8) c_int;
pub extern fn tcc_relocate(s1: *TCCState, ptr: ?*anyopaque) c_int;
pub extern fn tcc_get_symbol(s: *TCCState, name: [*:0]const u8) ?*anyopaque;
pub extern fn tcc_list_symbols(s: *TCCState, ctx: ?*anyopaque, symbol_cb: ?*const fn (?*anyopaque, [*:0]const u8, ?*const anyopaque) callconv(.C) void) void;
pub const TCC_OUTPUT_MEMORY = @as(c_int, 1);
pub const TCC_OUTPUT_EXE = @as(c_int, 2);
pub const TCC_OUTPUT_DLL = @as(c_int, 3);
pub const TCC_OUTPUT_OBJ = @as(c_int, 4);
pub const TCC_OUTPUT_PREPROCESS = @as(c_int, 5);
pub const TCC_RELOCATE_AUTO: ?*anyopaque = @ptrCast(&1);

const std = @import("std");
const Allocator = std.mem.Allocator;

pub const Error = error{
    InvalidOptions,
    InvalidIncludePath,
    CompileError,
    // output
    InvalidOutputType,
    SyntaxError,
    InvalidLibraryPath,
    InvalidSymbol,
    ExecError,
    /// Could not get a symbol for some reason
    RelocationError,
};

pub const Symbol = opaque {
    const Callback = fn (?*anyopaque, [*:0]const u8, ?*const Symbol) void;
};

pub const State = opaque {
    pub fn Config(ErrCtx: type) type {
        return struct {
            options: ?[*:0]const u8 = null,
            outputType: ?OutputFormat = null,
            err: struct {
                ctx: ?*ErrCtx = null,
                handler: *const ErrorFunc(ErrCtx),
            } = .{},
        };
    }

    /// Create a new TCC compilation context
    pub fn new() Allocator.Error!*State {
        return tcc_new() orelse error.OutOfMemory;
    }

    /// Create and initialize a new TCC compilation context
    pub fn init(ErrCtx: type, config: Config(ErrCtx)) (Allocator.Error || Error)!State {
        var state = try State.new();
        errdefer state.deinit();

        if (config.options) |options|
            try state.setOptions(options);
        if (config.outputType) |outputType|
            try state.setOutputType(outputType);
        if (config.err) |err_| {
            state.setErrorFunc(ErrCtx, err_.ctx, err_.handler);
        }

        return state;
    }

    /// Free a TCC compilation context
    pub fn deinit(s: *State) void {
        tcc_delete(s);
        s.* = undefined;
    }

    /// Set `CONFIG_TCCDIR` at runtime
    pub fn setLibPath(s: *State, path: [:0]const u8) void {
        tcc_set_lib_path(s, path.ptr);
    }

    /// Set error/warning display callback
    pub fn setErrorFunc(s: *State, Context: type, errorOpaque: ?*Context, errorFunc: *const ErrorFunc(Context)) void {
        tcc_set_error_func(s, errorOpaque, errorFunc);
    }

    /// Return error/warning callback
    pub fn getErrorFunc(s: *State) ?*const ErrorFunc(anyopaque) {
        return tcc_get_error_func(s);
    }

    /// Return error/warning callback opaque pointer
    pub fn getErrorOpaque(s: *State) ?*anyopaque {
        return tcc_get_error_opaque(s);
    }

    /// Set options as from command line (multiple supported)
    pub fn setOptions(s: *State, str: [:0]const u8) Error!void {
        // TODO: is errno set?
        if (tcc_set_options(s, str.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidOptions;
        }
    }

    // ======================== Preprocessor ========================

    /// Add include path
    pub fn addIncludePath(s: *State, pathname: [:0]const u8) Error!void {
        if (tcc_add_include_path(s, pathname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidIncludePath;
        }
    }

    /// Add in system include path
    pub fn addSysIncludePath(s: *State, pathname: [:0]const u8) Error!void {
        if (tcc_add_sysinclude_path(s, pathname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidIncludePath;
        }
    }

    /// Define preprocessor symbol 'sym'. value can be NULL, sym can be "sym=val"
    ///
    /// ```c
    /// #define sym value
    /// ```
    pub fn defineSymbol(s: *State, sym: [:0]const u8, value: [:0]const u8) void {
        tcc_define_symbol(s, sym.ptr, value.ptr);
    }

    /// Undefine preprocess symbol 'sym'
    ///
    /// ```c
    /// #undef sym
    /// ```
    pub fn undefineSymbol(s: *State, sym: [:0]const u8) void {
        tcc_undefine_symbol(s, sym.ptr);
    }

    // ======================== Compiling ========================

    /// Add a file (C file, dll, object, library, ld script).
    ///
    /// ## Errors
    /// - File not found
    /// - Syntax/formatting error
    pub fn addFile(s: *State, filename: [:0]const u8) Error!void {
        if (tcc_add_file(s, filename.ptr) == -1) {
            @branchHint(.unlikely);
            return error.CompileError;
        }
    }

    /// Compile a string containing a C source.
    pub fn compileString(s: *State, buf: [:0]const u8) Error!void {
        if (tcc_compile_string(s, buf.ptr) == -1) {
            @branchHint(.unlikely);
            return error.CompileError;
        }
    }

    // ======================== Linking Commands ========================

    pub const OutputFormat = enum(c_int) {
        /// Output will be run in memory
        Memory = TCC_OUTPUT_MEMORY,
        /// Executable file
        Exe = TCC_OUTPUT_EXE,
        /// Dynamic library
        Dll = TCC_OUTPUT_DLL,
        /// Object file
        Obj = TCC_OUTPUT_OBJ,
        /// Only preprocess
        Preprocess = TCC_OUTPUT_PREPROCESS,
    };

    const OutputError = error{OutputError};

    /// Set output type. MUST BE CALLED before any compilation
    pub fn setOutputType(s: *State, outputType: OutputFormat) Error!void {
        if (tcc_set_output_type(s, @intFromEnum(outputType)) == -1) {
            @branchHint(.unlikely);
            return error.InvalidOutputType;
        }
    }

    pub const LibraryError = error{InvalidLibraryPath};
    /// Add a library. Equivalent to `-Lpath` option
    pub fn addLibraryPath(s: *State, pathname: [:0]const u8) Error!void {
        if (tcc_add_library_path(s, pathname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidLibraryPath;
        }
    }

    /// Add a library. The library name is the same as the argument of the `-l` option
    pub fn addLibrary(s: *State, libraryname: [:0]const u8) Error!void {
        if (tcc_add_library(s, libraryname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidLibraryPath;
        }
    }

    /// Add a symbol to the compiled program
    pub fn addSymbol(s: *State, name: [:0]const u8, val: ?*const anyopaque) Error!void {
        if (tcc_add_symbol(s, name.ptr, val) != 0) {
            @branchHint(.unlikely);
            return error.InvalidSymbol;
        }
    }

    /// Add all public declarations on a namespace struct as symbols to the
    /// compiled program.
    ///
    /// ## Example
    /// ```zig
    /// const libfoo = struct {
    ///     pub extern "c" fn foo() c_int;
    ///     pub extern "c" fn bar(x: c_int) c_int;
    /// };
    /// const state = TCC.State.init() catch @panic("ahhh");
    /// state.addSymbols(libfoo) catch @panic("failed to add symbols");
    /// ```
    ///
    /// Returns an error if any call to `addSymbol` fails.
    pub fn addSymbols(s: *State, symbols: type) Error!void {
        const info = @typeInfo(symbols);
        inline for (info.@"struct".decls) |decl| {
            const value = &@field(symbols, decl.name);
            try s.addSymbol(s, decl.name, value);
        }
    }

    /// Output an executable, library or object file. DO NOT call `relocate` before.
    pub fn outputFile(s: *State, filename: [:0]const u8) Error!void {
        if (tcc_output_file(s, filename.ptr) == -1) {
            @branchHint(.unlikely);
            return error.OutputError;
        }
    }

    /// Link and run `main()` function and return its value. DO NOT call `relocate` before.
    /// Returns the status code returned by the program's `main()` function.
    pub fn run(s: *State, argc: c_int, argv: [*:0]const [*:0]const u8) c_int {
        return tcc_run(s, argc, argv);
    }

    /// Do all relocations (needed before using `getSymbol`)
    ///
    /// Possible values for `ptr`:
    /// - `TCC_RELOCATE_AUTO`: Allocate and manage memory internally
    /// - `NULL`: return required memory size for the step below
    /// - memory address: copy code to memory passed by the caller
    pub fn relocate(s1: *State, ptr: ?*anyopaque) Error!void {
        if (tcc_relocate(s1, ptr) == -1) {
            @branchHint(.unlikely);
            return error.RelocationError;
        }
    }

    /// Return symbol value or NULL if not found
    pub fn getSymbol(s: *State, name: [:0]const u8) ?*Symbol {
        return tcc_get_symbol(s, name.ptr);
    }

    /// Return symbol value or NULL if not found
    pub fn listSymbols(s: *State, ctx: ?*anyopaque, symbolCb: ?*const Symbol.Callback) void {
        tcc_list_symbols(s, ctx, symbolCb);
    }
};
