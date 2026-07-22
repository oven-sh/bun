# libuv Windows error-translation / propagation audit

Scope: `oven-sh/libuv` branch `bun` @ 9687330, all of `src/win/*.c` (21 files, ~27k LOC).

Goal: find every place where a Windows error code is dropped, mistranslated, or read from the wrong source (stale `GetLastError()`, NTSTATUS vs Win32 confusion, wrong sign, wrong macro).

Every HIGH and MEDIUM finding below was individually re-verified against the source after the initial sweep. All HIGH and most MEDIUM findings are also present in upstream `libuv/libuv` `v1.x` as of this writing and look upstreamable; none had an existing upstream issue or PR that I could find.

---

## Summary

| severity | count | effect                                                          |
|----------|-------|-----------------------------------------------------------------|
| HIGH     | 5     | reports **success** on failure, or positive errno from public API |
| MEDIUM   | 8     | wrong `UV_E*` code reported (`UV_UNKNOWN` instead of real code)  |
| LOW      | 7     | latent / style / unreachable-in-practice                         |

`pipe.c` is the worst offender (4 distinct bugs). `fs.c` follows (5). The dominant anti-pattern is **"the value fed to `uv_translate_sys_error()` / `SET_REQ_*` is not actually a Win32 error"**: a stale `GetLastError()`, a negative `UV_E*` fed to a Win32-only macro, or an API whose error is its return value rather than last-error.

---

## HIGH: can report success when the operation failed

### H1. `pipe.c:uv__set_pipe_handle` returns 0 when `NtQueryInformationFile` fails
`src/win/pipe.c` ~L507-L549 · also in upstream v1.x

```c
DWORD err = 0;
...
if (!SetNamedPipeHandleState(pipeHandle, &mode, NULL, NULL)) {
  err = GetLastError();
  ...  /* may fall through with err == ERROR_ACCESS_DENIED */
}
nt_status = pNtQueryInformationFile(pipeHandle, &io_status, &mode_info,
                                    sizeof(mode_info), FileModeInformation);
if (nt_status != STATUS_SUCCESS) {
  return uv_translate_sys_error(err);   /* err is 0 on the common path */
}
```

On the normal path `SetNamedPipeHandleState` succeeds and `err` stays `0`. If the NT call then fails, `uv_translate_sys_error(0)` returns `0`. NT APIs do not set last-error, so even when `err == ERROR_ACCESS_DENIED` from the earlier fallthrough it is still the wrong error.

**Effect:** `uv_pipe_open` / connect callback treat the handle as successfully attached when the mode probe failed; caller proceeds with an un-probed handle.

**Fix:** `return uv_translate_sys_error(pRtlNtStatusToDosError(nt_status));`

### H2. `pipe.c:uv_pipe_chmod` calls `GetLastError()` after APIs that return the error directly
`src/win/pipe.c` ~L2737-L2786 · also in upstream v1.x

```c
if (GetSecurityInfo(handle->handle, ..., &old_dacl, NULL, &sd)) {
  error = GetLastError();        /* wrong: return value IS the error */
  goto clean_sid;
}
...
if (SetEntriesInAcl(1, &ea, old_dacl, &new_dacl)) {
  error = GetLastError();        /* wrong */
  goto clean_sd;
}
if (SetSecurityInfo(handle->handle, ...)) {
  error = GetLastError();        /* wrong */
  goto clean_dacl;
}
...
return uv_translate_sys_error(error);
```

`GetSecurityInfo`, `SetEntriesInAcl` and `SetSecurityInfo` return a `DWORD` error code and are not documented to set last-error. `GetLastError()` here is whatever some earlier call left (often 0).

**Effect:** `uv_pipe_chmod()` can return 0 (success) when the ACL change actually failed.

**Fix:** `error = GetSecurityInfo(...); if (error != ERROR_SUCCESS) goto clean_sid;` (same for the other two).

