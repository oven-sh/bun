# ASAN Builds for Bun

This document explains how to use and configure ASAN (Address Sanitizer) builds for Bun.

> **Note**: ASAN builds are available in CI for Linux and are configured to help identify memory issues in release builds.

## What is ASAN?

ASAN (Address Sanitizer) is a memory error detector for C/C++ and Zig code. It can detect:

- Use-after-free
- Heap buffer overflow
- Stack buffer overflow
- Global buffer overflow
- Use-after-return
- Use-after-scope
- Initialization order bugs
- Memory leaks

## ASAN Builds in CI

Bun CI includes ASAN builds to catch memory errors. These builds are configured with:

- Release optimizations for speed
- ASAN instrumentation for memory error detection
- Assertions enabled for both Bun and WebKit

The CI pipeline automatically:

- Builds a special ASAN-enabled release build for Linux
- Runs all tests to thoroughly check for memory issues
- Uses reduced parallelism to avoid memory pressure during testing
- Applies suppressions for known false positives
- Extends test timeouts to accommodate ASAN overhead
- Includes ASAN builds in release artifacts for debugging purposes

## Local ASAN Builds

To build Bun with ASAN locally, you can use the npm script:

```bash
# Build a release build with ASAN and assertions (recommended)
bun run build:asan
```

Or manually with CMake:

```bash
# Debug build with ASAN
cmake -B build -DCMAKE_BUILD_TYPE=Debug -DENABLE_ASAN=ON

# Release build with ASAN
cmake -B build -DCMAKE_BUILD_TYPE=Release -DENABLE_ASAN=ON

# Release build with ASAN and assertions
cmake -B build -DCMAKE_BUILD_TYPE=Release -DENABLE_ASAN=ON -DENABLE_ASSERTIONS=ON
```

## Running with ASAN

When running an ASAN build, you can configure behavior with environment variables:

```bash
# Basic ASAN options - leak detection disabled (recommended)
ASAN_OPTIONS=detect_leaks=0:halt_on_error=0:detect_odr_violation=0 ./build/bun-asan

# If you really need leak detection (will produce A LOT of noise)
# ASAN_OPTIONS=detect_leaks=1:leak_check_at_exit=1:halt_on_error=0 ./build/bun-asan
# LSAN_OPTIONS=suppressions=lsan.supp:print_suppressions=1 ./build/bun-asan
```

> **Warning**: Enabling leak detection will generate excessive noise due to deliberately uncollected memory in WebKit and other components. It's recommended to keep leak detection disabled and focus on other memory errors like use-after-free, buffer overflows, etc.

## Other Memory Error Types

ASAN can detect several types of memory errors:

1. **Use-after-free**: When a program continues to use memory after it's been freed
2. **Buffer overflow**: When a program writes beyond the bounds of allocated memory
3. **Stack overflow**: When a function's stack usage exceeds available space
4. **Memory corruption**: Often caused by writing to invalid memory locations
5. **Use-after-return**: When a function returns a pointer to stack memory that's no longer valid

When an error is detected, ASAN will print a helpful report showing:

- The type of error
- The memory address where the error occurred
- A stack trace showing the code path that led to the error
- Information about the memory allocation/deallocation (if relevant)

Example error output:

```
==1234==ERROR: AddressSanitizer: heap-use-after-free on address 0x614000000044 at pc 0x55d8e2ac1f14...
READ of size 4 at 0x614000000044 thread T0
    #0 0x55d8e2ac1f14 in main example.c:10
    #1 0x7f91e6f5e0b2 in __libc_start_main...
```

## Understanding ASAN Reports

ASAN reports contain detailed information about memory errors:

```
==12345==ERROR: AddressSanitizer: heap-use-after-free on address 0x7f7ddab8c084
READ of size 4 at 0x7f7ddab8c084 thread T0
    #0 0x43b45a in Function source/file.cpp:123:45
    #1 0x44af90 in AnotherFunction source/file.cpp:234:10
    ...
```

Key components of the report:

- Error type (heap-use-after-free, heap-buffer-overflow, etc.)
- Operation (READ/WRITE) and size
- Stack trace showing where the error occurred
- Information about the allocated/freed memory

## Best Practices

1. Run tests with ASAN builds regularly
2. Add suppressions only for well-understood false positives
3. Fix real issues promptly - ASAN errors indicate real problems
4. Consider using ASAN in debug builds during development
