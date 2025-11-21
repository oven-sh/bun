#pragma once

/// Type definition for the Zig execute callback
/// Takes a script buffer and its length, returns exit status (0 = success, non-zero = failure/exception)
typedef int (*FuzzilliExecuteCallback)(const char* script, unsigned long length);

/// Begins the Fuzzilli REPRL loop using the provided callback for script execution
/// @param callback_ptr Pointer to the Zig execute callback function
extern "C" void bun__fuzzilli__begin_with_global(void* callback_ptr);
