---
name: building-bun
description: Use when building Bun from source on Linux, especially with clang/lld version matching, ccache workarounds, read-only filesystem paths, and Zig type errors in install/lockfile code.
---

# Building Bun from Source

## Overview

Build Bun on Linux with the correct clang/lld toolchain pair, work around ccache redirection, handle read-only filesystem paths, and fix common Zig type errors in the install/lockfile codebase.

## When to Use

- `bun bd` or `bun run build:debug` fails with linker or compiler errors
- clang/lld version mismatch (`ld.lld` version rejection)
- ccache redirects mise clang@21 to system clang@22
- `~/.local/state` or `~/.local/share` are on read-only filesystems
- Zig compile errors in `src/install/` — `ArrayHashMap`, `ExternalSlice`, `MultiArrayList` usage
- Highway `evex512` build failures on non-AVX512 hosts

## Toolchain Setup

### clang + lld Version Matching

clang@21 via mise (conda backend) **does not include `ld.lld`** — it only ships `ld.bfd` (GNU binutils linker).

**DO NOT use `mise install` for lld** — it is not a standalone mise tool. Use `mise exec` ad-hoc only:

```bash
mise exec clang@21 conda:lld@21.1.8 -- <command>
```

**Note:** `aqua:lld` does not exist in the aqua registry (`mise ls-remote aqua:lld` confirms this). Only `conda:lld` works.

**Version must match clang major version.** lld v22 with clang v21 is rejected by Bun's build version check.

### mise Tool Availability

| Tool | mise backend | Available? |
|------|-------------|-----------|
| `clang` | `conda:` | ✅ |
| `lld` | `conda:` | ✅ (ad-hoc via `mise exec` only) |
| `lld` | `aqua:` | ❌ Not in registry |
| `llvm-tools` | `conda:` | ❌ Not in registry |

### ccache Interception

ccache intercepts mise clang@21 calls and redirects to system clang@22, causing version mismatch.

**Workarounds (pick one):**
```bash
# Option 1: Remove ccache from PATH
PATH=$(echo "$PATH" | tr ':' '\n' | grep -v ccache | tr '\n' ':')

# Option 2: Disable ccache
CCACHE_DISABLE=1

# Option 3: Symlink mise clang/lld to ~/.local/bin/ (searched by build's findTool)
ln -sf ~/.local/share/mise/installs/clang/21.1.8/bin/clang-21 ~/.local/bin/
ln -sf ~/.local/share/mise/installs/conda-lld/21.1.8/bin/ld.lld ~/.local/bin/
```

### Read-Only Filesystem Paths

When `~/.local/state` (bun build cache) or `~/.local/share` (cargo/rustup) are on read-only filesystems:

```bash
BUN_INSTALL=/tmp/bun-install \
CARGO_HOME=/tmp/cargo-home \
RUSTUP_HOME=/tmp/rustup-home \
bun run build:debug
```

## Build Commands

### Standard Debug Build

```bash
# Never set a timeout when running bun bd
bun bd
# Creates debug build at ./build/debug/bun-debug
```

### Build with Specific Toolchain

```bash
PATH="$HOME/.local/share/mise/installs/conda-lld/21.1.8/bin:$PATH" \
  mise exec clang@21 -- \
    BUN_INSTALL=/tmp/bun-install \
    CARGO_HOME=/tmp/cargo-home \
    RUSTUP_HOME=/tmp/rustup-home \
    CCACHE_DISABLE=1 \
    bun run build:debug
```

### Passing Env Vars with mise exec

`mise exec` doesn't pass env vars directly. Wrap with `bash -c '...'`:

```bash
mise exec clang@21 -- bash -c '
  PATH="$HOME/.local/share/mise/installs/conda-lld/21.1.8/bin:$PATH" \
    CCACHE_DISABLE=1 \
    BUN_INSTALL=/tmp/bun-install \
    CARGO_HOME=/tmp/cargo-home \
    RUSTUP_HOME=/tmp/rustup-home \
    bun run build:debug
'
```

### Build Verification

```bash
# Run tests with debug build
bun bd test test/cli/install/overrides.test.ts

# NEVER use bun test directly — it won't include your changes
# MUST verify test fails with USE_SYSTEM_BUN=1 before claiming it passes
```

## Common Build Errors

### Highway evex512 on Non-AVX512 Hosts

**Error:** `error: always_inline function requires target feature 'avx512f'`

**Root cause:** clang 22 defines `__EVEX512__` as a built-in macro. Highway's `foreach_target.h` uses `#pragma clang attribute push(target("evex512"))` to force AVX512 code generation regardless of `-march=haswell`.

**Fix:** Add `-U__EVEX512__` to Highway's cflags in `scripts/build/deps/highway.ts`:
```ts
cflags: cfg.linux
  ? ["-fno-exceptions", "-fmath-errno", "-Wno-ignored-attributes", "-U__EVEX512__"]
  : [...]
```

