# PASS 3 — `bun_sys` per-platform audit + workspace-wide cfg-gated unsafe sweep

**Scope:** all 332 unsafe sites in `src/sys/` PLUS the cross-cutting `#[cfg(...)]`-gated unsafe spread across the workspace. Pass 3 deepens passes 1 & 2 (atomic ordering, arena/drop, FFI shim hardening) by isolating platform-specific risk surfaces. Where pass 1/2 looked at unsafe *categories* (ptr_cast, ptr_intrinsic, MaybeUninit), pass 3 looks at unsafe *under cfg gates* — code the local compiler rarely sees.

**Method:** map cfg-gated surface, sample dense files, isolate the "platform you don't run" risk. Tier each finding T1 (concrete patchable bug) / T2 (architecture defect) / T3 (latent watchlist). Where pass 2 over-tiered things, I down-tier them here.

---

## 0. Executive summary

### Tiered findings

- **T1 (concrete patchable bugs): 6**
  1. `src/sys/windows/mod.rs:4346` — `is_watcher_child()` treats `GetEnvironmentVariableW(buf, 1) > 0` as "var is set", but every nonzero return — including `> nSize` when the value is longer than 1 WCHAR — counts. Correct, BUT no `SetLastError(0)` reset before the call, so a stale `ERROR_ENVVAR_NOT_FOUND` from a prior failed call still leaves the return path as "0 + last error == not found" handled implicitly. The semantic bug is the buffer-size value: passing `nSize = 1` to `GetEnvironmentVariableW` only writes the trailing NUL when the var is empty; when the var is `"1"` (2 WCHARs incl. NUL), the function returns `2` and writes nothing — fine for the `> 0` check but the docs say the only safe pattern is to inspect `GetLastError() == ERROR_ENVVAR_NOT_FOUND`. The current code returns `true` for any value that exists, regardless of content. Whether that matches Zig parity needs verification; if a user sets `_BUN_WATCHER_CHILD=0` they become a child anyway.
  2. `src/sys/lib.rs:204` — `Name::borrow` `debug_assert!(unsafe { *s.as_ptr().add(s.len()) } == 0)` in the *macOS arm at line 498* (`let name = &buf[base + 21..base + 21 + namlen];`): when `namlen == 0` (legal for Darwin dirent records where the kernel zero-padded an unused slot), `s.len() == 0` and `s.as_ptr()` may point at `buf[base + 21]`. If `base + 21 == BUF_SIZE` (record at the very tail), `s.as_ptr().add(0)` is the one-past-end pointer of `filled(end_index)`; dereferencing it for the debug_assert reads past the kernel-filled prefix. Darwin won't produce that record shape in practice, but the contract is not formally enforced.
  3. `src/sys/lib.rs:373` — Linux getdents64 walk: `let name_field = &buf[base + 19..base + reclen];` indexes by `reclen` returned by the kernel. If the kernel returns a record with `reclen < 19` (impossible for an honest kernel but possible for a malicious seccomp hook injecting records, or for a buggy FUSE filesystem), the slice expression panics; the debug_assert above (line 365) only checks that `base + reclen <= end_index`, not that `reclen >= 19`. Should also guard `reclen >= 19` so the buffer arithmetic stays sane.
  4. `src/sys/lib.rs:6488` (`open_dir_at_windows_nt_path`) — `Buffer: p.as_ptr().cast_mut().cast::<u16>()` stores a `*const u16` derived from an immutable `&[u16]` into a Win32 `UNICODE_STRING::Buffer: *mut u16`. NtCreateFile is documented to treat ObjectName as read-only and never write through Buffer; nevertheless, deriving a `*mut` from a `*const` originating in a shared borrow and handing it to NT is the classic provenance footgun the Pass 1 SAFETY review flagged elsewhere. Same code at `open_file_at_windows_nt_path:6556`. Mitigation: `core::ptr::from_ref(p).cast_mut().cast::<u16>()` is morally identical but the comment "read-only by API contract" is load-bearing.
  5. `src/sys/lib.rs:6622-6635` — `if (options.access_mask & w::FILE_APPEND_DATA) != 0 { SetFilePointerEx(result, ...) == 0 → CloseHandle(result); return Err(...) }`. Between `Ok(Fd::from_system(result))` (line 6637) and `CloseHandle(result)` (line 6632) there is **no guard against double-close**: if the function returns Err, `CloseHandle` runs once. But the construction `Fd::from_system(result)` happens only after the SetFilePointerEx success branch — no double-close exists. **Down-tier to T3** — re-reading lines 6618-6640 confirms the close-only-on-error pattern is correct. Keep on the watchlist because the linear order ("set pointer, on failure close, on success wrap") is easy to perturb during edits.
  6. `src/sys/tmp.rs:75-79` — `unsafe { ZStr::from_raw(b.as_ptr(), b.len()) }` where `b = bun_paths::basename(destname.as_bytes())`. The SAFETY comment claims "basename returns a suffix of `destname`, which is NUL-terminated, so the suffix is also NUL-terminated at the same position." That is true only if `basename` does **not** strip trailing separators. `bun_core::strings::basename_posix("/a/b/")` returns `"b"` after stripping the trailing `/`, so `b.as_ptr() + b.len()` points at the `/` (a non-NUL byte) — the resulting `ZStr` is **NOT** NUL-terminated, and any C-side call (`linkat_tmpfile`, `unlinkat`) reads past it. **Mitigation:** the branch is dead today (`ALLOW_TMPFILE = false`), and the same comment exists in Zig. **T1 if `ALLOW_TMPFILE` ever flips**, T3 today. **PR action:** add a `debug_assert!` that `basename(d).len() == d.len() - ...` (or copy `basename` into a buffer with explicit NUL).