### H3. `pipe.c:uv_pipe` returns a positive Win32 error from a public negative-errno API
`src/win/pipe.c` ~L394-L401 · also in upstream v1.x

```c
err = uv__create_pipe_pair(&readh, &writeh, read_flags, write_flags, 0,
                           (uintptr_t) &fds[0]);
if (err != 0)
  return err;     /* err is a raw positive GetLastError() value */
```

`uv__create_pipe_pair()` (and `uv__pipe_server()` beneath it) return a raw positive `GetLastError()` on failure.

**Effect:** callers that test `r < 0` treat the failure as success; `uv_strerror(r)` prints "Unknown system error N".

**Fix:** `return uv_translate_sys_error(err);`

### H4. `poll.c:uv__slow_poll_thread_proc` writes the error to the wrong req slot
`src/win/poll.c` ~L298-L304 · also in upstream v1.x

```c
r = select(1, &rfds, &wfds, &efds, &timeout);
if (r == SOCKET_ERROR) {
  SET_REQ_ERROR(&handle->poll_req_1, WSAGetLastError());   /* hard-coded slot 1 */
  POST_COMPLETION_FOR_REQ(handle->loop, req);              /* but completes `req` */
  return 0;
}
```

`req` (the function argument) may be `&handle->poll_req_2`. The completion is posted for `req`, but the error is written to slot 1.

**Effect:** when `req == &poll_req_2`, `uv__slow_poll_process_poll_req` sees `REQ_SUCCESS(req)` and delivers stale events to `poll_cb` instead of an error; also stomps slot 1 which may be in flight on another worker thread.

**Fix:** `SET_REQ_ERROR(req, WSAGetLastError());`

### H5. `fs.c:fs__realpath` treats `UV_ENOMEM` from `uv_utf16_to_wtf8` as success
`src/win/fs.c` ~L3038-L3041, L3060-L3070 · also in upstream v1.x

```c
/* fs__realpath_handle */
r = uv_utf16_to_wtf8(w_realpath_ptr, w_realpath_len, realpath_ptr, NULL);
uv__free(w_realpath_buf);
return r;            /* can be UV_ENOMEM (-4057) */

/* fs__realpath */
if (fs__realpath_handle(handle, (char**) &req->ptr) == -1) {  /* misses -4057 */
  ...
}
req->flags |= UV_FS_FREE_PTR;
SET_REQ_RESULT(req, 0);
```

**Effect:** `uv_fs_realpath` reports success with `req->ptr == NULL` on OOM.

**Fix:** test `!= 0`; on that branch propagate the negative UV code directly, do not read `GetLastError()`.

---

## MEDIUM: wrong error code reported

### M1. `fs.c:fs__filemap_ex_filter` reads `ExceptionInformation[3]` instead of `[2]`
`src/win/fs.c` ~L710-L718 · also in upstream v1.x

```c
if (pep->ExceptionRecord->NumberParameters >= 3) {
  NTSTATUS status = (NTSTATUS)pep->ExceptionRecord->ExceptionInformation[3];
```

For `EXCEPTION_IN_PAGE_ERROR`, the underlying NTSTATUS is in `ExceptionInformation[2]` (per MSDN: the third array element, 0-indexed). Index `[3]` is unpopulated (0), so `pRtlNtStatusToDosError(0)` returns `ERROR_SUCCESS` and the code always falls through to `*perror = UV_UNKNOWN`.

**Effect:** `UV_FS_O_FILEMAP` read/write failures always surface as `UV_UNKNOWN` instead of the real disk error (`UV_ENOSPC`, `UV_EIO`, ...).

**Fix:** read `ExceptionInformation[2]`.

### M2. `fs.c:fs__sendfile` passes `-1` to `SET_REQ_RESULT`
`src/win/fs.c` ~L2468-L2498 · also in upstream v1.x

On any `_lseeki64`/`_read`/`_write` failure, `result = -1` reaches `SET_REQ_RESULT(req, result)`, which `assert(req->result != -1)`. The CRT `_doserrno` is dropped.