**Alternative:** Patch vendored Highway source (brittle, avoid):
- `vendor/highway/hwy/ops/set_macros-inl.h` — guard `HWY_TARGET_STR_AVX3_VL512`
- `vendor/highway/hwy/foreach_target.h` — skip evex512 pragma

### clang C++ Stdlib Headers Missing

**Error:** `'cstddef' file not found` for C++ files`

**Root cause:** clang@21 via conda lacks C++ standard library headers in its sysroot.

**Fix:** Add host GCC headers via `-isystem` in `scripts/build/flags.ts`:
```ts
{
  flag: [
    "-isystem", "/usr/include/c++/14.2.1",
    "-isystem", "/usr/include/c++/14.2.1/x86_64-pc-linux-gnu",
  ],
  when: c => c.sysroot === undefined && !c.windows && !c.darwin,
  lang: "cxx",
}
```

## Zig Type Patterns

### ArrayHashMap with Custom Key (checkedEql)

`ArrayHashMap(K, V, Context, false)` requires `Context.eql(self, a, b, b_index: usize) bool`.

**Error:** `error: unused function parameter` for `b_index`

```zig
// ❌ WRONG: missing b_index parameter
pub fn eql(self: @This(), a: Key, b: Key) bool {
    _ = self;
    return a == b;
}

// ✅ CORRECT: include b_index: usize
pub fn eql(self: @This(), a: Key, b: Key, b_index: usize) bool {
    _ = self;
    _ = b_index;
    return a == b;
}
```

See `vendor/zig/lib/std/array_hash_map.zig` for the `checkedEql` contract.

### PackageID and MultiArrayList Access

`PackageID = u32` (defined in `src/install/install.zig:95`).

**Error:** `error: expected type 'u32', found 'Package(u64)'`

```zig
// ❌ WRONG: PackageID is not Package(u64)
const pkg_id: u64 = @as(u64, pid.?);

// ✅ CORRECT: PackageID is u32, use directly
if (pid.? < lockfile.packages.len) {
    const parent_name_hash = lockfile.packages.items(.name_hash)[pid.?];
}
```

### ExternalSlice Usage

`ExternalSlice(Type)` has `get(slice: []const Type) []const Type` — returns a sub-slice, not a single element.

**Error:** `error: expected type '[]const Type', found 'Type'`

```zig
// ❌ WRONG: get() returns a slice, not single element
const pkg: Package = lockfile.packages.get(idx)[0];

// ✅ CORRECT: use MultiArrayList.items(.field)[index]
const name_hash = lockfile.packages.items(.name_hash)[package_id];
```

### MultiArrayList Field Access

```zig
// Access field slice then index
const name_hashes = lockfile.packages.items(.name_hash);
const hash = name_hashes[package_id];

// Or in one line
const hash = lockfile.packages.items(.name_hash)[package_id];
```

## Notification Rule

When `ld.lld` is accessed ad-hoc via `mise exec conda:lld@<version>` rather than being pre-installed, notify the user via User Queue:

> Medium priority: `ld.lld` was not installed system-wide; it was accessed ad-hoc via `mise exec` using `conda:lld@21.1.8`, per the repo workflow rule.

## Quick Reference

| Task | Command |
|------|---------|
| Build with clang21 + lld | `mise exec clang@21 conda:lld@21.1.8 -- bun run build:debug` |
| Disable ccache | `CCACHE_DISABLE=1` |
| Redirect read-only paths | `BUN_INSTALL=/tmp/bun-install CARGO_HOME=/tmp/cargo-home` |
| Fix evex512 | Add `-U__EVEX512__` to `scripts/build/deps/highway.ts` |
| Zig ArrayHashMap eql | Must include `b_index: usize` param |
| PackageID access | `lockfile.packages.items(.field)[pid]` |

## Common Mistakes

1. **Using `mise install lld`** — lld is NOT a standalone mise tool, use `mise exec conda:lld@<version> --` ad-hoc ONLY
2. **Forgetting `b_index` in `eql`** — `ArrayHashMap` requires the 4-param signature
3. **Using `get()` for single element** — `ExternalSlice.get()` returns a slice, use `items(.field)[idx]`
4. **Assuming clang@21 has lld** — it only ships `ld.bfd`, use `mise exec conda:lld@<version>`
5. **Wrapping `mise exec` env vars directly** — use `bash -c '...'` wrapper
6. **Patching vendored Highway** — use build-system cflags (`-U__EVEX512__`) instead

## Real-World Impact

From this session (2026-05-02):
- 17+ turns spent debugging clang/lld version mismatch
- Root cause: clang@21 conda package lacks `ld.lld`
- Solution: `conda:lld@21.1.8` + `mise exec` ad-hoc usage (NO `mise install`)
- Zig errors: `ScopedOverrideKey` missing `b_index` in `eql`
- Build blocked for 20+ turns by toolchain issues, not code correctness
- Highway `evex512` fix: build-system flag, not vendored patch
- **`aqua:lld` does not exist** — only `conda:` works for lld
- **`mise install` for lld is NOT a thing** — ad-hoc `mise exec` only
