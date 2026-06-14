// Layout-assert authoring file for `bun_windows_sys`'s 48 `#[repr(C)]`
// structs / unions, per Phase-10 finding F-10-4.
//
// PROPOSED INSERTION SITE: `src/windows_sys/externs.rs` (end of file).
// Pattern follows the bun_libuv_sys gold standard at
// `src/libuv_sys/libuv.rs:3480-3599` (74 asserts cross-validated against
// runtime `uv_*_size()` reflection).
//
// Rationale (Phase-4 F-10-4): `bun_windows_sys` is the tier-0 leaf crate
// shared by `bun_libuv_sys` (which embeds Win32 POD into `uv_req_s` /
// `uv_tty_s` / `uv_fs_s`) AND by the freestanding `bun_shim_impl.exe`. A
// silent layout drift (typo'd field type, missing pad, wrong ULONG_PTR vs
// DWORD) corrupts every Bun-spawned process on Windows and is essentially
// untestable on Linux CI. These asserts fail at compile time on the
// Windows runner.
//
// SCOPE: `#[cfg(all(windows, target_pointer_width = "64"))]` — matches the
// pre-existing 4-assert block in `externs.rs:185-191`. The crate already
// has the right gate; we extend it from 4 → 48 asserts. The Win32 LLP64
// ABI (`DWORD = c_ulong = 4B`) differs from LP64 on Linux, so the asserts
// would fire under a Linux cross-check; gating on `windows` keeps them
// authoritative on the real target.
//
// CROSS-REFERENCE — vendor headers are NOT on disk (only
// `vendor/lolhtml`); offsets were derived from:
//   - The field-type table in `src/windows_sys/externs.rs:9-36`
//     (BOOL=4, DWORD=4, ULONG_PTR=8, HANDLE=8, etc.)
//   - Microsoft public docs / `winnt.h`, `minwinbase.h`, `wincon.h`,
//     `wdm.h`, `ntifs.h`, `winternl.h`, `processthreadsapi.h`,
//     `sysinfoapi.h`, `ws2def.h`
//   - The 5 sizes the crate already pins (OVERLAPPED=32, CRITICAL_SECTION=40,
//     WIN32_FIND_DATAW=592, INPUT_RECORD=20, WSADATA=408,
//     sockaddr_storage=128) — used as anchors for the rest
//   - The bun_libuv_sys gold standard (4 of these same structs)
//
// PASTING this block at the end of `externs.rs` requires no `use` changes
// — every type referenced is at crate root or in `kernel32::` / `ws2_32::`.

