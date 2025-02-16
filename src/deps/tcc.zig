// #ifndef LIBTCC_H
// #define LIBTCC_H

// #ifndef LIBTCCAPI
// # define LIBTCCAPI
// #endif

// #ifdef __cplusplus
// extern "C" {
// #endif

// struct TCCState;

// typedef struct TCCState TCCState;

// typedef void (*TCCErrorFunc)(void *opaque, const char *msg);

// /* create a new TCC compilation context */
// LIBTCCAPI TCCState *tcc_new(void);

// /* free a TCC compilation context */
// LIBTCCAPI void tcc_delete(TCCState *s);

// /* set CONFIG_TCCDIR at runtime */
// LIBTCCAPI void tcc_set_lib_path(TCCState *s, const char *path);

// /* set error/warning display callback */
// LIBTCCAPI void tcc_set_error_func(TCCState *s, void *error_opaque, TCCErrorFunc error_func);

// /* return error/warning callback */
// LIBTCCAPI TCCErrorFunc tcc_get_error_func(TCCState *s);

// /* return error/warning callback opaque pointer */
// LIBTCCAPI void *tcc_get_error_opaque(TCCState *s);

// /* set options as from command line (multiple supported) */
// LIBTCCAPI int tcc_set_options(TCCState *s, const char *str);

// /*****************************/
// /* preprocessor */

// /* add include path */
// LIBTCCAPI int tcc_add_include_path(TCCState *s, const char *pathname);

// /* add in system include path */
// LIBTCCAPI int tcc_add_sysinclude_path(TCCState *s, const char *pathname);

// /* define preprocessor symbol 'sym'. value can be NULL, sym can be "sym=val" */
// LIBTCCAPI void tcc_define_symbol(TCCState *s, const char *sym, const char *value);

// /* undefine preprocess symbol 'sym' */
// LIBTCCAPI void tcc_undefine_symbol(TCCState *s, const char *sym);

// /*****************************/
// /* compiling */

// /* add a file (C file, dll, object, library, ld script). Return -1 if error. */
// LIBTCCAPI int tcc_add_file(TCCState *s, const char *filename);

// /* compile a string containing a C source. Return -1 if error. */
// LIBTCCAPI int tcc_compile_string(TCCState *s, const char *buf);

// /*****************************/
// /* linking commands */

// /* set output type. MUST BE CALLED before any compilation */
// LIBTCCAPI int tcc_set_output_type(TCCState *s, int output_type);
// #define TCC_OUTPUT_MEMORY   1 /* output will be run in memory */
// #define TCC_OUTPUT_EXE      2 /* executable file */
// #define TCC_OUTPUT_DLL      4 /* dynamic library */
// #define TCC_OUTPUT_OBJ      3 /* object file */
// #define TCC_OUTPUT_PREPROCESS 5 /* only preprocess */

// /* equivalent to -Lpath option */
// LIBTCCAPI int tcc_add_library_path(TCCState *s, const char *pathname);

// /* the library name is the same as the argument of the '-l' option */
// LIBTCCAPI int tcc_add_library(TCCState *s, const char *libraryname);

// /* add a symbol to the compiled program */
// LIBTCCAPI int tcc_add_symbol(TCCState *s, const char *name, const void *val);

// /* output an executable, library or object file. DO NOT call
//    tcc_relocate() before. */
// LIBTCCAPI int tcc_output_file(TCCState *s, const char *filename);

// /* link and run main() function and return its value. DO NOT call
//    tcc_relocate() before. */
// LIBTCCAPI int tcc_run(TCCState *s, int argc, char **argv);

// /* do all relocations (needed before using tcc_get_symbol()) */
// LIBTCCAPI int tcc_relocate(TCCState *s1, void *ptr);
// /* possible values for 'ptr':
//    - TCC_RELOCATE_AUTO : Allocate and manage memory internally
//    - NULL              : return required memory size for the step below
//    - memory address    : copy code to memory passed by the caller
//    returns -1 if error. */
// #define TCC_RELOCATE_AUTO (void*)1

// /* return symbol value or NULL if not found */
// LIBTCCAPI void *tcc_get_symbol(TCCState *s, const char *name);

// /* return symbol value or NULL if not found */
// LIBTCCAPI void tcc_list_symbols(TCCState *s, void *ctx,
//     void (*symbol_cb)(void *ctx, const char *name, const void *val));

// #ifdef __cplusplus
// }
// #endif

// #endif