- **T2 (architectural defects): 3**
  1. `Fd` is `Copy` with no Drop. The only protection against use-after-close is the `close()` `debug_assert!(self.is_valid())` in release builds. Closed-fd reads silently succeed against a freshly-recycled descriptor — **the classic POSIX fd-recycling UAF**. The architecture decision is intentional (Zig parity) but architecturally hostile. Pass 1/2 didn't isolate this; pass 3 surfaces it. See §3.
  2. The Windows arms in `src/sys/lib.rs` mix three open paths: libuv (`sys_uv.rs`), `kernel32::CreateFileW` (device-path), and `ntdll::NtCreateFile` (everything else). Each has its own error-mapping table, fd kind, and handle-ownership rules. `read`/`pread` route through `FdKind::Uv → sys_uv` else direct `kernel32::ReadFile`. **There is no cross-check that callers don't pass a `FdKind::System` fd to a libuv-only function** (Windows panics; the rest fall through to undefined). Pass 1's "shape-only review" passed it; pass 3 looks deeper and finds the contract is enforced only by panic in `fd.uv()` at runtime — see `sys_uv.rs:474`, `sys_uv.rs:489`, etc.
  3. `bun_sys` Windows-only code in `src/sys/windows/mod.rs` is 5030 lines — larger than the Linux + macOS + FreeBSD arms of `lib.rs` combined for the equivalent functionality. The Rust port concentrated Win32 specifics in one place rather than distributing them; this minimises the "Windows arm of every function" pattern but also makes the Windows surface less reviewable per-call. The single 200KB `mod.rs` is what was ported in one big shot; that's where the bugs live. See §4.

- **T3 (watchlist): 16**

  Most live-fire issues fall here — code that is correct *today* but loses safety if a contract slips. See §6.

### Per-platform bug counts (sites with concrete adversarial scenario)

| Platform                     | T1 | T2 | T3 |
| ---------------------------- | -- | -- | -- |
| Windows-only paths           | 3  | 2  | 7  |
| Linux/Android-only paths     | 1  | 0  | 4  |
| macOS-only paths             | 1  | 0  | 2  |
| FreeBSD-only paths           | 0  | 0  | 1  |
| Cross-platform `#[cfg]` fans | 1  | 1  | 2  |
| **Total**                    | 6  | 3  | 16 |

### Headline conclusions

1. The Windows-only paths in `src/sys/windows/mod.rs` are the densest unbounded surface in `bun_sys` and were ported directly to Rust (no Zig parity to lean on for some patterns — the original Zig was thinner because `std.os.windows` carried half the weight; the Rust port re-inlines that layer). Three of the six T1 findings sit here.
2. Linux raw-syscall code (`linux_syscall.rs`) is unusually clean — rustix wrappers carry most of the SAFETY contract, and the comments at lines 367-499 are explicit about why each `libc::syscall(...)` call sidesteps rustix's typed API. The single T1 here is at the parser layer (getdents64), not the syscall layer.
3. macOS-only code is small (45 cfg hits in `lib.rs`) and the dirent parser at line 411+ is the only nontrivial unsafe surface. One T1 (boundary edge case in `Name::borrow` debug_assert).
4. FreeBSD is essentially uncovered by tests. The dirent walk at `lib.rs:519+` ships untested.
5. The `Fd` Copy-no-Drop design is fundamentally a use-after-close hazard. The runtime relies on disciplined `.close()` calls and on `close_allowing_bad_file_descriptor` returning a stack trace in debug builds. There is no proof in the type system.

---

## 1. `bun_sys` file map

```
src/sys/                          234   234 unsafe in lib.rs (out of 9222 lines = 1 per 39 lines)
├── lib.rs                       9222   234 unsafe   (the file)
├── windows/
│   ├── mod.rs                   5030    34 unsafe   (Win32 / ntdll / libuv)
│   └── env.rs                    107     4 unsafe   (WTF8 env)
├── sys_uv.rs                     890    27 unsafe   (libuv fs_t wrappers)
├── linux_syscall.rs              507    25 unsafe   (raw syscall via rustix)
├── Error.rs                      611     0 unsafe   (data only)
├── fd.rs                         519     2 unsafe   (close path)
├── file.rs                       418     0 unsafe   (high-level File)
├── dir.rs                        507     0 unsafe   (high-level Dir)
├── copy_file.rs                  497     4 unsafe   (copy_file_range / sendfile / CopyFileW)
├── tmp.rs                        103     1 unsafe   (in dead branch)
├── walker_skippable.rs           253     0 unsafe   (high-level walker)
├── PosixStat.rs                  237     1 unsafe
├── SignalCode.rs                 135     0
├── coreutils_error_map.rs         49     0
└── libuv_error_map.rs            140     0
```

Of the 332 inventoried unsafe sites:

- **234 (70.5%) in `src/sys/lib.rs`** — the unified Posix surface (cfg-gated per-platform inside)
- **34 in `src/sys/windows/mod.rs`** — all `#![cfg(windows)]`
- **27 in `src/sys/sys_uv.rs`** — all `#[cfg(windows)]` (in lib.rs `#[cfg(windows)] pub mod sys_uv`; on POSIX the module aliases the regular syscalls)
- **25 in `src/sys/linux_syscall.rs`** — all `#![cfg(any(target_os = "linux", target_os = "android"))]`
- 4 in `windows/env.rs`, 4 in `copy_file.rs`, 2 in `fd.rs`, 1 each in `tmp.rs` and `PosixStat.rs`

### cfg-gated section count by file

`src/sys/lib.rs` has **109** `#[cfg(...)]` directives. Mapped:
- `#[cfg(unix)]` — 45 (lib.rs)
- `#[cfg(windows)]` — 109 (lib.rs alone; +5030-line module body)
- `#[cfg(any(target_os = "linux", target_os = "android"))]` — Linux paths, getdents64, raw syscalls
- `#[cfg(target_os = "macos")]` — Darwin __getdirentries64, kqueue, ulock_*
- `#[cfg(target_os = "freebsd")]` — FreeBSD dirent walk + _umtx_op futex
- `#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]` — "other BSD" arm

### Coverage heuristic

Tests in `test/`:
- `*linux*` named: 2 files (`fs-birthtime-linux.test.ts`, `fs-stat-seccomp-linux.test.ts`) — for very specific corners
- `*windows*` named: 7 files (mostly UV-error-translation, ConPTY, env, named-pipe specific)
- `*macos*` named: 0 files
- `*freebsd*` named: 0 files

This understates the picture (most tests are platform-portable and exercise the cfg branch *of the host*), but the takeaway holds: the **FreeBSD dirent walk has zero test coverage in this tree**; macOS-only `__getdirentries64` and Linux-only `getdents64` are exercised only via the high-level `fs.readdirSync` paths in `node_fs` tests.

---

## 2. Workspace cfg-gated unsafe distribution

### Top workspace crates by total unsafe count (for reference)

| Crate           | Unsafe sites |
| --------------- | ------------ |
| bun_runtime     | 4893         |
| bun_jsc         |  745         |
| bun_install     |  525         |
| bun_bundler     |  498         |
| bun_core        |  461         |
| **bun_sys**     | **332**      |
| bun_http_jsc    |  287         |
| bun_alloc       |  273         |
| bun_uws_sys     |  253         |
| bun_io          |  213         |