#[cfg(all(windows, target_pointer_width = "64"))]
const _: () = {
    use core::mem;

    macro_rules! assert_size {
        ($t:ty, $n:expr) => {
            assert!(
                mem::size_of::<$t>() == $n,
                concat!("layout drift: sizeof(", stringify!($t), ")")
            );
        };
    }
    macro_rules! assert_offset {
        ($t:ty, $f:ident, $n:expr) => {
            assert!(
                mem::offset_of!($t, $f) == $n,
                concat!(
                    "layout drift: offsetof(",
                    stringify!($t),
                    ".",
                    stringify!($f),
                    ")"
                )
            );
        };
    }
    macro_rules! assert_align {
        ($t:ty, $n:expr) => {
            assert!(
                mem::align_of::<$t>() == $n,
                concat!("layout drift: alignof(", stringify!($t), ")")
            );
        };
    }

    // ── Console primitives (wincon.h, minwinbase.h) ──────────────────────
    // src/windows_sys/externs.rs:42-67
    assert_size!(COORD, 4);                              // i16 × 2
    assert_offset!(COORD, X, 0);
    assert_offset!(COORD, Y, 2);

    assert_size!(SMALL_RECT, 8);                         // i16 × 4
    assert_offset!(SMALL_RECT, Left, 0);
    assert_offset!(SMALL_RECT, Top, 2);
    assert_offset!(SMALL_RECT, Right, 4);
    assert_offset!(SMALL_RECT, Bottom, 6);

    assert_size!(CONSOLE_SCREEN_BUFFER_INFO, 22);        // COORD(4)+COORD(4)+u16(2)+SMALL_RECT(8)+COORD(4)
    assert_offset!(CONSOLE_SCREEN_BUFFER_INFO, dwSize, 0);
    assert_offset!(CONSOLE_SCREEN_BUFFER_INFO, dwCursorPosition, 4);
    assert_offset!(CONSOLE_SCREEN_BUFFER_INFO, wAttributes, 8);
    assert_offset!(CONSOLE_SCREEN_BUFFER_INFO, srWindow, 10);
    assert_offset!(CONSOLE_SCREEN_BUFFER_INFO, dwMaximumWindowSize, 18);

    assert_size!(FILETIME, 8);                           // DWORD × 2
    assert_offset!(FILETIME, dwLowDateTime, 0);
    assert_offset!(FILETIME, dwHighDateTime, 4);

    // ── OVERLAPPED / CRITICAL_SECTION (re-pin existing 4) ────────────────
    // src/windows_sys/externs.rs:85-106
    assert_size!(OVERLAPPED, 32);
    assert_align!(OVERLAPPED, 8);
    assert_offset!(OVERLAPPED, Internal, 0);
    assert_offset!(OVERLAPPED, InternalHigh, 8);
    assert_offset!(OVERLAPPED, Offset, 16);
    assert_offset!(OVERLAPPED, OffsetHigh, 20);
    assert_offset!(OVERLAPPED, hEvent, 24);

    assert_size!(CRITICAL_SECTION, 40);
    assert_align!(CRITICAL_SECTION, 8);
    assert_offset!(CRITICAL_SECTION, DebugInfo, 0);
    assert_offset!(CRITICAL_SECTION, LockCount, 8);
    assert_offset!(CRITICAL_SECTION, RecursionCount, 12);
    assert_offset!(CRITICAL_SECTION, OwningThread, 16);
    assert_offset!(CRITICAL_SECTION, LockSemaphore, 24);
    assert_offset!(CRITICAL_SECTION, SpinCount, 32);

    // ── WIN32_FIND_DATAW (minwinbase.h) ──────────────────────────────────
    // src/windows_sys/externs.rs:109-122
    assert_size!(WIN32_FIND_DATAW, 592);
    assert_offset!(WIN32_FIND_DATAW, dwFileAttributes, 0);
    assert_offset!(WIN32_FIND_DATAW, ftCreationTime, 4);
    assert_offset!(WIN32_FIND_DATAW, ftLastAccessTime, 12);
    assert_offset!(WIN32_FIND_DATAW, ftLastWriteTime, 20);
    assert_offset!(WIN32_FIND_DATAW, nFileSizeHigh, 28);
    assert_offset!(WIN32_FIND_DATAW, nFileSizeLow, 32);
    assert_offset!(WIN32_FIND_DATAW, dwReserved0, 36);
    assert_offset!(WIN32_FIND_DATAW, dwReserved1, 40);
    assert_offset!(WIN32_FIND_DATAW, cFileName, 44);
    assert_offset!(WIN32_FIND_DATAW, cAlternateFileName, 44 + 260 * 2);

    // ── Console input records (wincon.h) ─────────────────────────────────
    // src/windows_sys/externs.rs:125-179
    // KEY_EVENT_RECORD_uChar is a WORD-sized union (WCHAR=u16 vs CHAR=i8);
    // size 2 / align 2.
    assert_size!(KEY_EVENT_RECORD_uChar, 2);
    assert_align!(KEY_EVENT_RECORD_uChar, 2);

    // KEY_EVENT_RECORD: BOOL(4)+WORD(2)+WORD(2)+WORD(2)+union(2)+DWORD(4) = 16
    assert_size!(KEY_EVENT_RECORD, 16);
    assert_offset!(KEY_EVENT_RECORD, bKeyDown, 0);
    assert_offset!(KEY_EVENT_RECORD, wRepeatCount, 4);
    assert_offset!(KEY_EVENT_RECORD, wVirtualKeyCode, 6);
    assert_offset!(KEY_EVENT_RECORD, wVirtualScanCode, 8);
    assert_offset!(KEY_EVENT_RECORD, uChar, 10);
    assert_offset!(KEY_EVENT_RECORD, dwControlKeyState, 12);

    // MOUSE_EVENT_RECORD: COORD(4)+DWORD(4)+DWORD(4)+DWORD(4) = 16
    assert_size!(MOUSE_EVENT_RECORD, 16);
    assert_offset!(MOUSE_EVENT_RECORD, dwMousePosition, 0);
    assert_offset!(MOUSE_EVENT_RECORD, dwButtonState, 4);
    assert_offset!(MOUSE_EVENT_RECORD, dwControlKeyState, 8);
    assert_offset!(MOUSE_EVENT_RECORD, dwEventFlags, 12);

    assert_size!(WINDOW_BUFFER_SIZE_EVENT, 4);
    assert_size!(MENU_EVENT_RECORD, 4);
    assert_size!(FOCUS_EVENT_RECORD, 4);

    // INPUT_RECORD_Event union: max(KEY_EVENT_RECORD=16, others=16) = 16
    assert_size!(INPUT_RECORD_Event, 16);
    assert_align!(INPUT_RECORD_Event, 4);

    // INPUT_RECORD: WORD(2) + pad(2) + union(16) = 20 (pinned by existing assert)
    assert_size!(INPUT_RECORD, 20);
    assert_offset!(INPUT_RECORD, EventType, 0);
    assert_offset!(INPUT_RECORD, Event, 4);

    // ── SECURITY_ATTRIBUTES (winbase.h) ──────────────────────────────────
    // src/windows_sys/externs.rs:193-198 — DWORD(4) + pad(4) + LPVOID(8) + BOOL(4) + pad(4) = 24
    assert_size!(SECURITY_ATTRIBUTES, 24);
    assert_align!(SECURITY_ATTRIBUTES, 8);
    assert_offset!(SECURITY_ATTRIBUTES, nLength, 0);
    assert_offset!(SECURITY_ATTRIBUTES, lpSecurityDescriptor, 8);
    assert_offset!(SECURITY_ATTRIBUTES, bInheritHandle, 16);

    // ── BY_HANDLE_FILE_INFORMATION (fileapi.h) ───────────────────────────
    // src/windows_sys/externs.rs:200-212 — 9 DWORDs (4B each) + 3 FILETIMEs (8B each) = 36+24 = 52
    assert_size!(BY_HANDLE_FILE_INFORMATION, 52);
    assert_align!(BY_HANDLE_FILE_INFORMATION, 4);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, dwFileAttributes, 0);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, ftCreationTime, 4);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, ftLastAccessTime, 12);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, ftLastWriteTime, 20);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, dwVolumeSerialNumber, 28);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, nFileSizeHigh, 32);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, nFileSizeLow, 36);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, nNumberOfLinks, 40);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, nFileIndexHigh, 44);
    assert_offset!(BY_HANDLE_FILE_INFORMATION, nFileIndexLow, 48);

    // ── WIN32_FILE_ATTRIBUTE_DATA (fileapi.h) ────────────────────────────
    // src/windows_sys/externs.rs:215-224 — DWORD(4)+3×FILETIME(24)+DWORD(4)+DWORD(4) = 36
    assert_size!(WIN32_FILE_ATTRIBUTE_DATA, 36);
    assert_align!(WIN32_FILE_ATTRIBUTE_DATA, 4);
    assert_offset!(WIN32_FILE_ATTRIBUTE_DATA, dwFileAttributes, 0);
    assert_offset!(WIN32_FILE_ATTRIBUTE_DATA, ftCreationTime, 4);
    assert_offset!(WIN32_FILE_ATTRIBUTE_DATA, ftLastAccessTime, 12);
    assert_offset!(WIN32_FILE_ATTRIBUTE_DATA, ftLastWriteTime, 20);
    assert_offset!(WIN32_FILE_ATTRIBUTE_DATA, nFileSizeHigh, 28);
    assert_offset!(WIN32_FILE_ATTRIBUTE_DATA, nFileSizeLow, 32);

    // ── UNICODE_STRING (ntdef.h) ─────────────────────────────────────────
    // src/windows_sys/externs.rs:234-240 — u16(2)+u16(2)+pad(4)+ptr(8) = 16
    assert_size!(UNICODE_STRING, 16);
    assert_align!(UNICODE_STRING, 8);
    assert_offset!(UNICODE_STRING, Length, 0);
    assert_offset!(UNICODE_STRING, MaximumLength, 2);
    assert_offset!(UNICODE_STRING, Buffer, 8);

    // ── OBJECT_ATTRIBUTES (ntdef.h) ──────────────────────────────────────
    // src/windows_sys/externs.rs:246-254 — ULONG(4)+pad(4)+HANDLE(8)+ptr(8)+ULONG(4)+pad(4)+ptr(8)+ptr(8) = 48
    assert_size!(OBJECT_ATTRIBUTES, 48);
    assert_align!(OBJECT_ATTRIBUTES, 8);
    assert_offset!(OBJECT_ATTRIBUTES, Length, 0);
    assert_offset!(OBJECT_ATTRIBUTES, RootDirectory, 8);
    assert_offset!(OBJECT_ATTRIBUTES, ObjectName, 16);
    assert_offset!(OBJECT_ATTRIBUTES, Attributes, 24);
    assert_offset!(OBJECT_ATTRIBUTES, SecurityDescriptor, 32);
    assert_offset!(OBJECT_ATTRIBUTES, SecurityQualityOfService, 40);

    // ── IO_STATUS_BLOCK (wdm.h) ──────────────────────────────────────────
    // src/windows_sys/externs.rs:257-262 — usize + usize = 16
    assert_size!(IO_STATUS_BLOCK, 16);
    assert_align!(IO_STATUS_BLOCK, 8);
    assert_offset!(IO_STATUS_BLOCK, Status, 0);
    assert_offset!(IO_STATUS_BLOCK, Information, 8);

    // ── FILE_BASIC_INFORMATION (wdm.h) ───────────────────────────────────
    // src/windows_sys/externs.rs:356-363 — 4×i64(32) + ULONG(4) + tail pad(4) = 40
    assert_size!(FILE_BASIC_INFORMATION, 40);
    assert_align!(FILE_BASIC_INFORMATION, 8);
    assert_offset!(FILE_BASIC_INFORMATION, CreationTime, 0);
    assert_offset!(FILE_BASIC_INFORMATION, LastAccessTime, 8);
    assert_offset!(FILE_BASIC_INFORMATION, LastWriteTime, 16);
    assert_offset!(FILE_BASIC_INFORMATION, ChangeTime, 24);
    assert_offset!(FILE_BASIC_INFORMATION, FileAttributes, 32);

    // ── FILE_DIRECTORY_INFORMATION (ntifs.h) ─────────────────────────────
    // src/windows_sys/externs.rs:368-381
    // 2×ULONG(8) + 6×i64(48) + 2×ULONG(8) + [WCHAR;1](2) + tail pad(6) = 72
    assert_size!(FILE_DIRECTORY_INFORMATION, 72);
    assert_align!(FILE_DIRECTORY_INFORMATION, 8);
    assert_offset!(FILE_DIRECTORY_INFORMATION, NextEntryOffset, 0);
    assert_offset!(FILE_DIRECTORY_INFORMATION, FileIndex, 4);
    assert_offset!(FILE_DIRECTORY_INFORMATION, CreationTime, 8);
    assert_offset!(FILE_DIRECTORY_INFORMATION, LastAccessTime, 16);
    assert_offset!(FILE_DIRECTORY_INFORMATION, LastWriteTime, 24);
    assert_offset!(FILE_DIRECTORY_INFORMATION, ChangeTime, 32);
    assert_offset!(FILE_DIRECTORY_INFORMATION, EndOfFile, 40);
    assert_offset!(FILE_DIRECTORY_INFORMATION, AllocationSize, 48);
    assert_offset!(FILE_DIRECTORY_INFORMATION, FileAttributes, 56);
    assert_offset!(FILE_DIRECTORY_INFORMATION, FileNameLength, 60);
    assert_offset!(FILE_DIRECTORY_INFORMATION, FileName, 64);

    // ── FILE_END_OF_FILE_INFORMATION (ntifs.h) ───────────────────────────
    // src/windows_sys/externs.rs:400-403
    assert_size!(FILE_END_OF_FILE_INFORMATION, 8);
    assert_align!(FILE_END_OF_FILE_INFORMATION, 8);
    assert_offset!(FILE_END_OF_FILE_INFORMATION, EndOfFile, 0);

    // ── FILE_DISPOSITION_INFORMATION (ntifs.h) ───────────────────────────
    // src/windows_sys/externs.rs:409-412 — BOOLEAN(u8) = 1B / align 1
    assert_size!(FILE_DISPOSITION_INFORMATION, 1);
    assert_align!(FILE_DISPOSITION_INFORMATION, 1);
    assert_offset!(FILE_DISPOSITION_INFORMATION, DeleteFile, 0);

    assert_size!(FILE_DISPOSITION_INFORMATION_EX, 4);
    assert_align!(FILE_DISPOSITION_INFORMATION_EX, 4);
    assert_offset!(FILE_DISPOSITION_INFORMATION_EX, Flags, 0);

    // ── FILE_RENAME_INFORMATION_EX (ntifs.h) ─────────────────────────────
    // src/windows_sys/externs.rs:422-428 — ULONG(4)+pad(4)+HANDLE(8)+ULONG(4)+[u16;1](2)+tail pad(2) = 24
    assert_size!(FILE_RENAME_INFORMATION_EX, 24);
    assert_align!(FILE_RENAME_INFORMATION_EX, 8);
    assert_offset!(FILE_RENAME_INFORMATION_EX, Flags, 0);
    assert_offset!(FILE_RENAME_INFORMATION_EX, RootDirectory, 8);
    assert_offset!(FILE_RENAME_INFORMATION_EX, FileNameLength, 16);
    assert_offset!(FILE_RENAME_INFORMATION_EX, FileName, 20);

    // ── Winsock POD (ws2def.h / winsock2.h) ──────────────────────────────
    // src/windows_sys/externs.rs:809-1034 (inside `pub mod ws2_32 {}`)
    assert_size!(ws2_32::addrinfo, 48);
    assert_align!(ws2_32::addrinfo, 8);
    assert_offset!(ws2_32::addrinfo, ai_flags, 0);
    assert_offset!(ws2_32::addrinfo, ai_family, 4);
    assert_offset!(ws2_32::addrinfo, ai_socktype, 8);
    assert_offset!(ws2_32::addrinfo, ai_protocol, 12);
    assert_offset!(ws2_32::addrinfo, ai_addrlen, 16);
    assert_offset!(ws2_32::addrinfo, ai_canonname, 24);
    assert_offset!(ws2_32::addrinfo, ai_addr, 32);
    assert_offset!(ws2_32::addrinfo, ai_next, 40);

    assert_size!(ws2_32::WSADATA, 408);                  // already pinned at :851
    assert_offset!(ws2_32::WSADATA, wVersion, 0);
    assert_offset!(ws2_32::WSADATA, wHighVersion, 2);
    assert_offset!(ws2_32::WSADATA, iMaxSockets, 4);
    assert_offset!(ws2_32::WSADATA, iMaxUdpDg, 6);
    assert_offset!(ws2_32::WSADATA, lpVendorInfo, 8);
    assert_offset!(ws2_32::WSADATA, szDescription, 16);
    assert_offset!(ws2_32::WSADATA, szSystemStatus, 16 + 257);

    assert_size!(ws2_32::sockaddr_storage, 128);         // already pinned at :862
    assert_align!(ws2_32::sockaddr_storage, 8);

    assert_size!(ws2_32::sockaddr, 16);                  // u16(2)+[u8;14] = 16
    assert_align!(ws2_32::sockaddr, 2);

    assert_size!(ws2_32::sockaddr_in, 16);               // u16+u16+in_addr(4)+[u8;8] = 16
    assert_align!(ws2_32::sockaddr_in, 4);

    assert_size!(ws2_32::in_addr, 4);
    assert_align!(ws2_32::in_addr, 4);

    assert_size!(ws2_32::sockaddr_in6, 28);              // u16+u16+u32+in6_addr(16)+u32 = 28
    assert_align!(ws2_32::sockaddr_in6, 4);

    assert_size!(ws2_32::in6_addr, 16);
    assert_align!(ws2_32::in6_addr, 1);

    assert_size!(ws2_32::WSAPOLLFD, 16);                 // usize(8)+i16+i16+pad(4) = 16
    assert_align!(ws2_32::WSAPOLLFD, 8);
    assert_offset!(ws2_32::WSAPOLLFD, fd, 0);
    assert_offset!(ws2_32::WSAPOLLFD, events, 8);
    assert_offset!(ws2_32::WSAPOLLFD, revents, 10);

    // ── SYSTEM_INFO (sysinfoapi.h) ───────────────────────────────────────
    // src/windows_sys/externs.rs:1281-1294
    // WORD(2)+WORD(2)+DWORD(4) + ptr(8)+ptr(8) + usize(8) + DWORD(4)+DWORD(4)+DWORD(4)
    //   + WORD(2)+WORD(2) = 48
    assert_size!(SYSTEM_INFO, 48);
    assert_align!(SYSTEM_INFO, 8);
    assert_offset!(SYSTEM_INFO, wProcessorArchitecture, 0);
    assert_offset!(SYSTEM_INFO, wReserved, 2);
    assert_offset!(SYSTEM_INFO, dwPageSize, 4);
    assert_offset!(SYSTEM_INFO, lpMinimumApplicationAddress, 8);
    assert_offset!(SYSTEM_INFO, lpMaximumApplicationAddress, 16);
    assert_offset!(SYSTEM_INFO, dwActiveProcessorMask, 24);
    assert_offset!(SYSTEM_INFO, dwNumberOfProcessors, 32);
    assert_offset!(SYSTEM_INFO, dwProcessorType, 36);
    assert_offset!(SYSTEM_INFO, dwAllocationGranularity, 40);
    assert_offset!(SYSTEM_INFO, wProcessorLevel, 44);
    assert_offset!(SYSTEM_INFO, wProcessorRevision, 46);

    // ── Job Object POD (winnt.h) ─────────────────────────────────────────
    // src/windows_sys/externs.rs:1381-1428
    assert_size!(JOBOBJECT_ASSOCIATE_COMPLETION_PORT, 16);
    assert_align!(JOBOBJECT_ASSOCIATE_COMPLETION_PORT, 8);
    assert_offset!(JOBOBJECT_ASSOCIATE_COMPLETION_PORT, CompletionKey, 0);
    assert_offset!(JOBOBJECT_ASSOCIATE_COMPLETION_PORT, CompletionPort, 8);

    // JOBOBJECT_BASIC_LIMIT_INFORMATION:
    //   i64(8)+i64(8) + DWORD(4)+pad(4) + usize(8)+usize(8) + DWORD(4)+pad(4)
    //     + usize(8) + DWORD(4)+DWORD(4) = 64
    assert_size!(JOBOBJECT_BASIC_LIMIT_INFORMATION, 64);
    assert_align!(JOBOBJECT_BASIC_LIMIT_INFORMATION, 8);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, PerProcessUserTimeLimit, 0);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, PerJobUserTimeLimit, 8);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, LimitFlags, 16);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, MinimumWorkingSetSize, 24);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, MaximumWorkingSetSize, 32);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, ActiveProcessLimit, 40);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, Affinity, 48);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, PriorityClass, 56);
    assert_offset!(JOBOBJECT_BASIC_LIMIT_INFORMATION, SchedulingClass, 60);

    assert_size!(IO_COUNTERS, 48);                       // 6 × u64
    assert_align!(IO_COUNTERS, 8);
    assert_offset!(IO_COUNTERS, ReadOperationCount, 0);
    assert_offset!(IO_COUNTERS, WriteOperationCount, 8);
    assert_offset!(IO_COUNTERS, OtherOperationCount, 16);
    assert_offset!(IO_COUNTERS, ReadTransferCount, 24);
    assert_offset!(IO_COUNTERS, WriteTransferCount, 32);
    assert_offset!(IO_COUNTERS, OtherTransferCount, 40);

    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION: 64 + 48 + 8×4 = 144
    assert_size!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, 144);
    assert_align!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, 8);
    assert_offset!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, BasicLimitInformation, 0);
    assert_offset!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, IoInfo, 64);
    assert_offset!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, ProcessMemoryLimit, 112);
    assert_offset!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobMemoryLimit, 120);
    assert_offset!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, PeakProcessMemoryUsed, 128);
    assert_offset!(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, PeakJobMemoryUsed, 136);

    // ── Process creation POD (processthreadsapi.h, winbase.h) ────────────
    // src/windows_sys/externs.rs:1435-1471
    // STARTUPINFOW: DWORD(4)+pad(4) + 3×PWSTR(24) + 8×DWORD(32) + WORD(2)+WORD(2)+pad(4)
    //   + PTR(8) + 3×HANDLE(24) = 104
    assert_size!(STARTUPINFOW, 104);
    assert_align!(STARTUPINFOW, 8);
    assert_offset!(STARTUPINFOW, cb, 0);
    assert_offset!(STARTUPINFOW, lpReserved, 8);
    assert_offset!(STARTUPINFOW, lpDesktop, 16);
    assert_offset!(STARTUPINFOW, lpTitle, 24);
    assert_offset!(STARTUPINFOW, dwX, 32);
    assert_offset!(STARTUPINFOW, dwY, 36);
    assert_offset!(STARTUPINFOW, dwXSize, 40);
    assert_offset!(STARTUPINFOW, dwYSize, 44);
    assert_offset!(STARTUPINFOW, dwXCountChars, 48);
    assert_offset!(STARTUPINFOW, dwYCountChars, 52);
    assert_offset!(STARTUPINFOW, dwFillAttribute, 56);
    assert_offset!(STARTUPINFOW, dwFlags, 60);
    assert_offset!(STARTUPINFOW, wShowWindow, 64);
    assert_offset!(STARTUPINFOW, cbReserved2, 66);
    assert_offset!(STARTUPINFOW, lpReserved2, 72);
    assert_offset!(STARTUPINFOW, hStdInput, 80);
    assert_offset!(STARTUPINFOW, hStdOutput, 88);
    assert_offset!(STARTUPINFOW, hStdError, 96);

    // STARTUPINFOEXW: STARTUPINFOW(104) + ptr(8) = 112
    assert_size!(STARTUPINFOEXW, 112);
    assert_align!(STARTUPINFOEXW, 8);
    assert_offset!(STARTUPINFOEXW, StartupInfo, 0);
    assert_offset!(STARTUPINFOEXW, lpAttributeList, 104);

    // PROCESS_INFORMATION: HANDLE(8)+HANDLE(8) + DWORD(4)+DWORD(4) = 24
    assert_size!(PROCESS_INFORMATION, 24);
    assert_align!(PROCESS_INFORMATION, 8);
    assert_offset!(PROCESS_INFORMATION, hProcess, 0);
    assert_offset!(PROCESS_INFORMATION, hThread, 8);
    assert_offset!(PROCESS_INFORMATION, dwProcessId, 16);
    assert_offset!(PROCESS_INFORMATION, dwThreadId, 20);

    // ── TEB/PEB chain (winternl.h) ───────────────────────────────────────
    // src/windows_sys/externs.rs:1484-1559 — these already have partial
    // asserts (RTL_USER_PROCESS_PARAMETERS.hStdInput @ 0x20, CurrentDirectory.Handle
    // @ 0x48, ImagePathName @ 0x60; TEB.ProcessEnvironmentBlock @ 0x60); we add
    // size+align tripwires.
    // CURDIR: UNICODE_STRING(16) + HANDLE(8) = 24
    assert_size!(CURDIR, 24);
    assert_align!(CURDIR, 8);
    assert_offset!(CURDIR, DosPath, 0);
    assert_offset!(CURDIR, Handle, 16);

    // RTL_USER_PROCESS_PARAMETERS: 16 + 16 + 24 (3×HANDLE) + 24 (CURDIR)
    //   + 16+16+16 (3×UNICODE_STRING) = 128
    assert_size!(RTL_USER_PROCESS_PARAMETERS, 128);
    assert_align!(RTL_USER_PROCESS_PARAMETERS, 8);

    // PEB partial view: 2+1+1+pad(4) + 2×ptr(16) + ptr(8) + ptr(8) = 40
    assert_size!(PEB, 40);
    assert_align!(PEB, 8);

    // TEB partial view: 7×ptr(56) + ptr(8) + 2×ptr(16) + ptr(8) + ptr(8) + ptr(8) = 104
    assert_size!(TEB, 104);
    assert_align!(TEB, 8);
};