pub const TCCState = State;
pub const TCCErrorFunc = ?*const fn (?*anyopaque, [*:0]const u8) callconv(.C) void;
pub extern fn tcc_new() ?*TCCState;
pub extern fn tcc_delete(s: *TCCState) void;
pub extern fn tcc_set_lib_path(s: *TCCState, path: [*:0]const u8) void;
pub extern fn tcc_set_error_func(s: *TCCState, error_opaque: ?*anyopaque, error_func: TCCErrorFunc) void;
pub extern fn tcc_get_error_func(s: *TCCState) TCCErrorFunc;
pub extern fn tcc_get_error_opaque(s: *TCCState) ?*anyopaque;
pub extern fn tcc_set_options(s: *TCCState, str: [*:0]const u8) void;
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
    InvalidOption,
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
    /// Create a new TCC compilation context
    pub fn init() Allocator.Error!*TCCState {
        return tcc_new() orelse error.OutOfMemory;
    }

    /// Free a TCC compilation context
    pub fn deinit(s: *TCCState) void {
        tcc_delete(s);
        s.* = undefined;
    }

    /// Set `CONFIG_TCCDIR` at runtime
    pub fn setLibPath(s: *TCCState, path: [:0]const u8) void {
        tcc_set_lib_path(s, path.ptr);
    }

    /// Set error/warning display callback
    pub fn setErrorFunc(s: *TCCState, errorOpaque: ?*anyopaque, errorFunc: TCCErrorFunc) void {
        tcc_set_error_func(s, errorOpaque, errorFunc);
    }

    /// Return error/warning callback
    pub fn getErrorFunc(s: *TCCState) TCCErrorFunc {
        return tcc_get_error_func(s);
    }

    /// Return error/warning callback opaque pointer
    pub fn getErrorOpaque(s: *TCCState) ?*anyopaque {
        return tcc_get_error_opaque(s);
    }

    /// Set options as from command line (multiple supported)
    pub fn setOptions(s: *TCCState, str: [:0]const u8) Error!void {
        // TODO: is errno set?
        if (tcc_set_options(s, str.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidOption;
        }
    }

    // ======================== Preprocessor ========================

    /// Add include path
    pub fn addIncludePath(s: *TCCState, pathname: [:0]const u8) Error!void {
        if (tcc_add_include_path(s, pathname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidIncludePath;
        }
    }

    /// Add in system include path
    pub fn addSysincludePath(s: *TCCState, pathname: [:0]const u8) Error!void {
        if (tcc_add_sysinclude_path(s, pathname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidIncludePath;
        }
    }

    /// Define preprocessor symbol 'sym'. value can be NULL, sym can be "sym=val"
    pub fn defineSymbol(s: *TCCState, sym: [:0]const u8, value: [:0]const u8) void {
        tcc_define_symbol(s, sym.ptr, value.ptr);
    }

    // ======================== Compiling ========================

    /// Add a file (C file, dll, object, library, ld script).
    ///
    /// ## Errors
    /// - File not found
    /// - Syntax/formatting error
    pub fn addFile(s: *TCCState, filename: [:0]const u8) Error!void {
        if (tcc_add_file(s, filename.ptr) == -1) {
            @branchHint(.unlikely);
            return error.CompileError;
        }
    }

    /// Compile a string containing a C source.
    pub fn compileString(s: *TCCState, buf: [:0]const u8) Error!void {
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
    pub fn setOutputType(s: *TCCState, outputType: OutputFormat) Error!void {
        if (tcc_set_output_type(s, @intFromEnum(outputType)) == -1) {
            @branchHint(.unlikely);
            return error.InvalidOutputType;
        }
    }

    pub const LibraryError = error{InvalidLibraryPath};
    /// Add a library. Equivalent to `-Lpath` option
    pub fn addLibraryPath(s: *TCCState, pathname: [:0]const u8) Error!void {
        if (tcc_add_library_path(s, pathname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidLibraryPath;
        }
    }

    /// Add a library. The library name is the same as the argument of the `-l` option
    pub fn addLibrary(s: *TCCState, libraryname: [:0]const u8) Error!void {
        if (tcc_add_library(s, libraryname.ptr) != 0) {
            @branchHint(.unlikely);
            return error.InvalidLibraryPath;
        }
    }

    /// Add a symbol to the compiled program
    pub fn addSymbol(s: *TCCState, name: [:0]const u8, val: ?*const anyopaque) Error!void {
        if (tcc_add_symbol(s, name.ptr, val) != 0) {
            @branchHint(.unlikely);
            return error.InvalidSymbol;
        }
    }

    /// Output an executable, library or object file. DO NOT call `relocate` before.
    pub fn outputFile(s: *TCCState, filename: [:0]const u8) Error!void {
        if (tcc_output_file(s, filename.ptr) == -1) {
            @branchHint(.unlikely);
            return error.OutputError;
        }
    }

    /// Link and run `main()` function and return its value. DO NOT call `relocate` before.
    /// Returns the status code returned by the program's `main()` function.
    pub fn run(s: *TCCState, argc: c_int, argv: [*:0]const [*:0]const u8) c_int {
        return tcc_run(s, argc, argv);
    }

    /// Do all relocations (needed before using `getSymbol`)
    ///
    /// Possible values for `ptr`:
    /// - `TCC_RELOCATE_AUTO`: Allocate and manage memory internally
    /// - `NULL`: return required memory size for the step below
    /// - memory address: copy code to memory passed by the caller
    pub fn relocate(s1: *TCCState, ptr: ?*anyopaque) Error!void {
        if (tcc_relocate(s1, ptr) == -1) {
            @branchHint(.unlikely);
            return error.RelocationError;
        }
    }

    /// Return symbol value or NULL if not found
    pub fn getSymbol(s: *TCCState, name: [:0]const u8) ?*Symbol {
        return tcc_get_symbol(s, name.ptr);
    }

    /// Return symbol value or NULL if not found
    pub fn listSymbols(s: *TCCState, ctx: ?*anyopaque, symbolCb: ?*const Symbol.Callback) void {
        tcc_list_symbols(s, ctx, symbolCb);
    }
};