**Effect:** debug builds abort; release returns `-1` ("Unknown system error -1"), actual error lost.

**Fix:** on failure `SET_REQ_WIN32_ERROR(req, _doserrno)` (captured before `uv__free`) and return.

### M3. `pipe.c:uv_pipe` compares `errno == UV_EMFILE` (always false)
`src/win/pipe.c` ~L402-L420 · also in upstream v1.x

```c
temp[0] = _open_osfhandle((intptr_t) readh, 0);
if (temp[0] == -1) {
  if (errno == UV_EMFILE)    /* errno is +24, UV_EMFILE is -4066 */
    err = UV_EMFILE;
  else
    err = UV_UNKNOWN;
```

**Effect:** `uv_pipe()` always returns `UV_UNKNOWN` when the CRT fd table is full.

**Fix:** `if (errno == EMFILE)`. Same defect duplicated at L413-L417.

### M4. `pipe.c:uv_pipe_connect` round-trips `UV_E*` through NTSTATUS, yielding `UV_UNKNOWN`
`src/win/pipe.c` ~L897-L906 (producer), L2344 (consumer) · also in upstream v1.x

`uv_pipe_connect2` returns `UV_EINVAL`/`UV_ENOMEM`; `SET_REQ_ERROR(req, err)` stores the negative value as-is (per libuv's `NTSTATUS_FROM_WIN32` passthrough for `<= 0`); later `GET_REQ_ERROR` → `pRtlNtStatusToDosError(0xFFFFF019)` → `ERROR_MR_MID_NOT_FOUND` → `UV_UNKNOWN`.

**Effect:** `connect_cb` gets `UV_UNKNOWN` instead of `UV_EINVAL`/`UV_ENOMEM` for early validation failures.

**Fix:** map to Win32 before stashing (`ERROR_INVALID_PARAMETER`/`ERROR_NOT_ENOUGH_MEMORY`), or deliver `err` to the callback without the NTSTATUS round-trip.

### M5. `pipe.c:uv__process_pipe_write_req` uses the wrong translator for write errors
`src/win/pipe.c` ~L2257-L2269

The sync path (`uv_write` → `stream.c:134`) uses `uv_translate_write_sys_error()`, mapping `ERROR_BROKEN_PIPE`/`ERROR_NO_DATA` → `UV_EPIPE`. The async completion uses plain `uv_translate_sys_error()`, mapping `ERROR_BROKEN_PIPE` → `UV_EOF`.

**Effect:** writing to a closed pipe delivers `UV_EOF` (a read-side code) to `write_cb` instead of `UV_EPIPE`; inconsistent with the sync path and with Unix.

**Fix:** `req->cb(req, uv_translate_write_sys_error(err));`

### M6. `tty.c:uv__tty_move_caret` missing `return -1` after `GetConsoleScreenBufferInfo` failure
`src/win/tty.c` ~L1262-L1277 · also in upstream v1.x

```c
retry:
  if (!GetConsoleScreenBufferInfo(handle->handle, &info)) {
    *error = GetLastError();
    /* missing: return -1; */
  }
  pos = uv__tty_make_real_coord(handle, &info, ...);   /* reads uninit `info` */
```

Siblings (`uv__tty_reset`, `uv__tty_clear`, `uv__tty_save_state`) all `return -1` here.

**Effect:** wrong error reported, and potential tight `goto retry` loop on a bad console handle.

**Fix:** add `return -1;`.

### M7. `fs.c:fs__readdir` reads stale `GetLastError()` on UTF-8 conversion failure
`src/win/fs.c` ~L1684-L1709

`uv__convert_utf16_to_utf8` returns `UV_ENOMEM`/`UV_EINVAL` and does not set last-error; the `error:` label reads `GetLastError()` (value from the preceding successful `FindNextFileW`).

**Effect:** on OOM, `req->result` becomes an unrelated/zero error.

**Fix:** handle `r != 0` with `SET_REQ_UV_ERROR(req, r, ERROR_OUTOFMEMORY)` instead of `goto error`.

### M8. `fs.c:fs__readlink` reads stale `GetLastError()` when `uv_utf16_to_wtf8` fails
`src/win/fs.c` ~L318-L319, L2976-L2983

Same shape as M7: terminal `uv_utf16_to_wtf8` returns `UV_ENOMEM` without touching last-error; caller reads `GetLastError()` from the preceding successful `DeviceIoControl`.

**Fix:** `SetLastError(ERROR_OUTOFMEMORY)` on failure in `fs__readlink_handle`, or propagate the UV code directly.

---

## LOW: latent / defensive / cosmetic

### L1. `GetLastError()` read after an intervening `uv__free()` / `CloseHandle()` / `SetFilePointerEx()`
`uv__free` saves/restores `errno` but not `GetLastError()`; `CloseHandle`/`SetFilePointerEx` are permitted to modify last-error on success. In practice the default allocator and these calls on success do not change it, so this is latent.

Locations:
- `util.c`: `uv_os_setenv` L1376-L1381, `uv_os_unsetenv` L1399-L1403, `uv_chdir` L221-L223, `uv_os_tmpdir` L1042-L1046, `uv__cwd` L164-L170
- `fs-event.c`: `uv_fs_event_start` L262-L279
- `pipe.c`: `uv__pipe_queue_accept` L1157-L1165, `pipe_connect_thread_proc` L864-L881
- `fs.c`: `fs__read` L880-L888, `fs__write` L1085-L1093
- `core.c`: `uv__poll` L535-L576

### L2. `fs.c:fs__access` uses `SET_REQ_WIN32_ERROR(req, UV_EPERM)`
`src/win/fs.c` ~L2522

`uv_translate_sys_error`'s `<=0` passthrough makes `req->result` correct, but `uv_fs_get_system_error()` returns garbage (4294963248). Same anti-pattern at L617 and L1376 with `UV_UNKNOWN`. Fix: `SET_REQ_UV_ERROR(req, UV_EPERM, ERROR_ACCESS_DENIED)`.

### L3. `process.c:uv_spawn` reads `GetLastError()` on `r >= buflen` branch
`src/win/process.c` ~L972-L976, L1002-L1006

`GetCurrentDirectoryW`/`GetEnvironmentVariableW` returning `r >= buflen` is a success (buffer-too-small) that does not set last-error; requires a TOCTOU race with another thread to hit.

### L4. `process.c:make_program_env` misleading errno in abort message
`src/win/process.c` ~L752-L757 · abort-only diagnostic quality.

### L5. `fs.c:fs__statfs` reports original `ERROR_DIRECTORY` when `GetFullPathNameW` fails
`src/win/fs.c` ~L3126-L3134 · likely semi-intentional fallback.

### L6. `winsock.c:uv__ntstatus_to_winsock_error` loose facility-mask test
`src/win/winsock.c` ~L240-L249 · `(status & (FACILITY_NTWIN32 << 16))` only checks bits 16-18; AFD does not produce colliding facilities in practice. Fix: mask with `0x0FFF0000`.

### L7. `GetLastError()` after `getsockopt()` (should be `WSAGetLastError()`)
`tcp.c` ~L1562-L1568; `udp.c` ~L91-L96, ~L921-L928 · cosmetic on Windows (same TLS slot).

---

## Dropped (verified not-bugs)

- `tty.c:uv_process_tty_read_raw_req` L866-L897: `uv_utf16_to_wtf8` into an 8-byte preallocated buffer with 1-2 UTF-16 units cannot fail, so the "stale GetLastError()" branch is unreachable.
- `util.c:uv_os_environ` L1232-L1234: returning 0 with an empty list when `GetEnvironmentStringsW` returns NULL is intentional best-effort behavior.
- `getaddrinfo.c:uv_if_indextoiid` L376-L379: `snprintf("%d", ...)` cannot return `< 0`.