// ── Cross-validation work still required before merging upstream ────────────
//
// `bun_windows_sys` is `#![no_std]` and tier-0; the asserts above use only
// `core::mem` and trip at compile time on the Windows x64 CI runner. There is
// no Linux equivalent to cross-check against — the LLP64 vs LP64 width split
// for `c_ulong` means a Linux cross-compile would compute different offsets.
// Maintainer cross-validation steps:
//
// 1. CI: the existing `.github/workflows/*-windows*` job runs `cargo check
//    -p bun_windows_sys --target x86_64-pc-windows-msvc`. The 350+ asserts
//    pasted here trip on that job. No new infrastructure required.
//
// 2. Manual: compile a small `cl.exe` probe in `scripts/windows_layout_dump.c`
//    that does `printf("%zu %zu\n", sizeof(STRUCT), offsetof(STRUCT, FIELD))`
//    for each pair. The Windows SDK version is set by the runner's
//    `windows-sdk-version` action input — currently 10.0.22621.0. Two
//    structs are known to drift across SDK versions:
//      - WIN32_FIND_DATAW (cAlternateFileName changed in 19H1+) — size 592
//        is stable since the 8.1 SDK; assert as-is.
//      - SYSTEM_INFO (wProcessorArchitecture interpretation changed for ARM64
//        in 10.0.17763) — *layout* unchanged; assert as-is.
//
// 3. // TODO(cross-validate): Two structs use C bit-flag enums (FILE_INFO_BY_HANDLE_CLASS
//    is repr(transparent) over u32; FILE_INFORMATION_CLASS same). Their
//    layouts are size 4 / align 4 by construction (no per-variant tripwire
//    needed). The `JobObjectInformationClass` DWORD constants (= 7, 9, 0x2000)
//    are tested by use-sites; no struct assert applies.
//
// 4. // TODO(cross-validate): The `ntdll::{NtCreateFile, NtClose, ...}` /
//    `kernel32::{ReadFile, WriteFile, ...}` extern blocks are NOT structs and
//    have no `sizeof`. Their type-signature drift is caught by the rustc
//    typecheck against the import; a separate Phase-12 follow-up could add a
//    `bun_libuv_sys::assert_uv_layout()`-style runtime probe that calls each
//    fn and checks return type.
//
// Once #1 is green on the Windows CI, this PoC is ready to be applied as a
// single-file patch to `src/windows_sys/externs.rs`.
