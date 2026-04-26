---
title: "LeakSanitizer False Positives on macOS AArch64 - System Library Initialization"
severity: medium
component: Sanitizers > LeakSanitizer
platform: macOS AArch64 (Apple Silicon)
---

# LeakSanitizer False Positives on macOS AArch64 - System Library Initialization

## Summary

LeakSanitizer reports memory leaks from macOS system library initialization on AArch64 (Apple Silicon). These allocations occur before `main()` during dyld/Objective-C runtime initialization and are **not actionable leaks**.

## Impact

- **Severity:** Medium (noise in leak reports, not actual leaks)
- **Affected Platforms:** macOS 13.5, 14.x, 15.x on AArch64
- **Affected Tools:** Clang/LLVM ASAN, Rust, Bun, any LSAN user

## Evidence

### System Libraries Involved

```
#0 0x... in malloc (libclang_rt.asan_osx_dynamic.dylib)
#1 0x... in _malloc_type_malloc_outlined (libsystem_malloc.dylib)
#2 0x... in dyld::ThreadLocalVariables::instantiateVariable (dyld)
#3 0x... in _tlv_get_addr (dyld)
#4 0x... in _pthread_start (libsystem_pthread.dylib)
```

### Leak Details

| Library | Allocation | Size |
|---------|-----------|------|
| libobjc.A.dylib | `_fetchInitializingClassList` | 72 bytes |
| libxpc.dylib | `_xpc_collect_images` | 48 bytes |
| libSystem.B.dylib | `libSystem_initializer` | Indirect |
| dyld | `ThreadLocalVariables` | Variable |

**Total:** ~120 bytes in 3-5 allocations per process

## Root Cause

These allocations are part of macOS system initialization:

1. **Objective-C runtime** initializes class lists
2. **dyld** sets up thread-local variables
3. **libSystem** initializes core services
4. **XPC** sets up inter-process communication

All occur **before `main()`** and are intentionally never freed (process-lifetime allocations).

## Related Issues

- **llvm-project #115992** - "[LSAN] LeakSanitizer false positive on macOS Aarch64"
  https://github.com/llvm/llvm-project/issues/115992

- **rust-lang/rust #121624** - "AddressSanitizer reports leak for empty main on macOS"
  https://github.com/rust-lang/rust/issues/121624

- **rust-lang/rust #98473** - "Leak sanitizer does not work on aarch64 macOS"
  https://github.com/rust-lang/rust/issues/98473

- **MacPorts #68079** - "LeakSanitizer no longer usable"
  https://trac.macports.org/ticket/68079

- **google/sanitizers #1501** - "LeakSanitizer: unknown bytes leaked"
  https://github.com/google/sanitizers/issues/1501

## Workarounds

### Option 1: Suppression File

Create `lsan.supp`:
```
# macOS system init false positives
leak:dyld::ThreadLocalVariables
leak:dyld::ThreadLocalVariables::instantiateVariable
leak:_tlv_get_addr
leak:libsystem_malloc.dylib
leak:malloc_type_malloc_outlined
leak:libsystem_pthread.dylib
leak:_pthread_start
leak:libobjc.A.dylib
leak:_fetchInitializingClassList
leak:libxpc.dylib
leak:_xpc_collect_images
leak:libSystem.B.dylib
leak:libclang_rt.asan_osx_dynamic.dylib
```

Run with:
```bash
LSAN_OPTIONS="suppressions=lsan.supp" ./my_program
```

### Option 2: Environment Variable

```bash
export LSAN_OPTIONS="detect_leaks=0"  # Disable leak detection entirely
```

### Option 3: Code Annotation (for test frameworks)

```cpp
__attribute__((no_sanitize("leak")))
void system_init_wrapper() {
    // System init code
}
```

## Expected Behavior

LeakSanitizer should **automatically filter** allocations that:
1. Occur before `main()` (pre-main initialization)
2. Are from system libraries (dyld, libSystem, libobjc)
3. Have process-lifetime semantics

## Actual Behavior

LeakSanitizer reports these as leaks, creating noise in test output and CI reports.

## Proposed Fix

### Short-term

1. **Document known false positives** in LSAN documentation
2. **Provide default suppression file** for macOS AArch64
3. **Add to LSAN default suppressions** in compiler-rt

### Long-term

1. **Filter pre-main allocations** automatically in LSAN runtime
2. **Add platform-specific suppression** for macOS system libs
3. **Improve LSAN documentation** for macOS users

## Testing

### Reproduction

```cpp
// empty_main.cpp
int main() { return 0; }
```

```bash
clang++ -fsanitize=address -fsanitize=leak empty_main.cpp -o empty_main
./empty_main
```

**Expected:** No leak report  
**Actual:** Reports 120 bytes in 3-5 allocations from system libs

### Verification

With suppressions:
```bash
LSAN_OPTIONS="suppressions=lsan.supp" ./empty_main
```

**Expected:** No leak report  
**Actual:** No leak report ✅

## Environment

| Component | Version |
|-----------|---------|
| macOS | 13.5, 14.7, 15.1 |
| Architecture | AArch64 (Apple Silicon) |
| LLVM/Clang | 19.1.3 (Homebrew), Xcode toolchain |
| Rust | 1.75+ |
| Bun | 1.3.11-debug |

## Attachments

- Full backtraces: See Bun repo `test/leaksan-aarch64.supp`
- ASAN logs: Available upon request

## Reporters

- Original: llvm-project #115992
- Analysis: Bun team ASAN tracker investigation
- Date: March 2026

## CC

- @llvm-project sanitizers team
- @rust-lang compiler team
- @oven-sh (Bun)
- @react-native-community

---

**Priority:** Medium - This is noise, not a real leak. But it reduces LSAN signal-to-noise ratio.

**Urgency:** Low - Workarounds exist (suppressions). Proper fix would improve developer experience.