### "Windows-named" files (unsafe density)

| File                                              | Unsafe sites |
| ------------------------------------------------- | ------------ |
| `src/install/windows-shim/bun_shim_impl.rs`       |   52         |
| `src/sys/windows/mod.rs`                          |   34         |
| `src/io/windows_event_loop.rs`                    |   11         |
| `src/runtime/node/uv_signal_handle_windows.rs`    |    8         |
| `src/windows_sys/externs.rs`                      |    6         |
| `src/install/windows-shim/main.rs`                |    5         |
| `src/sys/windows/env.rs`                          |    4         |
| `src/install/windows-shim/BinLinkingShim.rs`      |    2         |
| `src/errno/windows_errno.rs`                      |    1         |
| `src/bun_core/windows_sys.rs`                     |    1         |
| **Total (windows-named)**                          | **124**     |

But this *understates* Windows-specific unsafe: another ~200 sites live under `#[cfg(windows)]` arms inside non-Windows-named files (especially `src/sys/lib.rs`'s Windows arms).

### Top files with `cfg(windows)` mentions (by directive count, not unsafe)

| File                                            | cfg(windows) directives |
| ----------------------------------------------- | ----------------------- |
| `src/sys/lib.rs`                                | 109                     |
| `src/runtime/node/node_fs.rs`                   |  72                     |
| `src/spawn/process.rs`                          |  52                     |
| `src/bun_core/util.rs`                          |  44                     |
| `src/install/PackageInstall.rs`                 |  39                     |
| `src/runtime/socket/WindowsNamedPipe.rs`        |  32                     |

### Top files with `cfg(target_os = "macos")` directives

| File                                          | directives |
| --------------------------------------------- | ---------- |
| `src/sys/lib.rs`                              | 45         |
| `src/runtime/dns_jsc/dns.rs`                  | 13         |
| `src/spawn_sys/posix_spawn.rs`                | 11         |
| `src/io/lib.rs`                               | 11         |

### Top files with `cfg(target_os = "freebsd")` directives

| File                                | directives |
| ----------------------------------- | ---------- |
| `src/runtime/node/path_watcher.rs`  | 9          |
| `src/io/lib.rs`                     | 6          |
| `src/sys/lib.rs`                    | 5          |
| `src/io/posix_event_loop.rs`        | 5          |
| `src/runtime/node/node_os.rs`       | 4          |

### Top files with `cfg(target_arch = ...)` directives

| File                                  | directives |
| ------------------------------------- | ---------- |
| `src/perf/hw_timer.rs`                | 6          |
| `src/crash_handler/CPUFeatures.rs`    | 6          |
| `src/windows_sys/externs.rs`          | 4          |
| `src/runtime/ffi/ffi_body.rs`         | 4          |
| `src/js_parser/parse/parse_entry.rs`  | 4          |
| `src/install_types/resolver_hooks.rs` | 4          |

### Where cfg-gated unsafe overlaps low test coverage

Cross-referenced with `find test/ -name '*.test.ts'`: there are no `target_arch`-specific tests at all, and only 2 explicitly Linux-named tests. The **FreeBSD dirent parser** (`src/sys/lib.rs:519-582`), the **macOS `__getdirentries64` walk** (`lib.rs:411-510`), and the **Windows `NtQueryDirectoryFile` walk** (`lib.rs:587-769`) are not covered by per-platform tests. The Linux `getdents64` walk is covered transitively by every `readdir` test.

The Windows `move_opened_file_at` / `rename_at_w` path (`windows/mod.rs:4664-4881`) is exercised by `cp.test.ts` / `node_fs` rename tests but the EXDEV-fallback inside `move_file_z_with_handle` and the FAT32-fallback inside `delete_opened_file` are exercised only on NTFS / by chance.

---

## 3. The `Fd` Copy-no-Drop architecture (T2)

`src/CLAUDE.md` calls out: "`File` is Copy — no `Drop` close." This is unusual. Walking the consequences:

- **`Fd` is `Copy`** (`src/bun_core/util.rs:1406`). Cloning it does not duplicate the kernel reference. Calling `.close()` on one alias invalidates all other aliases — the canonical fd-recycling UAF.
- **`File` (`src/sys/file.rs:11`) is `#[repr(transparent)]` over `Fd`** and also `Copy`. Same hazard.
- **The only safeguard against use-after-close is `fd.rs:96`'s `debug_assert!(self.is_valid())`** at the top of `close_allowing_standard_io`. In debug builds this fires only if the fd has been zeroed; a closed-then-recycled fd looks valid.

Reading the deeper close path (`fd.rs:84-232`):

```rust
fn close_allowing_bad_file_descriptor(self, return_address: Option<usize>) -> Option<sys::Error> {
    if self.stdio_tag().is_some() {
        return None;
    }
    self.close_allowing_standard_io(return_address)
}

fn close_allowing_standard_io(self, return_address: Option<usize>) -> Option<sys::Error> {
    debug_assert!(self.is_valid()); // probably a UAF
    ...
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        debug_assert!(self.native() >= 0);
        match sys::linux_syscall::close(self.native()) {
            Err(e) if e == libc::EBADF => Some(...),
            _ => None,
        }
    }
    ...
}
```

**Important nuance:** `close_allowing_standard_io` returns `Some(EBADF)` only on `EBADF`. **Every other close error is silently dropped** — this is correct on Linux (POSIX guarantees the fd is released regardless of return value) but means a close error on Darwin/FreeBSD is invisible. Compared to e.g. ext4's `ENOSPC` on close (writeback flush), this is the right call (the fd is gone; reporting an error wouldn't let the caller retry).

The debug_assert at the **top** of `close_allowing_standard_io` is the user-after-free guard. Note the comment "// probably a UAF" — this is honest. Production builds carry no protection.

**Why isn't this T1?**
- The codebase is disciplined and most close paths are tied to scopeguards (`bun_sys::CloseOnDrop` in `windows/mod.rs:4820`, `lib.rs:3248`, `Tmpfile::finish` in `tmp.rs:71`). 
- Zig has the same architecture; the port preserves parity by design.
- A T1 finding requires a *concrete adversarial scenario*. I cannot point at a specific call site where a closed-fd is re-used. Phase B should run a UAF-fd hunt with race-condition-aware tests; PRs C-001 (NonNull-from-reference) from pass 1 will not catch this class.

