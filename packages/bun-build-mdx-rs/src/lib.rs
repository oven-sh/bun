use mdxjs::{compile, JsxRuntime, Options as CompileOptions};
use std::ffi::{c_int, c_void};
use std::slice;
use std::str;

// Add this struct to store our compilation context
#[repr(C)]
struct CompilationContext {
    compiled_jsx: Vec<u8>,
}

#[no_mangle]
pub unsafe extern "C" fn bun_mdx_rs(
    _version: c_int,
    args: *const OnBeforeParseArguments,
    result: *mut OnBeforeParseResult,
) {
    let args = &*args;
    let result = &mut *result;

    // Fetch the source code using the provided callback
    let fetch_result = (result.fetchSourceCode)(args, result);
    if fetch_result != 0 {
        log_error(args, result, b"Failed to fetch source code");
        return;
    }

    // Get source as bytes without UTF-8 validation
    let source = slice::from_raw_parts(result.source_ptr, result.source_len);

    // Unsafely convert source bytes to a UTF-8 string
    // JavaScript source code is allowed to contain non-UTF-8 bytes
    let source_str = str::from_utf8_unchecked(source);

    // Compile MDX to JSX - pass the string slice
    let mut options = CompileOptions::gfm();

    // Leave it as JSX for Bun to handle
    options.jsx = true;

    // File paths on Windows are not necessarily valid UTF-8.
    let path = unsafe {
        std::str::from_utf8_unchecked(slice::from_raw_parts(
            args.path_ptr as *const u8,
            args.path_len,
        ))
        .to_string()
    };
    options.filepath = Some(path);

    match compile(source_str, &options) {
        Ok(compiled) => {
            // Create a context to own the compiled JSX
            let context = Box::new(CompilationContext {
                compiled_jsx: compiled.into_bytes(),
            });

            // Set up the result with zero-copy access to our compiled JSX
            let context_ptr = Box::into_raw(context);
            let compiled_context = &(*context_ptr).compiled_jsx;

            result.source_ptr = compiled_context.as_ptr() as *mut u8;
            result.source_len = compiled_context.len();
            result.loader = 0;

            // Set the context and finalizer
            result.plugin_source_code_context = context_ptr as *mut c_void;
            result.free_plugin_source_code_context = Some(free_compilation_context);
        }
        Err(_) => {
            log_error(args, result, b"Failed to compile MDX");
            return;
        }
    }
}

// Add the finalizer function
#[no_mangle]
unsafe extern "C" fn free_compilation_context(context: *mut c_void) {
    if !context.is_null() {
        // Convert back to Box and drop
        drop(Box::from_raw(context as *mut CompilationContext));
    }
}

// Helper function to log errors
unsafe fn log_error(args: &OnBeforeParseArguments, result: &OnBeforeParseResult, message: &[u8]) {
    let mut log_options = BunLogOptions {
        message_ptr: message.as_ptr(),
        message_len: message.len(),
        path_ptr: args.path_ptr,
        path_len: args.path_len,
        source_line_text_ptr: std::ptr::null(),
        source_line_text_len: 0,
        level: 0, // Error level
        line: 0,
        lineEnd: 0,
        column: 0,
        columnEnd: 0,
    };
    (result.log)(args, &mut log_options);
}

// Define the C structs in Rust
#[repr(C)]
pub struct OnBeforeParseArguments {
    bun: *mut c_void,
    path_ptr: *const u8,
    path_len: usize,
    namespace_ptr: *const u8,
    namespace_len: usize,
    default_loader: u8,
}

#[repr(C)]
pub struct OnBeforeParseResult {
    source_ptr: *mut u8,
    source_len: usize,
    loader: u8,
    fetchSourceCode: unsafe extern "C" fn(
        args: *const OnBeforeParseArguments,
        result: *mut OnBeforeParseResult,
    ) -> c_int,
    plugin_source_code_context: *mut c_void,
    free_plugin_source_code_context: Option<unsafe extern "C" fn(*mut c_void)>,
    log: unsafe extern "C" fn(args: *const OnBeforeParseArguments, options: *mut BunLogOptions),
}

#[repr(C)]
pub struct BunLogOptions {
    message_ptr: *const u8,
    message_len: usize,
    path_ptr: *const u8,
    path_len: usize,
    source_line_text_ptr: *const u8,
    source_line_text_len: usize,
    level: i8,
    line: c_int,
    lineEnd: c_int,
    column: c_int,
    columnEnd: c_int,
}