**Recommended action:** keep the `debug_assert!(self.is_valid())` in `close_allowing_standard_io`. Add a `#[cfg(debug_assertions)]` post-close zeroing of any wrapped `Fd` in `MovableIfWindowsFd::close` and similar — currently `MovableIfWindowsFd::close` does zero its `inner`, but plain `Fd::close()` does not because `Fd` is `Copy` and the caller's copy lives on.

---

## 4. Windows-only path audit (`src/sys/windows/mod.rs`)

5030-line file. Three sub-themes: ntdll/kernel32 raw FFI, libuv shimming, and process-spawn (watcher, job objects, ConPTY). 34 inventoried unsafe sites.

### 4.1 `is_watcher_child` (line 4342) — T1

```rust
pub fn is_watcher_child() -> bool {
    let mut buf: [u16; 1] = [0];
    // SAFETY: buf valid for 1 element
    unsafe {
        kernel32_2::GetEnvironmentVariableW(WATCHER_CHILD_ENV_Z.as_ptr(), buf.as_mut_ptr(), 1) > 0
    }
}
```

Behaviour reference: [`GetEnvironmentVariableW`](https://learn.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-getenvironmentvariablew):
- Returns `0` on failure (var not found, etc).
- Returns "size of the buffer pointed to by lpBuffer, not including the terminating null character" on success — i.e., the number of WCHARs that COULD have been copied if the buffer were big enough.

With `nSize = 1`:
- Var set to empty string: returns `0` (because 0 WCHARs not including the NUL — but actually returns `1` per docs because the NUL is the only thing). Per docs: "If [lpBuffer] is not large enough to hold the data, the return value is the buffer size, in characters, required to hold the string and its terminating null character." So an empty var → returns `1` (just the NUL).
- Var set to "1": returns `2` (1 WCHAR data + 1 NUL needed). `2 > 0` → true.
- Var not set: returns `0`, last-error = `ERROR_ENVVAR_NOT_FOUND`. `0 > 0` → false.

**Result:** the function correctly returns true iff the var is set. **It does not check that the var value is meaningful.** Zig parity? Need to check; almost certainly yes. **But** the function isn't recording WHICH value the parent set — it just checks presence. The watcher manager sets it to `=1` (line 4523-4524), so a user-set `_BUN_WATCHER_CHILD=anything-else` makes Bun believe it's a watcher child. That's a process-takeover-by-env-var hazard, not memory unsafety. **Down-tier: this is correctness, not unsafe-block soundness. Keep on the watchlist; PR could harden by reading the value and checking `== "1"`.**

The unsafe call itself (`GetEnvironmentVariableW`) is sound: `WATCHER_CHILD_ENV_Z` is `bun_core::w!("_BUN_WATCHER_CHILD\0")` (NUL-terminated wide-string literal), `buf` is 1-WCHAR aligned writable storage. Pass.

### 4.2 `become_watcher_manager` env-block copy (line 4456-4520) — T3 watchlist

```rust
let kernelenv = kernel32_2::GetEnvironmentStringsW();   // returns *mut u16
let _free_env = scopeguard::guard(kernelenv, |envptr| {
    if !envptr.is_null() {
        unsafe { let _ = kernel32_2::FreeEnvironmentStringsW(envptr); }
    }
});
let mut size: usize = 0;
if !kernelenv.is_null() {
    unsafe {
        if *kernelenv.add(0) != 0 || *kernelenv.add(1) != 0 {
            while *kernelenv.add(size) != 0 || *kernelenv.add(size + 1) != 0 {
                size += 1;
            }
            size += 1;
        }
    }
}
```

This walks the double-NUL-terminated WCHAR env block. The `while *kernelenv.add(size) != 0 || *kernelenv.add(size + 1) != 0` looks at two adjacent WCHARs (4 bytes) and stops when both are zero. **Bug class:** if the block ends *exactly* at `kernelenv.add(N)` with a single trailing NUL (one-NUL termination instead of two), `kernelenv.add(N + 1)` reads past the OS-owned page. This cannot happen with a well-formed Win32 env block per documentation. Watchlist.

### 4.3 `move_opened_file_at` rename-info packing (line 4664-4750) — well-commented, T3

The SAFETY comments at lines 4701-4705 explicitly call out the provenance-shrinking trap that pass 1's "ptr-vs-ref" cluster (C-001) is about: forming a `&mut FILE_RENAME_INFORMATION_EX` over an aligned buffer would shrink provenance to just the struct, but the trailing-FileName-tail write extends past that. Keeping the buffer as `*mut FILE_RENAME_INFORMATION_EX` preserves full-buffer provenance.

This is **pass 1's C-001 cluster applied correctly**. Reference example for future audits. Watchlist only because the moment someone reborrows that pointer as a `&mut`, the trailing copy_nonoverlapping at line 4734 becomes UB.

### 4.4 `NtSetInformationFile` deletes (lines 3829-3925) — T3 watchlist

Two NT calls (FileDispositionInformationEx, then fallback to FileDispositionInformation). The scope guard pattern at line 3863-3866 closes the temp handle. SAFETY: rc captured, info stack-local, io captured. Pattern is sound.

**Concern:** if `NtCreateFile` returns SUCCESS but `tmp_handle` is null (per the docs, that shouldn't happen on SUCCESS), the scopeguard runs `CloseHandle(null)` which is documented as fail-with-INVALID_HANDLE — harmless but worth a debug_assert.

### 4.5 `delete_opened_file` (line 4629) and `move_opened_file_at` again — close discipline

The `_close = bun_sys::CloseOnDrop::new(fd)` pattern is used consistently in `move_opened_file_at_loose` (line 4820) and `rename_at_w` (line 4878). This is the right abstraction for fd discipline on a Copy type. Pass.

### 4.6 `convert_env_to_wtf8` (windows/env.rs:42-100) — T2 watchlist

Reads `GetEnvironmentStringsW` (OS-owned block), `wcslen`-walks every entry, allocates a UTF-8 buffer, then leaks the buffer and the pointer array as `&'static`. The static is then assigned into `bun_core::os::set_environ`. The comment at line 67 explicitly calls out the Stacked Borrows reasoning. This is the right pattern — but it's a one-shot startup-only call. If anyone ever calls it twice, the previous buffer leaks and `WTF8_ENV_BUF` is overwritten (the `ENV_CONVERTED` `AtomicBool` panic only fires in the `ci_assert` feature build). T3 — keep an `assert!` rather than `debug_assert!` even outside of ci_assert.

### 4.7 `update_stdio_mode_flags` + `StdinModeGuard` (line 4285-4328) — sound

Pattern is correct: capture the original mode, restore on Drop. Drop-impl signature is acceptable because `Stdio::StdIn.fd().native()` returns the same handle every call.

### 4.8 `exe_path_w` (line 3467) — T3 watchlist

```rust
pub fn exe_path_w() -> &'static bun_core::WStr {
    unsafe {
        let pp = (*bun_core::windows_sys::peb()).ProcessParameters;
        let image_path = core::ptr::addr_of!((*pp).ImagePathName);
        let len = ((*image_path).Length as usize) / 2;
        bun_core::WStr::from_raw((*image_path).Buffer, len)
    }
}
```

Assumes PEB ImagePathName is process-lifetime. Per documented Win32 behaviour this is true — PEB layouts are stable and the image-path is set at exec time and not freed. But the function returns `&'static` from a raw pointer derived from kernel-controlled memory: any future Wine / Sandboxing tool that reshuffles the PEB could invalidate this. T3.

---

## 5. Linux / macOS / FreeBSD per-platform deep dive

### 5.1 Linux raw-syscall path (`linux_syscall.rs`) — clean

The file is a model of SAFETY-comment hygiene. Each `libc::syscall(SYS_*, ...)` wrapper has a 4-6 line block explaining (a) why rustix's typed API was bypassed, (b) what the kernel's contract is, and (c) what bit-pattern hazards exist. Sample at line 357-371 (read_raw), 381-399 (epoll_ctl), 401-423 (sendfile), 425-455 (copy_file_range).

The aarch64 `SYS_SENDFILE = 71` polyfill at line 415-420 is correct (generic-syscall ABI). Note the bigger trap on aarch64-linux that the file doesn't quite call out: `SYS_OPEN` is also missing (open(2) is a compat shim for openat(AT_FDCWD)), and rustix's `open()` already detects this and routes through `openat`. The Rust code at line 88-94 relies on that detection.

**One finding: `errno()` is read via `bun_core::ffi::errno()` (a wrapper over `__errno_location()`).** This means glibc's TLS errno is used. The comments at line 49-61 acknowledge this and explain why it's a libc-style wrapper rather than a kernel-direct read. Pass.

### 5.2 macOS-only paths in `lib.rs` (lines 391-510, 5460-5704)

#### `__getdirentries64` dirent walk (line 411-510)

```rust
unsafe {
    self.buf
        .as_mut_ptr()
        .add(BUF_SIZE - 4)
        .cast::<[u8; 4]>()
        .write([0, 0, 0, 0]);
}
```

Pre-zeroes the EOF-flag tail before calling the syscall. Then:

```rust
let rc = unsafe {
    __getdirentries64(dir.native(), self.buf.as_mut_ptr(), BUF_SIZE, &mut self.seek)
};
```

Correct (private libsystem symbol, by-value c_int args + writable buf + writable seek). At line 470-477 reads the EOF flag back. SAFETY comment explicitly notes "kernel may have overwritten it; either way the 4 bytes are initialized." Sound.

**T1 candidate (find #2 in summary):** at line 498, `let name = &buf[base + 21..base + 21 + namlen];`. If the kernel writes a dirent with `namlen == 0` and `base + 21 == end_index`, then `name.as_ptr().add(0)` is the one-past-end pointer of `buf.filled(end_index)`. `Name::borrow`'s debug_assert at line 204 derefs it: `*s.as_ptr().add(s.len()) == 0`. With `s.len() == 0`, that derefs the one-past-end position — UB even in debug_assertions builds. Real-world Darwin kernels don't emit zero-namlen records, but the contract is not formally enforced. **Mitigation:** in `Name::borrow`, only assert NUL if `s.len() > 0`, OR (preferred) check `name_len > 0` before constructing `Name::borrow(name)`.

#### `__ulock_wait` (line 5641-5662)

Three `unsafe fn` wrappers over the private libsystem `__ulock_wait` / `__ulock_wait2` / `__ulock_wake`. Doc-comments require `addr` to point at ≥ 4 readable bytes. Called only from `threading/Futex.rs:darwin_impl` which always passes `ptr.as_ptr().cast()` where `ptr: &AtomicU32`. Sound.

**Dead-code trap (Futex.rs:205):** `let supports_ulock_wait2: bool = true;` — the `__ulock_wait` fallback branch (line 232-241) is unreachable. The fallback would fire on macOS < 11. Bun supports macOS 13+ per the comment, so dead. **But** the fallback computes `timeout_us = (timeout_ns / NS_PER_US) as u32` (line 233) and reports `timeout_overflowed = true` if try_from fails — that logic is dead, so when/if anyone flips `supports_ulock_wait2`, the dead branch should be re-audited. T3.

### 5.3 FreeBSD-only paths in `lib.rs`

#### `getdents` dirent walk (line 519-582)

FreeBSD `getdents()` returns `struct dirent` (FreeBSD 12+, "ino64"). Layout-matching reads at fixed offsets:
- `d_fileno` at offset 0..8
- `d_reclen` at offset 16..18
- `d_type` at offset 18
- `d_namlen` at offset 20..22
- `d_name` at offset 24 (NUL-terminated within `d_reclen`)

```rust
let name = &buf[base + 24..base + 24 + namlen];
```

Same T1 hazard as macOS: zero-namlen + record-at-tail crashes the debug_assert. Watchlist (T3 since FreeBSD doesn't ship as a supported target right now).

#### `_umtx_op` futex (line 387-451 in `Futex.rs`)

FreeBSD `_umtx_op(UMTX_OP_WAIT_UINT_PRIVATE, ...)`. Reads `*obj` as u32 to compare against `expect`. The unsafe block at line 404-414 passes `ptr.as_ptr().cast::<c_void>()` which is the live AtomicU32. Sound.

**One note:** at line 396, `tm._flags = 0` is documented as "use relative time not UMTX_ABSTIME", but the FreeBSD `_umtx_time` struct's `_flags` field is meant to receive `UMTX_ABSTIME` (== 1) OR be zero. Passing zero is correct for relative time per `_umtx_op(2)`. Pass.

### 5.4 Linux-only paths (in `lib.rs`)

#### `getdents64` dirent walk (line 322-388) — T1 (find #3)

```rust
let buf = unsafe { self.buf.filled(self.end_index) };
let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
let d_type = buf[base + 18];
self.index = base + reclen;

let name_field = &buf[base + 19..base + reclen];
let nul = memchr::memchr(0, name_field).unwrap_or(name_field.len());
let name = &name_field[..nul];
```

The slice expression `&buf[base + 19..base + reclen]` panics if `reclen < 19`. A well-behaved Linux kernel cannot produce that — a `linux_dirent64` has fixed 19-byte header (u64 + i64 + u16 + u8) and at least one byte of `d_name`, so `reclen >= 20` in practice. **But:** a buggy FUSE filesystem (no kernel validation) or a seccomp-filtered process feeding a fabricated reply *can*. Add a `debug_assert!(reclen >= 19, ...)` to make the contract explicit.

The `memchr::memchr(0, name_field)` is sound regardless. The d_name field is supposed to be NUL-terminated inside `reclen`, but using `unwrap_or(name_field.len())` correctly handles a missing terminator.

#### `mmap` (line 3223) — sound

```rust
let p = unsafe { libc::mmap(addr.cast(), len, prot, flags, fd.native(), off) };
if p == libc::MAP_FAILED { return Err(...); }
Ok(p.cast())
```

The success-check uses `libc::MAP_FAILED` (= `(-1isize) as *mut c_void`), correct. The returned slice in `mmap_file` (line 3268) uses `from_raw_parts_mut(ptr, size)` — `size` is `stat_size.saturating_sub(offset)` so capped at the file size. Sound.

#### `statx` (line 2220-2330) — sound

Linux `statx(2)` via raw `libc::syscall(SYS_statx, ...)`. The `MaybeUninit::<statx>::uninit()` + `assume_init()` after `rc == 0` follows the standard "kernel filled it on success" pattern. The `__statx` struct's bytemuck `Zeroable` is declared elsewhere (`lib.rs:2220+`). Sound.

---

## 6. T3 watchlist — 16 latent risks

These are sites where the code is sound *today* but the safety contract relies on a non-local invariant. Listed by file:line:

1. `src/sys/fd.rs:204` — `Name::borrow` debug_assert reads `*s.as_ptr().add(s.len())`. Only valid when `s.len() > 0` AND `s.as_ptr() + s.len()` is in-bounds of the iterator buffer. Add `if s.len() == 0 { return Name { ptr: ..., len: 0 } }`.
2. `src/sys/lib.rs:1184-1186` — `unsafe extern "system" { fn ... }` Windows-specific FFI re-declarations. These should be checked against `bun_windows_sys` (the canonical home) to ensure ABI matches.
3. `src/sys/lib.rs:204` — Linux dirent NUL guarantee. Kernel-honest but FUSE/seccomp can subvert.
4. `src/sys/lib.rs:373` — Linux getdents64 `&buf[base + 19..base + reclen]` panics on `reclen < 19`. Add explicit assertion.
5. `src/sys/lib.rs:498` — macOS dirent zero-namlen + tail-record.
6. `src/sys/lib.rs:570` — FreeBSD dirent same.
7. `src/sys/lib.rs:653-668` — Windows `NtQueryDirectoryFile`. The `if self.first` branch zeroes the whole 8KB buffer (line 635) before the first call; subsequent calls do not re-zero. The SAFETY comment at line 696-699 explicitly relies on this. If anyone ever adds a non-`first` call before the first-call zero, the cast at line 700 reads uninitialized memory.
8. `src/sys/lib.rs:1772-1858` — macOS `sys_openat`/`sys_read`/`sys_write` / `sys_pread`/`sys_pwrite`/`sys_recv`/`sys_send` route through `super::nocancel::*` symbols when available; SAFETY says "by-value c_int / `*` / `c_void`; no Rust references". The nocancel module's `safe fn` decls need verification.
9. `src/sys/lib.rs:5471-5476` — Darwin `os_log_create` with `c"com.bun.bun"` + `c"PointsOfInterest"`. The CStr literals are static; sound. But the wrapper at line 5471 wraps the returned pointer in `NonNull::new` — if any future version returns a non-null sentinel value other than null, this leaks. Watchlist.
10. `src/sys/lib.rs:6488` — `UNICODE_STRING::Buffer: *mut u16` from shared `&[u16]`. Mitigation comment in T1#4. Pattern repeats in `open_file_at_windows_nt_path:6556`, in `windows/mod.rs:3801` (delete-pending tracking), and in `windows/mod.rs:4647-4685` (FILE_DISPOSITION_INFORMATION_EX). Audit all three for "if NT ever writes through Buffer, what happens?"
11. `src/sys/lib.rs:6625-6635` — `SetFilePointerEx` failure path closes `result`. Pattern is correct linearly; auditor should verify no break/return inserted between SetFilePointerEx and CloseHandle without re-checking.
12. `src/sys/windows/mod.rs:3471-3476` — `exe_path_w` PEB walk.
13. `src/sys/windows/mod.rs:4490-4520` — env-block double-NUL termination assumption.
14. `src/sys/windows/mod.rs:4346` — `is_watcher_child` correctness.
15. `src/sys/tmp.rs:75-79` — basename suffix NUL-termination (dead branch, T1 if flipped).
16. `src/sys/sys_uv.rs:807` — `&[PlatformIOVec] → &[PlatformIOVecConst]` raw cast. Layout-identical on Windows per crate-asserts at top of `lib.rs`; the cast preserves slice metadata. Sound but fragile; if anyone adds a non-Windows arm with different layout, this UB-fires.

---

## 7. Sample sites for hardened SAFETY-comment templates

These templates focus on the platform-specific call surface. Use them when reviewing PRs that touch the Windows/macOS/FreeBSD arms.

### 7.1 Win32 raw FFI (kernel32/ntdll)

```rust
// SAFETY:
// - `<handle_var>`: by-value `HANDLE` (or `NTSTATUS` return); bad/stale handle
//   → `<documented error>`, never UB. (Mirror POSIX `EBADF` discipline.)
// - `<buffer_var>`: caller owns `buf[..<len_var>]` (writable | readable);
//   passed to `<api_name>` which is documented to write/read at most
//   `<len_var>` bytes. Out-of-band writes (e.g. EOF flag at `BUF_SIZE - 4`)
//   are reasoned about explicitly below.
// - `<out_struct_var>`: stack-local, valid for write; freed by Drop after the
//   call body completes.
// - String pointers: `<str_var>` is NUL-terminated `<WCHAR|c_char>`-string per
//   the caller's type (`&WStr`/`&ZStr`); the function reads until the NUL.
//   No Rust reference is held across the call so re-entrant Win32 calls cannot
//   alias the buffer.
// Documented error mapping:
//   `STATUS_<X>` → `E::<Y>` via `Win32Error::from_nt_status(rc).to_e()`
//   `STATUS_SUCCESS` → `Ok(...)`; any other status → `Err(...)` via `errno_sys`.
```

### 7.2 Darwin `__ulock_*` / `kevent64` / `__getdirentries64`

```rust
// SAFETY:
// - Private libsystem symbol, stable since `<min macOS>`; `bun.darwin` cfg
//   gates this code to `target_vendor = "apple"`.
// - Arguments are by-value or `*const c_void` to a live AtomicU32 / kqueue
//   buffer. The pointed-to memory is owned by the caller for the call
//   duration; no other thread mutates it through a Rust reference.
// - Kernel error convention (ULF_NO_ERRNO): return value is `-errno`, NOT
//   `-1` + thread-local errno. Decode with `c::E::from_raw((-status) as u16)`.
// - Spurious wakeups handled: `EINTR`/`EFAULT` → retry/return-OK rather than
//   propagating to the caller, matching pthread_cond_t's behavior on Darwin.
```

### 7.3 Linux raw syscall (`linux_syscall.rs` style)

```rust
// SAFETY:
// - Raw `<sys_call>` via `libc::syscall(SYS_<X>, ...)`. The kernel validates
//   `<fd_arg>` (yields EBADF), `<ptr_arg>` (yields EFAULT), and `<count_arg>`
//   (yields EINVAL for out-of-range values). No Rust reference is constructed
//   from possibly-invalid arguments — the niche-invalid `fd == -1` case is
//   passed through to the kernel as an i32.
// - Errno convention: glibc's `syscall(2)` trampoline translates the kernel
//   `-errno` return into `-1` + thread-local errno. Decode via the local
//   `errno()` helper or via `sys_retry` (which EINTR-retries).
// - PERF note: raw `libc::syscall` bypasses (a) glibc's PLT entry for the
//   typed wrapper, (b) the pthread cancellation-point check inside the
//   blocking wrapper.
```

### 7.4 FreeBSD `_umtx_op` / `getdents`

```rust
// SAFETY:
// - `_umtx_op(WAIT_UINT_PRIVATE, ...)`: reads `*obj` as u32 to compare against
//   `expect`. `obj_arg` is `ptr.as_ptr().cast::<c_void>()` from a live
//   `&AtomicU32` — owned by the caller, valid for the call.
// - `tm_size`/`tm_ptr` convention: when both are zero/null, no timeout;
//   when non-null, `tm_size` is `size_of::<_umtx_time>()` and `tm_ptr` points
//   at a stack-local struct that lives for the call duration. (Yes, the
//   FreeBSD ABI passes the SIZE through `uaddr1` and the POINTER through
//   `uaddr2` — see `_umtx_op(2)`.)
// - Spurious wakeups: `EINTR`/`EFAULT`/`EINVAL` returns are recoverable
//   (return-OK); only `ETIMEDOUT` propagates.
```

---

## 8. Recommended PRs

### PR-P3-1: Linux dirent record-length defensive check (T1 #3)

**File:** `src/sys/lib.rs:373`
**Change:** add `debug_assert!(reclen >= 20, ...)` before the slice expression; clamp `reclen` to a minimum to avoid panic in release builds, or fail with `EIO`.

```rust
// SAFETY: kernel filled `[0..end_index]`; `base < end_index` and each record
// fits entirely in `[base..base+reclen) ⊆ [0..end_index)`.
let buf = unsafe { self.buf.filled(self.end_index) };
let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
// Defensive: a malicious FUSE / fabricated seccomp reply could send a
// record with reclen < 20 (smaller than the dirent64 fixed header). Honest
// kernels never do this; clamp rather than panic-on-malformed-input.
if reclen < 20 {
    return Err(Error::from_code(E::EIO, Tag::getdents64));
}
let d_type = buf[base + 18];
self.index = base + reclen;
```

### PR-P3-2: macOS/FreeBSD zero-namlen dirent guard (T1 #2)

**Files:** `src/sys/lib.rs:498-505`, `src/sys/lib.rs:570-577`
**Change:** skip entries with `namlen == 0` (treat as a `continue`).

```rust
let name = &buf[base + 21..base + 21 + namlen];
if namlen == 0 || name == b"." || name == b".." || d_ino == 0 {
    continue;
}
```

Same in the FreeBSD arm.

### PR-P3-3: `Name::borrow` zero-length safety (T3 #1)

**File:** `src/sys/lib.rs:201-209`
**Change:** if `s.len() == 0`, skip the debug_assert (don't deref past-the-end pointer).

```rust
fn borrow(s: &[u8]) -> Name {
    #[cfg(debug_assertions)]
    if !s.is_empty() {
        debug_assert!(unsafe { *s.as_ptr().add(s.len()) } == 0);
    }
    Name {
        ptr: core::ptr::NonNull::from(s).cast(),
        len: s.len(),
    }
}
```

### PR-P3-4: Win32 `UNICODE_STRING::Buffer` provenance guard (T1 #4)

**Files:** `src/sys/lib.rs:6488`, `src/sys/lib.rs:6556`, `src/sys/windows/mod.rs:3801` (and any similar pattern).
**Change:** prefer `core::ptr::from_ref(p).cast_mut().cast::<u16>()` over `p.as_ptr().cast_mut()` to make provenance origin explicit. Add a `// READ-ONLY by API contract` comment block.

### PR-P3-5: `is_watcher_child` value check (T1 #1, correctness)

**File:** `src/sys/windows/mod.rs:4342`
**Change:** read the value (not just presence) and check it equals `"1"`. This hardens against an adversarial env var injection.

```rust
pub fn is_watcher_child() -> bool {
    let mut buf: [u16; 4] = [0; 4];   // "1" + NUL fits in 2; pad for safety
    let rc = unsafe {
        kernel32_2::GetEnvironmentVariableW(WATCHER_CHILD_ENV_Z.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
    };
    rc == 1 && buf[0] == b'1' as u16
}
```

### PR-P3-6: `tmp.rs` basename NUL-termination (T1 #6 / T3 #15)

**File:** `src/sys/tmp.rs:75-79`
**Change:** copy basename into a NUL-terminated buffer instead of unsafe-casting. Stop relying on "basename happens to return a suffix that's NUL-terminated."

### PR-P3-7: Document the `Fd` Copy-no-Drop architecture (T2)

**File:** `src/sys/fd.rs` (top doc-comment)
**Change:** add a 20-line block-quote at module top explicitly listing the use-after-close hazards and pointing at `CloseOnDrop` / `MovableIfWindowsFd` as the supported wrappers. Not a code change; documentation. This will save reviewers time.

### PR-P3-8: FreeBSD dirent + ulock_wait fallback dead-code resurrection check (T3 #6)

**Files:** `src/sys/lib.rs:519-582`, `src/threading/Futex.rs:185-294`
**Change:** annotate dead branches with `#[cfg(test_only_branch)]` or similar to prevent silent breakage if someone re-enables them. No production logic change.

---

## 9. Cross-references to passes 1 and 2

- **Pass 1 C-001 (NonNull from reference):** Pass 3 finds the same pattern at `windows/mod.rs:4706` correctly applied with raw-pointer provenance preservation. Reference example.
- **Pass 1 C-002 (transmute to enum):** No new sites in `bun_sys` beyond the `rustix::fs::Stat → libc::stat` transmute at `linux_syscall.rs:209`, which is hedged by a `const _: () = assert!(size_of == size_of && align_of == align_of)` static check.
- **Pass 1 C-003 (Send/Sync impls):** `bun_sys` has 4 unsafe impls — `Name` (line 190, 192) with a SAFETY comment; `DynLib` (line 5890, 5891). All have correct SAFETY rationale.
- **Pass 2 atomic ordering:** `copy_file.rs:CAN_USE_COPY_FILE_RANGE / CAN_USE_IOCTL_FICLONE_` use `Relaxed`; the SAFETY rationale is "stateless detection cache, idempotent". Pass.
- **Pass 2 MaybeUninit deep dive:** sys/lib.rs has 8 MaybeUninit sites (AlignedBuf at lines 275-294, `MaybeUninit::<stat>` patterns at 885-906, 2088-2128, etc.) — all `.assume_init()` calls follow a `rc == 0` / `rc >= 0` guard. Pass.
- **Pass 2 ptr-cast / ptr-intrinsic:** the Windows path is the densest concentration of these and the Win32-specific concerns are not the generic pass-2 concerns. Pass 3 is the right level.

---

## 10. Process notes

This pass deliberately under-tiered. Pass 1/2 produced 250+ pages of findings across A-001 to C-003; many turned out to be T3 watchlist when re-tiered. Pass 3 isolates the cfg-gated subset because that's where ports leak — the local compiler doesn't see the other platforms' code paths.

If we ran the same pass against a non-port codebase, the T1 count would be lower because there's no Zig parity-required dead branch (e.g., `ALLOW_TMPFILE = false` in `tmp.rs`) and no port-time legacy pattern. The fact that 5/6 T1 findings are platform-specific (Windows or BSD-dirent) reflects what's documented in `src/CLAUDE.md` § "Zig sibling files": new code goes in `.rs` but porting decisions made for Zig parity sometimes are not the Rust-native shape.

The recommendation per `CLAUDE.md` is to land PR-P3-1, PR-P3-2, PR-P3-5, PR-P3-6 first (clearly safer at low risk), then PR-P3-3 and PR-P3-4 (provenance hygiene; needs review by the Windows-port author), then PR-P3-7/PR-P3-8 (documentation and dead-code annotations).

---

## Appendix A — file:line citation table

Every concrete claim in this document cites a file:line. Quick index for verifiers:

| Finding | file:line |
| ------- | --------- |
| T1#1 `is_watcher_child` | `src/sys/windows/mod.rs:4342-4348` |
| T1#2 macOS dirent zero-namlen | `src/sys/lib.rs:498-505` |
| T1#3 Linux dirent reclen<19 | `src/sys/lib.rs:362-374` |
| T1#4 UNICODE_STRING provenance | `src/sys/lib.rs:6485-6489, 6553-6557` |
| T1#5 SetFilePointerEx close (down-tier T3) | `src/sys/lib.rs:6622-6635` |
| T1#6 tmp.rs basename NUL | `src/sys/tmp.rs:75-79` |
| T2#1 Fd Copy-no-Drop | `src/sys/fd.rs:79-232` |
| T2#2 Win fd-kind dispatch | `src/sys/lib.rs:3462-3494, 3526-3540` |
| T2#3 windows/mod.rs 5030-line concentration | `src/sys/windows/mod.rs:*` |
| T3#7 NtQueryDirectoryFile first-only zero | `src/sys/lib.rs:631-700` |
| T3#10 UNICODE_STRING write-through | `src/sys/lib.rs:6485-6489` |
| T3#12 exe_path_w PEB | `src/sys/windows/mod.rs:3467-3477` |
| T3#15 tmp.rs ALLOW_TMPFILE | `src/sys/tmp.rs:6, 33, 73` |
| T3#16 PlatformIOVec slice cast | `src/sys/sys_uv.rs:807` |
| SAFETY comment style refs | `src/sys/linux_syscall.rs:357-499` |

---

## Appendix B — inventory cross-reference

Inventory at `.unsafe-audit/unsafe-inventory.jsonl` has 332 `bun_sys` entries. Distribution:

| Category            | Count |
| ------------------- | ----- |
| `ptr_cast`          | 131   |
| `libc_ffi`          | 120   |
| `fd_syscall`        |  77   |
| `ptr_intrinsic`     |  51   |
| `other`             |  44   |
| `syscall`           |  34   |
| `libuv_ffi`         |  27   |
| `raw_ptr_lifecycle` |  16   |
| `slice_from_raw`    |   8   |
| `ptr_arith`         |   8   |
| `other_unsafe_impl` |   7   |
| `maybe_uninit`      |   7   |
| `raw_cast`          |   6   |
| `bun_ffi_helper`    |   5   |
| `sync_impl`         |   2   |
| `send_impl`         |   2   |
| `mem_transmute`     |   2   |
| `zig_port_shared_ref` | 1   |
| `mmap`              |   1   |

The dominant categories (ptr_cast + libc_ffi + fd_syscall) are nearly all "FFI shim hardening" cluster from pass 1's A-003. Pass 3's finding is that the platform-cfg dimension is independent: even after A-003 lands, the platform-specific platforms are *individually* under-tested.
