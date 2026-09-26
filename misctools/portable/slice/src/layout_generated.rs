// Written by misctools/portable/bindings/layout.ts from the bindings of bun. Do not edit.
//
// The size and the alignment of every structure of the bindings, the offset and the size of each field
// and the value of each constant, as this program has them.
#![allow(clippy::all, deprecated, non_snake_case)]

use core::mem::{align_of, offset_of, size_of};
use std::io::Write as _;

use crate::json::Report;

fn size_of_field<T, F>(_: fn(&T) -> &F) -> usize {
    size_of::<F>()
}

pub fn types(report: &mut Report) {
    let mut out = Vec::new();
    {
        type T = bun_windows_sys::COORD;
        let _ = write!(out, "\n\"COORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"X\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, X), size_of_field(|value: &T| &value.X));
        let _ = write!(out, ",\"Y\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Y), size_of_field(|value: &T| &value.Y));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::SMALL_RECT;
        let _ = write!(out, ",\n\"SMALL_RECT\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Left\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Left), size_of_field(|value: &T| &value.Left));
        let _ = write!(out, ",\"Top\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Top), size_of_field(|value: &T| &value.Top));
        let _ = write!(out, ",\"Right\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Right), size_of_field(|value: &T| &value.Right));
        let _ = write!(out, ",\"Bottom\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Bottom), size_of_field(|value: &T| &value.Bottom));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::CONSOLE_SCREEN_BUFFER_INFO;
        let _ = write!(out, ",\n\"CONSOLE_SCREEN_BUFFER_INFO\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwSize), size_of_field(|value: &T| &value.dwSize));
        let _ = write!(out, ",\"dwCursorPosition\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwCursorPosition), size_of_field(|value: &T| &value.dwCursorPosition));
        let _ = write!(out, ",\"wAttributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wAttributes), size_of_field(|value: &T| &value.wAttributes));
        let _ = write!(out, ",\"srWindow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, srWindow), size_of_field(|value: &T| &value.srWindow));
        let _ = write!(out, ",\"dwMaximumWindowSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwMaximumWindowSize), size_of_field(|value: &T| &value.dwMaximumWindowSize));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILETIME;
        let _ = write!(out, ",\n\"FILETIME\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwLowDateTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwLowDateTime), size_of_field(|value: &T| &value.dwLowDateTime));
        let _ = write!(out, ",\"dwHighDateTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwHighDateTime), size_of_field(|value: &T| &value.dwHighDateTime));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::OVERLAPPED;
        let _ = write!(out, ",\n\"OVERLAPPED\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Internal\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Internal), size_of_field(|value: &T| &value.Internal));
        let _ = write!(out, ",\"InternalHigh\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, InternalHigh), size_of_field(|value: &T| &value.InternalHigh));
        let _ = write!(out, ",\"Offset\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Offset), size_of_field(|value: &T| &value.Offset));
        let _ = write!(out, ",\"OffsetHigh\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, OffsetHigh), size_of_field(|value: &T| &value.OffsetHigh));
        let _ = write!(out, ",\"hEvent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hEvent), size_of_field(|value: &T| &value.hEvent));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::CRITICAL_SECTION;
        let _ = write!(out, ",\n\"CRITICAL_SECTION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"DebugInfo\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, DebugInfo), size_of_field(|value: &T| &value.DebugInfo));
        let _ = write!(out, ",\"LockCount\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LockCount), size_of_field(|value: &T| &value.LockCount));
        let _ = write!(out, ",\"RecursionCount\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, RecursionCount), size_of_field(|value: &T| &value.RecursionCount));
        let _ = write!(out, ",\"OwningThread\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, OwningThread), size_of_field(|value: &T| &value.OwningThread));
        let _ = write!(out, ",\"LockSemaphore\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LockSemaphore), size_of_field(|value: &T| &value.LockSemaphore));
        let _ = write!(out, ",\"SpinCount\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, SpinCount), size_of_field(|value: &T| &value.SpinCount));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::WIN32_FIND_DATAW;
        let _ = write!(out, ",\n\"WIN32_FIND_DATAW\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwFileAttributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwFileAttributes), size_of_field(|value: &T| &value.dwFileAttributes));
        let _ = write!(out, ",\"ftCreationTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftCreationTime), size_of_field(|value: &T| &value.ftCreationTime));
        let _ = write!(out, ",\"ftLastAccessTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftLastAccessTime), size_of_field(|value: &T| &value.ftLastAccessTime));
        let _ = write!(out, ",\"ftLastWriteTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftLastWriteTime), size_of_field(|value: &T| &value.ftLastWriteTime));
        let _ = write!(out, ",\"nFileSizeHigh\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileSizeHigh), size_of_field(|value: &T| &value.nFileSizeHigh));
        let _ = write!(out, ",\"nFileSizeLow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileSizeLow), size_of_field(|value: &T| &value.nFileSizeLow));
        let _ = write!(out, ",\"dwReserved0\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwReserved0), size_of_field(|value: &T| &value.dwReserved0));
        let _ = write!(out, ",\"dwReserved1\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwReserved1), size_of_field(|value: &T| &value.dwReserved1));
        let _ = write!(out, ",\"cFileName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cFileName), size_of_field(|value: &T| &value.cFileName));
        let _ = write!(out, ",\"cAlternateFileName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cAlternateFileName), size_of_field(|value: &T| &value.cAlternateFileName));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::KEY_EVENT_RECORD_uChar;
        let _ = write!(out, ",\n\"KEY_EVENT_RECORD_uChar\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"UnicodeChar\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, UnicodeChar), size_of_field(|value: &T| unsafe { &value.UnicodeChar }));
        let _ = write!(out, ",\"AsciiChar\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AsciiChar), size_of_field(|value: &T| unsafe { &value.AsciiChar }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::KEY_EVENT_RECORD;
        let _ = write!(out, ",\n\"KEY_EVENT_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"bKeyDown\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, bKeyDown), size_of_field(|value: &T| &value.bKeyDown));
        let _ = write!(out, ",\"wRepeatCount\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wRepeatCount), size_of_field(|value: &T| &value.wRepeatCount));
        let _ = write!(out, ",\"wVirtualKeyCode\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wVirtualKeyCode), size_of_field(|value: &T| &value.wVirtualKeyCode));
        let _ = write!(out, ",\"wVirtualScanCode\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wVirtualScanCode), size_of_field(|value: &T| &value.wVirtualScanCode));
        let _ = write!(out, ",\"uChar\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, uChar), size_of_field(|value: &T| &value.uChar));
        let _ = write!(out, ",\"dwControlKeyState\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwControlKeyState), size_of_field(|value: &T| &value.dwControlKeyState));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::MOUSE_EVENT_RECORD;
        let _ = write!(out, ",\n\"MOUSE_EVENT_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwMousePosition\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwMousePosition), size_of_field(|value: &T| &value.dwMousePosition));
        let _ = write!(out, ",\"dwButtonState\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwButtonState), size_of_field(|value: &T| &value.dwButtonState));
        let _ = write!(out, ",\"dwControlKeyState\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwControlKeyState), size_of_field(|value: &T| &value.dwControlKeyState));
        let _ = write!(out, ",\"dwEventFlags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwEventFlags), size_of_field(|value: &T| &value.dwEventFlags));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::WINDOW_BUFFER_SIZE_EVENT;
        let _ = write!(out, ",\n\"WINDOW_BUFFER_SIZE_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwSize), size_of_field(|value: &T| &value.dwSize));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::MENU_EVENT_RECORD;
        let _ = write!(out, ",\n\"MENU_EVENT_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwCommandId\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwCommandId), size_of_field(|value: &T| &value.dwCommandId));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FOCUS_EVENT_RECORD;
        let _ = write!(out, ",\n\"FOCUS_EVENT_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"bSetFocus\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, bSetFocus), size_of_field(|value: &T| &value.bSetFocus));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::INPUT_RECORD_Event;
        let _ = write!(out, ",\n\"INPUT_RECORD_Event\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"KeyEvent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, KeyEvent), size_of_field(|value: &T| unsafe { &value.KeyEvent }));
        let _ = write!(out, ",\"MouseEvent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, MouseEvent), size_of_field(|value: &T| unsafe { &value.MouseEvent }));
        let _ = write!(out, ",\"WindowBufferSizeEvent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, WindowBufferSizeEvent), size_of_field(|value: &T| unsafe { &value.WindowBufferSizeEvent }));
        let _ = write!(out, ",\"MenuEvent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, MenuEvent), size_of_field(|value: &T| unsafe { &value.MenuEvent }));
        let _ = write!(out, ",\"FocusEvent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FocusEvent), size_of_field(|value: &T| unsafe { &value.FocusEvent }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::INPUT_RECORD;
        let _ = write!(out, ",\n\"INPUT_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"EventType\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EventType), size_of_field(|value: &T| &value.EventType));
        let _ = write!(out, ",\"Event\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Event), size_of_field(|value: &T| &value.Event));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::SECURITY_ATTRIBUTES;
        let _ = write!(out, ",\n\"SECURITY_ATTRIBUTES\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"nLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nLength), size_of_field(|value: &T| &value.nLength));
        let _ = write!(out, ",\"lpSecurityDescriptor\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpSecurityDescriptor), size_of_field(|value: &T| &value.lpSecurityDescriptor));
        let _ = write!(out, ",\"bInheritHandle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, bInheritHandle), size_of_field(|value: &T| &value.bInheritHandle));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::BY_HANDLE_FILE_INFORMATION;
        let _ = write!(out, ",\n\"BY_HANDLE_FILE_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwFileAttributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwFileAttributes), size_of_field(|value: &T| &value.dwFileAttributes));
        let _ = write!(out, ",\"ftCreationTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftCreationTime), size_of_field(|value: &T| &value.ftCreationTime));
        let _ = write!(out, ",\"ftLastAccessTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftLastAccessTime), size_of_field(|value: &T| &value.ftLastAccessTime));
        let _ = write!(out, ",\"ftLastWriteTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftLastWriteTime), size_of_field(|value: &T| &value.ftLastWriteTime));
        let _ = write!(out, ",\"dwVolumeSerialNumber\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwVolumeSerialNumber), size_of_field(|value: &T| &value.dwVolumeSerialNumber));
        let _ = write!(out, ",\"nFileSizeHigh\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileSizeHigh), size_of_field(|value: &T| &value.nFileSizeHigh));
        let _ = write!(out, ",\"nFileSizeLow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileSizeLow), size_of_field(|value: &T| &value.nFileSizeLow));
        let _ = write!(out, ",\"nNumberOfLinks\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nNumberOfLinks), size_of_field(|value: &T| &value.nNumberOfLinks));
        let _ = write!(out, ",\"nFileIndexHigh\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileIndexHigh), size_of_field(|value: &T| &value.nFileIndexHigh));
        let _ = write!(out, ",\"nFileIndexLow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileIndexLow), size_of_field(|value: &T| &value.nFileIndexLow));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::WIN32_FILE_ATTRIBUTE_DATA;
        let _ = write!(out, ",\n\"WIN32_FILE_ATTRIBUTE_DATA\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"dwFileAttributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwFileAttributes), size_of_field(|value: &T| &value.dwFileAttributes));
        let _ = write!(out, ",\"ftCreationTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftCreationTime), size_of_field(|value: &T| &value.ftCreationTime));
        let _ = write!(out, ",\"ftLastAccessTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftLastAccessTime), size_of_field(|value: &T| &value.ftLastAccessTime));
        let _ = write!(out, ",\"ftLastWriteTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ftLastWriteTime), size_of_field(|value: &T| &value.ftLastWriteTime));
        let _ = write!(out, ",\"nFileSizeHigh\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileSizeHigh), size_of_field(|value: &T| &value.nFileSizeHigh));
        let _ = write!(out, ",\"nFileSizeLow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nFileSizeLow), size_of_field(|value: &T| &value.nFileSizeLow));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::UNICODE_STRING;
        let _ = write!(out, ",\n\"UNICODE_STRING\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Length\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Length), size_of_field(|value: &T| &value.Length));
        let _ = write!(out, ",\"MaximumLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, MaximumLength), size_of_field(|value: &T| &value.MaximumLength));
        let _ = write!(out, ",\"Buffer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Buffer), size_of_field(|value: &T| &value.Buffer));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::OBJECT_ATTRIBUTES;
        let _ = write!(out, ",\n\"OBJECT_ATTRIBUTES\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Length\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Length), size_of_field(|value: &T| &value.Length));
        let _ = write!(out, ",\"RootDirectory\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, RootDirectory), size_of_field(|value: &T| &value.RootDirectory));
        let _ = write!(out, ",\"ObjectName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ObjectName), size_of_field(|value: &T| &value.ObjectName));
        let _ = write!(out, ",\"Attributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Attributes), size_of_field(|value: &T| &value.Attributes));
        let _ = write!(out, ",\"SecurityDescriptor\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, SecurityDescriptor), size_of_field(|value: &T| &value.SecurityDescriptor));
        let _ = write!(out, ",\"SecurityQualityOfService\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, SecurityQualityOfService), size_of_field(|value: &T| &value.SecurityQualityOfService));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::IO_STATUS_BLOCK;
        let _ = write!(out, ",\n\"IO_STATUS_BLOCK\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Status\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Status), size_of_field(|value: &T| &value.Status));
        let _ = write!(out, ",\"Information\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Information), size_of_field(|value: &T| &value.Information));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_BASIC_INFORMATION;
        let _ = write!(out, ",\n\"FILE_BASIC_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"CreationTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CreationTime), size_of_field(|value: &T| &value.CreationTime));
        let _ = write!(out, ",\"LastAccessTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LastAccessTime), size_of_field(|value: &T| &value.LastAccessTime));
        let _ = write!(out, ",\"LastWriteTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LastWriteTime), size_of_field(|value: &T| &value.LastWriteTime));
        let _ = write!(out, ",\"ChangeTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ChangeTime), size_of_field(|value: &T| &value.ChangeTime));
        let _ = write!(out, ",\"FileAttributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileAttributes), size_of_field(|value: &T| &value.FileAttributes));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_DIRECTORY_INFORMATION;
        let _ = write!(out, ",\n\"FILE_DIRECTORY_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"NextEntryOffset\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, NextEntryOffset), size_of_field(|value: &T| &value.NextEntryOffset));
        let _ = write!(out, ",\"FileIndex\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileIndex), size_of_field(|value: &T| &value.FileIndex));
        let _ = write!(out, ",\"CreationTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CreationTime), size_of_field(|value: &T| &value.CreationTime));
        let _ = write!(out, ",\"LastAccessTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LastAccessTime), size_of_field(|value: &T| &value.LastAccessTime));
        let _ = write!(out, ",\"LastWriteTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LastWriteTime), size_of_field(|value: &T| &value.LastWriteTime));
        let _ = write!(out, ",\"ChangeTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ChangeTime), size_of_field(|value: &T| &value.ChangeTime));
        let _ = write!(out, ",\"EndOfFile\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EndOfFile), size_of_field(|value: &T| &value.EndOfFile));
        let _ = write!(out, ",\"AllocationSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AllocationSize), size_of_field(|value: &T| &value.AllocationSize));
        let _ = write!(out, ",\"FileAttributes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileAttributes), size_of_field(|value: &T| &value.FileAttributes));
        let _ = write!(out, ",\"FileNameLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileNameLength), size_of_field(|value: &T| &value.FileNameLength));
        let _ = write!(out, ",\"FileName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileName), size_of_field(|value: &T| &value.FileName));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_STANDARD_INFORMATION;
        let _ = write!(out, ",\n\"FILE_STANDARD_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"AllocationSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AllocationSize), size_of_field(|value: &T| &value.AllocationSize));
        let _ = write!(out, ",\"EndOfFile\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EndOfFile), size_of_field(|value: &T| &value.EndOfFile));
        let _ = write!(out, ",\"NumberOfLinks\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, NumberOfLinks), size_of_field(|value: &T| &value.NumberOfLinks));
        let _ = write!(out, ",\"DeletePending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, DeletePending), size_of_field(|value: &T| &value.DeletePending));
        let _ = write!(out, ",\"Directory\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Directory), size_of_field(|value: &T| &value.Directory));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_INTERNAL_INFORMATION;
        let _ = write!(out, ",\n\"FILE_INTERNAL_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"IndexNumber\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, IndexNumber), size_of_field(|value: &T| &value.IndexNumber));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_ALL_INFORMATION;
        let _ = write!(out, ",\n\"FILE_ALL_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"BasicInformation\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, BasicInformation), size_of_field(|value: &T| &value.BasicInformation));
        let _ = write!(out, ",\"StandardInformation\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, StandardInformation), size_of_field(|value: &T| &value.StandardInformation));
        let _ = write!(out, ",\"InternalInformation\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, InternalInformation), size_of_field(|value: &T| &value.InternalInformation));
        let _ = write!(out, ",\"EaSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EaSize), size_of_field(|value: &T| &value.EaSize));
        let _ = write!(out, ",\"AccessFlags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AccessFlags), size_of_field(|value: &T| &value.AccessFlags));
        let _ = write!(out, ",\"CurrentByteOffset\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CurrentByteOffset), size_of_field(|value: &T| &value.CurrentByteOffset));
        let _ = write!(out, ",\"Mode\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Mode), size_of_field(|value: &T| &value.Mode));
        let _ = write!(out, ",\"AlignmentRequirement\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AlignmentRequirement), size_of_field(|value: &T| &value.AlignmentRequirement));
        let _ = write!(out, ",\"FileNameLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileNameLength), size_of_field(|value: &T| &value.FileNameLength));
        let _ = write!(out, ",\"FileName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileName), size_of_field(|value: &T| &value.FileName));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_FS_DEVICE_INFORMATION;
        let _ = write!(out, ",\n\"FILE_FS_DEVICE_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"DeviceType\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, DeviceType), size_of_field(|value: &T| &value.DeviceType));
        let _ = write!(out, ",\"Characteristics\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Characteristics), size_of_field(|value: &T| &value.Characteristics));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_FS_VOLUME_INFORMATION;
        let _ = write!(out, ",\n\"FILE_FS_VOLUME_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"VolumeCreationTime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, VolumeCreationTime), size_of_field(|value: &T| &value.VolumeCreationTime));
        let _ = write!(out, ",\"VolumeSerialNumber\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, VolumeSerialNumber), size_of_field(|value: &T| &value.VolumeSerialNumber));
        let _ = write!(out, ",\"VolumeLabelLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, VolumeLabelLength), size_of_field(|value: &T| &value.VolumeLabelLength));
        let _ = write!(out, ",\"SupportsObjects\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, SupportsObjects), size_of_field(|value: &T| &value.SupportsObjects));
        let _ = write!(out, ",\"VolumeLabel\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, VolumeLabel), size_of_field(|value: &T| &value.VolumeLabel));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_END_OF_FILE_INFORMATION;
        let _ = write!(out, ",\n\"FILE_END_OF_FILE_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"EndOfFile\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EndOfFile), size_of_field(|value: &T| &value.EndOfFile));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_DISPOSITION_INFORMATION;
        let _ = write!(out, ",\n\"FILE_DISPOSITION_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"DeleteFile\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, DeleteFile), size_of_field(|value: &T| &value.DeleteFile));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_DISPOSITION_INFORMATION_EX;
        let _ = write!(out, ",\n\"FILE_DISPOSITION_INFORMATION_EX\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Flags), size_of_field(|value: &T| &value.Flags));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::FILE_RENAME_INFORMATION_EX;
        let _ = write!(out, ",\n\"FILE_RENAME_INFORMATION_EX\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Flags), size_of_field(|value: &T| &value.Flags));
        let _ = write!(out, ",\"RootDirectory\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, RootDirectory), size_of_field(|value: &T| &value.RootDirectory));
        let _ = write!(out, ",\"FileNameLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileNameLength), size_of_field(|value: &T| &value.FileNameLength));
        let _ = write!(out, ",\"FileName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileName), size_of_field(|value: &T| &value.FileName));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::RUNTIME_FUNCTION;
        let _ = write!(out, ",\n\"RUNTIME_FUNCTION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"BeginAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, BeginAddress), size_of_field(|value: &T| &value.BeginAddress));
        let _ = write!(out, ",\"EndAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EndAddress), size_of_field(|value: &T| &value.EndAddress));
        let _ = write!(out, ",\"UnwindData\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, UnwindData), size_of_field(|value: &T| &value.UnwindData));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::M128A;
        let _ = write!(out, ",\n\"M128A\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Low\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Low), size_of_field(|value: &T| &value.Low));
        let _ = write!(out, ",\"High\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, High), size_of_field(|value: &T| &value.High));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::kernel32::MEMORY_BASIC_INFORMATION;
        let _ = write!(out, ",\n\"MEMORY_BASIC_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"BaseAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, BaseAddress), size_of_field(|value: &T| &value.BaseAddress));
        let _ = write!(out, ",\"AllocationBase\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AllocationBase), size_of_field(|value: &T| &value.AllocationBase));
        let _ = write!(out, ",\"AllocationProtect\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AllocationProtect), size_of_field(|value: &T| &value.AllocationProtect));
        let _ = write!(out, ",\"PartitionId\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PartitionId), size_of_field(|value: &T| &value.PartitionId));
        let _ = write!(out, ",\"RegionSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, RegionSize), size_of_field(|value: &T| &value.RegionSize));
        let _ = write!(out, ",\"State\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, State), size_of_field(|value: &T| &value.State));
        let _ = write!(out, ",\"Protect\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Protect), size_of_field(|value: &T| &value.Protect));
        let _ = write!(out, ",\"Type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Type), size_of_field(|value: &T| &value.Type));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::addrinfo;
        let _ = write!(out, ",\n\"addrinfo\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ai_flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_flags), size_of_field(|value: &T| &value.ai_flags));
        let _ = write!(out, ",\"ai_family\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_family), size_of_field(|value: &T| &value.ai_family));
        let _ = write!(out, ",\"ai_socktype\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_socktype), size_of_field(|value: &T| &value.ai_socktype));
        let _ = write!(out, ",\"ai_protocol\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_protocol), size_of_field(|value: &T| &value.ai_protocol));
        let _ = write!(out, ",\"ai_addrlen\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_addrlen), size_of_field(|value: &T| &value.ai_addrlen));
        let _ = write!(out, ",\"ai_canonname\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_canonname), size_of_field(|value: &T| &value.ai_canonname));
        let _ = write!(out, ",\"ai_addr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_addr), size_of_field(|value: &T| &value.ai_addr));
        let _ = write!(out, ",\"ai_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ai_next), size_of_field(|value: &T| &value.ai_next));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::sockaddr_storage;
        let _ = write!(out, ",\n\"sockaddr_storage\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ss_family\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ss_family), size_of_field(|value: &T| &value.ss_family));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::sockaddr;
        let _ = write!(out, ",\n\"sockaddr\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"sa_family\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sa_family), size_of_field(|value: &T| &value.sa_family));
        let _ = write!(out, ",\"sa_data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sa_data), size_of_field(|value: &T| &value.sa_data));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::sockaddr_in;
        let _ = write!(out, ",\n\"sockaddr_in\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"sin_family\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin_family), size_of_field(|value: &T| &value.sin_family));
        let _ = write!(out, ",\"sin_port\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin_port), size_of_field(|value: &T| &value.sin_port));
        let _ = write!(out, ",\"sin_addr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin_addr), size_of_field(|value: &T| &value.sin_addr));
        let _ = write!(out, ",\"sin_zero\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin_zero), size_of_field(|value: &T| &value.sin_zero));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::in_addr;
        let _ = write!(out, ",\n\"in_addr\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"s_addr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, s_addr), size_of_field(|value: &T| &value.s_addr));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::sockaddr_in6;
        let _ = write!(out, ",\n\"sockaddr_in6\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"sin6_family\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin6_family), size_of_field(|value: &T| &value.sin6_family));
        let _ = write!(out, ",\"sin6_port\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin6_port), size_of_field(|value: &T| &value.sin6_port));
        let _ = write!(out, ",\"sin6_flowinfo\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin6_flowinfo), size_of_field(|value: &T| &value.sin6_flowinfo));
        let _ = write!(out, ",\"sin6_addr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin6_addr), size_of_field(|value: &T| &value.sin6_addr));
        let _ = write!(out, ",\"sin6_scope_id\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sin6_scope_id), size_of_field(|value: &T| &value.sin6_scope_id));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::in6_addr;
        let _ = write!(out, ",\n\"in6_addr\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"s6_addr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, s6_addr), size_of_field(|value: &T| &value.s6_addr));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::ws2_32::WSAPOLLFD;
        let _ = write!(out, ",\n\"WSAPOLLFD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"fd\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, fd), size_of_field(|value: &T| &value.fd));
        let _ = write!(out, ",\"events\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, events), size_of_field(|value: &T| &value.events));
        let _ = write!(out, ",\"revents\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, revents), size_of_field(|value: &T| &value.revents));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::SYSTEM_INFO;
        let _ = write!(out, ",\n\"SYSTEM_INFO\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"wProcessorArchitecture\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wProcessorArchitecture), size_of_field(|value: &T| &value.wProcessorArchitecture));
        let _ = write!(out, ",\"wReserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wReserved), size_of_field(|value: &T| &value.wReserved));
        let _ = write!(out, ",\"dwPageSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwPageSize), size_of_field(|value: &T| &value.dwPageSize));
        let _ = write!(out, ",\"lpMinimumApplicationAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpMinimumApplicationAddress), size_of_field(|value: &T| &value.lpMinimumApplicationAddress));
        let _ = write!(out, ",\"lpMaximumApplicationAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpMaximumApplicationAddress), size_of_field(|value: &T| &value.lpMaximumApplicationAddress));
        let _ = write!(out, ",\"dwActiveProcessorMask\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwActiveProcessorMask), size_of_field(|value: &T| &value.dwActiveProcessorMask));
        let _ = write!(out, ",\"dwNumberOfProcessors\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwNumberOfProcessors), size_of_field(|value: &T| &value.dwNumberOfProcessors));
        let _ = write!(out, ",\"dwProcessorType\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwProcessorType), size_of_field(|value: &T| &value.dwProcessorType));
        let _ = write!(out, ",\"dwAllocationGranularity\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwAllocationGranularity), size_of_field(|value: &T| &value.dwAllocationGranularity));
        let _ = write!(out, ",\"wProcessorLevel\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wProcessorLevel), size_of_field(|value: &T| &value.wProcessorLevel));
        let _ = write!(out, ",\"wProcessorRevision\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wProcessorRevision), size_of_field(|value: &T| &value.wProcessorRevision));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::PROCESS_BASIC_INFORMATION;
        let _ = write!(out, ",\n\"PROCESS_BASIC_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ExitStatus\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExitStatus), size_of_field(|value: &T| &value.ExitStatus));
        let _ = write!(out, ",\"PebBaseAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PebBaseAddress), size_of_field(|value: &T| &value.PebBaseAddress));
        let _ = write!(out, ",\"AffinityMask\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, AffinityMask), size_of_field(|value: &T| &value.AffinityMask));
        let _ = write!(out, ",\"BasePriority\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, BasePriority), size_of_field(|value: &T| &value.BasePriority));
        let _ = write!(out, ",\"UniqueProcessId\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, UniqueProcessId), size_of_field(|value: &T| &value.UniqueProcessId));
        let _ = write!(out, ",\"InheritedFromUniqueProcessId\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, InheritedFromUniqueProcessId), size_of_field(|value: &T| &value.InheritedFromUniqueProcessId));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::JOBOBJECT_ASSOCIATE_COMPLETION_PORT;
        let _ = write!(out, ",\n\"JOBOBJECT_ASSOCIATE_COMPLETION_PORT\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"CompletionKey\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CompletionKey), size_of_field(|value: &T| &value.CompletionKey));
        let _ = write!(out, ",\"CompletionPort\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CompletionPort), size_of_field(|value: &T| &value.CompletionPort));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::JOBOBJECT_BASIC_LIMIT_INFORMATION;
        let _ = write!(out, ",\n\"JOBOBJECT_BASIC_LIMIT_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"PerProcessUserTimeLimit\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PerProcessUserTimeLimit), size_of_field(|value: &T| &value.PerProcessUserTimeLimit));
        let _ = write!(out, ",\"PerJobUserTimeLimit\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PerJobUserTimeLimit), size_of_field(|value: &T| &value.PerJobUserTimeLimit));
        let _ = write!(out, ",\"LimitFlags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, LimitFlags), size_of_field(|value: &T| &value.LimitFlags));
        let _ = write!(out, ",\"MinimumWorkingSetSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, MinimumWorkingSetSize), size_of_field(|value: &T| &value.MinimumWorkingSetSize));
        let _ = write!(out, ",\"MaximumWorkingSetSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, MaximumWorkingSetSize), size_of_field(|value: &T| &value.MaximumWorkingSetSize));
        let _ = write!(out, ",\"ActiveProcessLimit\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ActiveProcessLimit), size_of_field(|value: &T| &value.ActiveProcessLimit));
        let _ = write!(out, ",\"Affinity\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Affinity), size_of_field(|value: &T| &value.Affinity));
        let _ = write!(out, ",\"PriorityClass\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PriorityClass), size_of_field(|value: &T| &value.PriorityClass));
        let _ = write!(out, ",\"SchedulingClass\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, SchedulingClass), size_of_field(|value: &T| &value.SchedulingClass));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::IO_COUNTERS;
        let _ = write!(out, ",\n\"IO_COUNTERS\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ReadOperationCount\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ReadOperationCount), size_of_field(|value: &T| &value.ReadOperationCount));
        let _ = write!(out, ",\"WriteOperationCount\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, WriteOperationCount), size_of_field(|value: &T| &value.WriteOperationCount));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::JOBOBJECT_EXTENDED_LIMIT_INFORMATION;
        let _ = write!(out, ",\n\"JOBOBJECT_EXTENDED_LIMIT_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"BasicLimitInformation\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, BasicLimitInformation), size_of_field(|value: &T| &value.BasicLimitInformation));
        let _ = write!(out, ",\"IoInfo\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, IoInfo), size_of_field(|value: &T| &value.IoInfo));
        let _ = write!(out, ",\"ProcessMemoryLimit\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ProcessMemoryLimit), size_of_field(|value: &T| &value.ProcessMemoryLimit));
        let _ = write!(out, ",\"JobMemoryLimit\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, JobMemoryLimit), size_of_field(|value: &T| &value.JobMemoryLimit));
        let _ = write!(out, ",\"PeakProcessMemoryUsed\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PeakProcessMemoryUsed), size_of_field(|value: &T| &value.PeakProcessMemoryUsed));
        let _ = write!(out, ",\"PeakJobMemoryUsed\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PeakJobMemoryUsed), size_of_field(|value: &T| &value.PeakJobMemoryUsed));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::STARTUPINFOW;
        let _ = write!(out, ",\n\"STARTUPINFOW\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        let _ = write!(out, ",\"lpReserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpReserved), size_of_field(|value: &T| &value.lpReserved));
        let _ = write!(out, ",\"lpDesktop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpDesktop), size_of_field(|value: &T| &value.lpDesktop));
        let _ = write!(out, ",\"lpTitle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpTitle), size_of_field(|value: &T| &value.lpTitle));
        let _ = write!(out, ",\"dwX\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwX), size_of_field(|value: &T| &value.dwX));
        let _ = write!(out, ",\"dwY\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwY), size_of_field(|value: &T| &value.dwY));
        let _ = write!(out, ",\"dwXSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwXSize), size_of_field(|value: &T| &value.dwXSize));
        let _ = write!(out, ",\"dwYSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwYSize), size_of_field(|value: &T| &value.dwYSize));
        let _ = write!(out, ",\"dwXCountChars\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwXCountChars), size_of_field(|value: &T| &value.dwXCountChars));
        let _ = write!(out, ",\"dwYCountChars\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwYCountChars), size_of_field(|value: &T| &value.dwYCountChars));
        let _ = write!(out, ",\"dwFillAttribute\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwFillAttribute), size_of_field(|value: &T| &value.dwFillAttribute));
        let _ = write!(out, ",\"dwFlags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwFlags), size_of_field(|value: &T| &value.dwFlags));
        let _ = write!(out, ",\"wShowWindow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wShowWindow), size_of_field(|value: &T| &value.wShowWindow));
        let _ = write!(out, ",\"cbReserved2\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cbReserved2), size_of_field(|value: &T| &value.cbReserved2));
        let _ = write!(out, ",\"lpReserved2\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpReserved2), size_of_field(|value: &T| &value.lpReserved2));
        let _ = write!(out, ",\"hStdInput\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hStdInput), size_of_field(|value: &T| &value.hStdInput));
        let _ = write!(out, ",\"hStdOutput\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hStdOutput), size_of_field(|value: &T| &value.hStdOutput));
        let _ = write!(out, ",\"hStdError\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hStdError), size_of_field(|value: &T| &value.hStdError));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::STARTUPINFOEXW;
        let _ = write!(out, ",\n\"STARTUPINFOEXW\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"StartupInfo\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, StartupInfo), size_of_field(|value: &T| &value.StartupInfo));
        let _ = write!(out, ",\"lpAttributeList\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, lpAttributeList), size_of_field(|value: &T| &value.lpAttributeList));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::PROCESS_INFORMATION;
        let _ = write!(out, ",\n\"PROCESS_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"hProcess\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hProcess), size_of_field(|value: &T| &value.hProcess));
        let _ = write!(out, ",\"hThread\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hThread), size_of_field(|value: &T| &value.hThread));
        let _ = write!(out, ",\"dwProcessId\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwProcessId), size_of_field(|value: &T| &value.dwProcessId));
        let _ = write!(out, ",\"dwThreadId\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dwThreadId), size_of_field(|value: &T| &value.dwThreadId));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::CURDIR;
        let _ = write!(out, ",\n\"CURDIR\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"DosPath\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, DosPath), size_of_field(|value: &T| &value.DosPath));
        let _ = write!(out, ",\"Handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Handle), size_of_field(|value: &T| &value.Handle));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::RTL_USER_PROCESS_PARAMETERS;
        let _ = write!(out, ",\n\"RTL_USER_PROCESS_PARAMETERS\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"hStdInput\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hStdInput), size_of_field(|value: &T| &value.hStdInput));
        let _ = write!(out, ",\"hStdOutput\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hStdOutput), size_of_field(|value: &T| &value.hStdOutput));
        let _ = write!(out, ",\"hStdError\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, hStdError), size_of_field(|value: &T| &value.hStdError));
        let _ = write!(out, ",\"CurrentDirectory\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CurrentDirectory), size_of_field(|value: &T| &value.CurrentDirectory));
        let _ = write!(out, ",\"DllPath\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, DllPath), size_of_field(|value: &T| &value.DllPath));
        let _ = write!(out, ",\"ImagePathName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ImagePathName), size_of_field(|value: &T| &value.ImagePathName));
        let _ = write!(out, ",\"CommandLine\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, CommandLine), size_of_field(|value: &T| &value.CommandLine));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::PEB;
        let _ = write!(out, ",\n\"PEB\":{{\"partial\":true,\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"BeingDebugged\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, BeingDebugged), size_of_field(|value: &T| &value.BeingDebugged));
        let _ = write!(out, ",\"Ldr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Ldr), size_of_field(|value: &T| &value.Ldr));
        let _ = write!(out, ",\"ProcessParameters\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ProcessParameters), size_of_field(|value: &T| &value.ProcessParameters));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_windows_sys::TEB;
        let _ = write!(out, ",\n\"TEB\":{{\"partial\":true,\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"EnvironmentPointer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, EnvironmentPointer), size_of_field(|value: &T| &value.EnvironmentPointer));
        let _ = write!(out, ",\"ActiveRpcHandle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ActiveRpcHandle), size_of_field(|value: &T| &value.ActiveRpcHandle));
        let _ = write!(out, ",\"ThreadLocalStoragePointer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ThreadLocalStoragePointer), size_of_field(|value: &T| &value.ThreadLocalStoragePointer));
        let _ = write!(out, ",\"ProcessEnvironmentBlock\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ProcessEnvironmentBlock), size_of_field(|value: &T| &value.ProcessEnvironmentBlock));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv__queue;
        let _ = write!(out, ",\n\"uv__queue\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next), size_of_field(|value: &T| &value.next));
        let _ = write!(out, ",\"prev\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, prev), size_of_field(|value: &T| &value.prev));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv__work;
        let _ = write!(out, ",\n\"uv__work\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"work\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, work), size_of_field(|value: &T| &value.work));
        let _ = write!(out, ",\"done\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, done), size_of_field(|value: &T| &value.done));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"wq\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wq), size_of_field(|value: &T| &value.wq));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_buf_t;
        let _ = write!(out, ",\n\"uv_buf_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"len\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, len), size_of_field(|value: &T| &value.len));
        let _ = write!(out, ",\"base\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, base), size_of_field(|value: &T| &value.base));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::req_u_io;
        let _ = write!(out, ",\n\"req_u_io\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"overlapped\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, overlapped), size_of_field(|value: &T| &value.overlapped));
        let _ = write!(out, ",\"queued_bytes\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, queued_bytes), size_of_field(|value: &T| &value.queued_bytes));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::req_u_connect;
        let _ = write!(out, ",\n\"req_u_connect\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"result\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, result), size_of_field(|value: &T| &value.result));
        let _ = write!(out, ",\"pipeHandle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, pipeHandle), size_of_field(|value: &T| &value.pipeHandle));
        let _ = write!(out, ",\"duplex_flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, duplex_flags), size_of_field(|value: &T| &value.duplex_flags));
        let _ = write!(out, ",\"name\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, name), size_of_field(|value: &T| &value.name));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::req_u;
        let _ = write!(out, ",\n\"req_u\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"io\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, io), size_of_field(|value: &T| unsafe { &value.io }));
        let _ = write!(out, ",\"connect\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, connect), size_of_field(|value: &T| unsafe { &value.connect }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_req_t;
        let _ = write!(out, ",\n\"uv_req_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::handle_u;
        let _ = write!(out, ",\n\"handle_u\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"fd\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, fd), size_of_field(|value: &T| unsafe { &value.fd }));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| unsafe { &value.reserved }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::Handle;
        let _ = write!(out, ",\n\"uv_handle_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::Loop;
        let _ = write!(out, ",\n\"uv_loop_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"active_handles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, active_handles), size_of_field(|value: &T| &value.active_handles));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"internal_fields\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, internal_fields), size_of_field(|value: &T| &value.internal_fields));
        let _ = write!(out, ",\"stop_flag\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, stop_flag), size_of_field(|value: &T| &value.stop_flag));
        let _ = write!(out, ",\"iocp\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, iocp), size_of_field(|value: &T| &value.iocp));
        let _ = write!(out, ",\"time\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, time), size_of_field(|value: &T| &value.time));
        let _ = write!(out, ",\"pending_reqs_tail\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, pending_reqs_tail), size_of_field(|value: &T| &value.pending_reqs_tail));
        let _ = write!(out, ",\"endgame_handles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_handles), size_of_field(|value: &T| &value.endgame_handles));
        let _ = write!(out, ",\"timer_heap\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, timer_heap), size_of_field(|value: &T| &value.timer_heap));
        let _ = write!(out, ",\"prepare_handles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, prepare_handles), size_of_field(|value: &T| &value.prepare_handles));
        let _ = write!(out, ",\"check_handles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, check_handles), size_of_field(|value: &T| &value.check_handles));
        let _ = write!(out, ",\"idle_handles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, idle_handles), size_of_field(|value: &T| &value.idle_handles));
        let _ = write!(out, ",\"next_prepare_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_prepare_handle), size_of_field(|value: &T| &value.next_prepare_handle));
        let _ = write!(out, ",\"next_check_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_check_handle), size_of_field(|value: &T| &value.next_check_handle));
        let _ = write!(out, ",\"next_idle_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_idle_handle), size_of_field(|value: &T| &value.next_idle_handle));
        let _ = write!(out, ",\"poll_peer_sockets\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, poll_peer_sockets), size_of_field(|value: &T| &value.poll_peer_sockets));
        let _ = write!(out, ",\"active_tcp_streams\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, active_tcp_streams), size_of_field(|value: &T| &value.active_tcp_streams));
        let _ = write!(out, ",\"active_udp_streams\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, active_udp_streams), size_of_field(|value: &T| &value.active_udp_streams));
        let _ = write!(out, ",\"timer_counter\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, timer_counter), size_of_field(|value: &T| &value.timer_counter));
        let _ = write!(out, ",\"wq\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wq), size_of_field(|value: &T| &value.wq));
        let _ = write!(out, ",\"wq_mutex\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wq_mutex), size_of_field(|value: &T| &value.wq_mutex));
        let _ = write!(out, ",\"wq_async\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wq_async), size_of_field(|value: &T| &value.wq_async));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_read_t;
        let _ = write!(out, ",\n\"uv_read_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"event_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, event_handle), size_of_field(|value: &T| &value.event_handle));
        let _ = write!(out, ",\"wait_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wait_handle), size_of_field(|value: &T| &value.wait_handle));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_shutdown_t;
        let _ = write!(out, ",\n\"uv_shutdown_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle), size_of_field(|value: &T| &value.handle));
        let _ = write!(out, ",\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_stream_t;
        let _ = write!(out, ",\n\"uv_stream_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"write_queue_size\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, write_queue_size), size_of_field(|value: &T| &value.write_queue_size));
        let _ = write!(out, ",\"alloc_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, alloc_cb), size_of_field(|value: &T| &value.alloc_cb));
        let _ = write!(out, ",\"read_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_cb), size_of_field(|value: &T| &value.read_cb));
        let _ = write!(out, ",\"reqs_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reqs_pending), size_of_field(|value: &T| &value.reqs_pending));
        let _ = write!(out, ",\"activecnt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, activecnt), size_of_field(|value: &T| &value.activecnt));
        let _ = write!(out, ",\"read_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_req), size_of_field(|value: &T| &value.read_req));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_write_t;
        let _ = write!(out, ",\n\"uv_write_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        let _ = write!(out, ",\"send_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, send_handle), size_of_field(|value: &T| &value.send_handle));
        let _ = write!(out, ",\"handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle), size_of_field(|value: &T| &value.handle));
        let _ = write!(out, ",\"coalesced\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, coalesced), size_of_field(|value: &T| &value.coalesced));
        let _ = write!(out, ",\"write_buffer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, write_buffer), size_of_field(|value: &T| &value.write_buffer));
        let _ = write!(out, ",\"event_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, event_handle), size_of_field(|value: &T| &value.event_handle));
        let _ = write!(out, ",\"wait_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wait_handle), size_of_field(|value: &T| &value.wait_handle));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_connect_t;
        let _ = write!(out, ",\n\"uv_connect_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        let _ = write!(out, ",\"handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle), size_of_field(|value: &T| &value.handle));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_tcp_accept_t;
        let _ = write!(out, ",\n\"uv_tcp_accept_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"accept_socket\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, accept_socket), size_of_field(|value: &T| &value.accept_socket));
        let _ = write!(out, ",\"accept_buffer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, accept_buffer), size_of_field(|value: &T| &value.accept_buffer));
        let _ = write!(out, ",\"event_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, event_handle), size_of_field(|value: &T| &value.event_handle));
        let _ = write!(out, ",\"wait_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wait_handle), size_of_field(|value: &T| &value.wait_handle));
        let _ = write!(out, ",\"next_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_pending), size_of_field(|value: &T| &value.next_pending));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_tcp_t;
        let _ = write!(out, ",\n\"uv_tcp_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"write_queue_size\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, write_queue_size), size_of_field(|value: &T| &value.write_queue_size));
        let _ = write!(out, ",\"alloc_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, alloc_cb), size_of_field(|value: &T| &value.alloc_cb));
        let _ = write!(out, ",\"read_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_cb), size_of_field(|value: &T| &value.read_cb));
        let _ = write!(out, ",\"reqs_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reqs_pending), size_of_field(|value: &T| &value.reqs_pending));
        let _ = write!(out, ",\"activecnt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, activecnt), size_of_field(|value: &T| &value.activecnt));
        let _ = write!(out, ",\"read_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_req), size_of_field(|value: &T| &value.read_req));
        let _ = write!(out, ",\"socket\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, socket), size_of_field(|value: &T| &value.socket));
        let _ = write!(out, ",\"delayed_error\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, delayed_error), size_of_field(|value: &T| &value.delayed_error));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_udp_t;
        let _ = write!(out, ",\n\"uv_udp_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"send_queue_size\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, send_queue_size), size_of_field(|value: &T| &value.send_queue_size));
        let _ = write!(out, ",\"send_queue_count\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, send_queue_count), size_of_field(|value: &T| &value.send_queue_count));
        let _ = write!(out, ",\"socket\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, socket), size_of_field(|value: &T| &value.socket));
        let _ = write!(out, ",\"reqs_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reqs_pending), size_of_field(|value: &T| &value.reqs_pending));
        let _ = write!(out, ",\"activecnt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, activecnt), size_of_field(|value: &T| &value.activecnt));
        let _ = write!(out, ",\"recv_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, recv_req), size_of_field(|value: &T| &value.recv_req));
        let _ = write!(out, ",\"recv_buffer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, recv_buffer), size_of_field(|value: &T| &value.recv_buffer));
        let _ = write!(out, ",\"recv_from\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, recv_from), size_of_field(|value: &T| &value.recv_from));
        let _ = write!(out, ",\"recv_from_len\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, recv_from_len), size_of_field(|value: &T| &value.recv_from_len));
        let _ = write!(out, ",\"recv_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, recv_cb), size_of_field(|value: &T| &value.recv_cb));
        let _ = write!(out, ",\"alloc_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, alloc_cb), size_of_field(|value: &T| &value.alloc_cb));
        let _ = write!(out, ",\"func_wsarecv\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, func_wsarecv), size_of_field(|value: &T| &value.func_wsarecv));
        let _ = write!(out, ",\"func_wsarecvfrom\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, func_wsarecvfrom), size_of_field(|value: &T| &value.func_wsarecvfrom));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_udp_send_t;
        let _ = write!(out, ",\n\"uv_udp_send_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle), size_of_field(|value: &T| &value.handle));
        let _ = write!(out, ",\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_pipe_accept_t;
        let _ = write!(out, ",\n\"uv_pipe_accept_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"pipeHandle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, pipeHandle), size_of_field(|value: &T| &value.pipeHandle));
        let _ = write!(out, ",\"next_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_pending), size_of_field(|value: &T| &value.next_pending));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::Pipe;
        let _ = write!(out, ",\n\"uv_pipe_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"write_queue_size\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, write_queue_size), size_of_field(|value: &T| &value.write_queue_size));
        let _ = write!(out, ",\"alloc_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, alloc_cb), size_of_field(|value: &T| &value.alloc_cb));
        let _ = write!(out, ",\"read_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_cb), size_of_field(|value: &T| &value.read_cb));
        let _ = write!(out, ",\"reqs_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reqs_pending), size_of_field(|value: &T| &value.reqs_pending));
        let _ = write!(out, ",\"activecnt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, activecnt), size_of_field(|value: &T| &value.activecnt));
        let _ = write!(out, ",\"read_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_req), size_of_field(|value: &T| &value.read_req));
        let _ = write!(out, ",\"ipc\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ipc), size_of_field(|value: &T| &value.ipc));
        let _ = write!(out, ",\"handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle), size_of_field(|value: &T| &value.handle));
        let _ = write!(out, ",\"name\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, name), size_of_field(|value: &T| &value.name));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_tty_t;
        let _ = write!(out, ",\n\"uv_tty_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"write_queue_size\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, write_queue_size), size_of_field(|value: &T| &value.write_queue_size));
        let _ = write!(out, ",\"alloc_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, alloc_cb), size_of_field(|value: &T| &value.alloc_cb));
        let _ = write!(out, ",\"read_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_cb), size_of_field(|value: &T| &value.read_cb));
        let _ = write!(out, ",\"reqs_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reqs_pending), size_of_field(|value: &T| &value.reqs_pending));
        let _ = write!(out, ",\"activecnt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, activecnt), size_of_field(|value: &T| &value.activecnt));
        let _ = write!(out, ",\"read_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_req), size_of_field(|value: &T| &value.read_req));
        let _ = write!(out, ",\"handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle), size_of_field(|value: &T| &value.handle));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::Tty;
        let _ = write!(out, ",\n\"Tty\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"uv\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, uv), size_of_field(|value: &T| &value.uv));
        let _ = write!(out, ",\"read_scratch\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, read_scratch), size_of_field(|value: &T| &value.read_scratch));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::AFD_POLL_HANDLE_INFO;
        let _ = write!(out, ",\n\"AFD_POLL_HANDLE_INFO\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Handle), size_of_field(|value: &T| &value.Handle));
        let _ = write!(out, ",\"Events\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Events), size_of_field(|value: &T| &value.Events));
        let _ = write!(out, ",\"Status\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Status), size_of_field(|value: &T| &value.Status));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::AFD_POLL_INFO;
        let _ = write!(out, ",\n\"AFD_POLL_INFO\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"Timeout\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Timeout), size_of_field(|value: &T| &value.Timeout));
        let _ = write!(out, ",\"NumberOfHandles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, NumberOfHandles), size_of_field(|value: &T| &value.NumberOfHandles));
        let _ = write!(out, ",\"Exclusive\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Exclusive), size_of_field(|value: &T| &value.Exclusive));
        let _ = write!(out, ",\"Handles\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Handles), size_of_field(|value: &T| &value.Handles));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_poll_t;
        let _ = write!(out, ",\n\"uv_poll_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"poll_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, poll_cb), size_of_field(|value: &T| &value.poll_cb));
        let _ = write!(out, ",\"socket\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, socket), size_of_field(|value: &T| &value.socket));
        let _ = write!(out, ",\"peer_socket\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, peer_socket), size_of_field(|value: &T| &value.peer_socket));
        let _ = write!(out, ",\"afd_poll_info_1\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, afd_poll_info_1), size_of_field(|value: &T| &value.afd_poll_info_1));
        let _ = write!(out, ",\"afd_poll_info_2\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, afd_poll_info_2), size_of_field(|value: &T| &value.afd_poll_info_2));
        let _ = write!(out, ",\"poll_req_1\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, poll_req_1), size_of_field(|value: &T| &value.poll_req_1));
        let _ = write!(out, ",\"poll_req_2\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, poll_req_2), size_of_field(|value: &T| &value.poll_req_2));
        let _ = write!(out, ",\"submitted_events_1\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, submitted_events_1), size_of_field(|value: &T| &value.submitted_events_1));
        let _ = write!(out, ",\"submitted_events_2\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, submitted_events_2), size_of_field(|value: &T| &value.submitted_events_2));
        let _ = write!(out, ",\"mask_events_1\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, mask_events_1), size_of_field(|value: &T| &value.mask_events_1));
        let _ = write!(out, ",\"mask_events_2\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, mask_events_2), size_of_field(|value: &T| &value.mask_events_2));
        let _ = write!(out, ",\"events\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, events), size_of_field(|value: &T| &value.events));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::Timer;
        let _ = write!(out, ",\n\"uv_timer_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"heap_node\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, heap_node), size_of_field(|value: &T| &value.heap_node));
        let _ = write!(out, ",\"unused\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, unused), size_of_field(|value: &T| &value.unused));
        let _ = write!(out, ",\"timeout\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, timeout), size_of_field(|value: &T| &value.timeout));
        let _ = write!(out, ",\"repeat\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, repeat), size_of_field(|value: &T| &value.repeat));
        let _ = write!(out, ",\"start_id\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, start_id), size_of_field(|value: &T| &value.start_id));
        let _ = write!(out, ",\"timer_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, timer_cb), size_of_field(|value: &T| &value.timer_cb));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_prepare_t;
        let _ = write!(out, ",\n\"uv_prepare_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"prepare_prev\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, prepare_prev), size_of_field(|value: &T| &value.prepare_prev));
        let _ = write!(out, ",\"prepare_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, prepare_next), size_of_field(|value: &T| &value.prepare_next));
        let _ = write!(out, ",\"prepare_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, prepare_cb), size_of_field(|value: &T| &value.prepare_cb));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_check_t;
        let _ = write!(out, ",\n\"uv_check_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"check_prev\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, check_prev), size_of_field(|value: &T| &value.check_prev));
        let _ = write!(out, ",\"check_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, check_next), size_of_field(|value: &T| &value.check_next));
        let _ = write!(out, ",\"check_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, check_cb), size_of_field(|value: &T| &value.check_cb));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_idle_t;
        let _ = write!(out, ",\n\"uv_idle_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"idle_prev\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, idle_prev), size_of_field(|value: &T| &value.idle_prev));
        let _ = write!(out, ",\"idle_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, idle_next), size_of_field(|value: &T| &value.idle_next));
        let _ = write!(out, ",\"idle_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, idle_cb), size_of_field(|value: &T| &value.idle_cb));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_async_t;
        let _ = write!(out, ",\n\"uv_async_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"async_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, async_req), size_of_field(|value: &T| &value.async_req));
        let _ = write!(out, ",\"async_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, async_cb), size_of_field(|value: &T| &value.async_cb));
        let _ = write!(out, ",\"async_sent\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, async_sent), size_of_field(|value: &T| &value.async_sent));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_process_exit_t;
        let _ = write!(out, ",\n\"uv_process_exit_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::Process;
        let _ = write!(out, ",\n\"uv_process_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"exit_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, exit_cb), size_of_field(|value: &T| &value.exit_cb));
        let _ = write!(out, ",\"pid\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, pid), size_of_field(|value: &T| &value.pid));
        let _ = write!(out, ",\"exit_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, exit_req), size_of_field(|value: &T| &value.exit_req));
        let _ = write!(out, ",\"unused\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, unused), size_of_field(|value: &T| &value.unused));
        let _ = write!(out, ",\"exit_signal\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, exit_signal), size_of_field(|value: &T| &value.exit_signal));
        let _ = write!(out, ",\"wait_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, wait_handle), size_of_field(|value: &T| &value.wait_handle));
        let _ = write!(out, ",\"process_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, process_handle), size_of_field(|value: &T| &value.process_handle));
        let _ = write!(out, ",\"exit_cb_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, exit_cb_pending), size_of_field(|value: &T| &value.exit_cb_pending));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_stdio_container_data;
        let _ = write!(out, ",\n\"uv_stdio_container_data\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"stream\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, stream), size_of_field(|value: &T| unsafe { &value.stream }));
        let _ = write!(out, ",\"fd\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, fd), size_of_field(|value: &T| unsafe { &value.fd }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_stdio_container_t;
        let _ = write!(out, ",\n\"uv_stdio_container_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_process_options_t;
        let _ = write!(out, ",\n\"uv_process_options_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"exit_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, exit_cb), size_of_field(|value: &T| &value.exit_cb));
        let _ = write!(out, ",\"file\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, file), size_of_field(|value: &T| &value.file));
        let _ = write!(out, ",\"args\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, args), size_of_field(|value: &T| &value.args));
        let _ = write!(out, ",\"env\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, env), size_of_field(|value: &T| &value.env));
        let _ = write!(out, ",\"cwd\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cwd), size_of_field(|value: &T| &value.cwd));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"stdio_count\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, stdio_count), size_of_field(|value: &T| &value.stdio_count));
        let _ = write!(out, ",\"stdio\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, stdio), size_of_field(|value: &T| &value.stdio));
        let _ = write!(out, ",\"uid\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, uid), size_of_field(|value: &T| &value.uid));
        let _ = write!(out, ",\"gid\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, gid), size_of_field(|value: &T| &value.gid));
        let _ = write!(out, ",\"pseudoconsole\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, pseudoconsole), size_of_field(|value: &T| &value.pseudoconsole));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_fs_event_req_t;
        let _ = write!(out, ",\n\"uv_fs_event_req_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_fs_event_t;
        let _ = write!(out, ",\n\"uv_fs_event_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"path\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, path), size_of_field(|value: &T| &value.path));
        let _ = write!(out, ",\"req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, req), size_of_field(|value: &T| &value.req));
        let _ = write!(out, ",\"dir_handle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, dir_handle), size_of_field(|value: &T| &value.dir_handle));
        let _ = write!(out, ",\"req_pending\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, req_pending), size_of_field(|value: &T| &value.req_pending));
        let _ = write!(out, ",\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        let _ = write!(out, ",\"filew\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, filew), size_of_field(|value: &T| &value.filew));
        let _ = write!(out, ",\"short_filew\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, short_filew), size_of_field(|value: &T| &value.short_filew));
        let _ = write!(out, ",\"buffer\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, buffer), size_of_field(|value: &T| &value.buffer));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_fs_poll_t;
        let _ = write!(out, ",\n\"uv_fs_poll_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"poll_ctx\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, poll_ctx), size_of_field(|value: &T| &value.poll_ctx));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_signal_t;
        let _ = write!(out, ",\n\"uv_signal_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"close_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, close_cb), size_of_field(|value: &T| &value.close_cb));
        let _ = write!(out, ",\"handle_queue\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, handle_queue), size_of_field(|value: &T| &value.handle_queue));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"endgame_next\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, endgame_next), size_of_field(|value: &T| &value.endgame_next));
        let _ = write!(out, ",\"flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, flags), size_of_field(|value: &T| &value.flags));
        let _ = write!(out, ",\"signal_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, signal_cb), size_of_field(|value: &T| &value.signal_cb));
        let _ = write!(out, ",\"signum\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, signum), size_of_field(|value: &T| &value.signum));
        let _ = write!(out, ",\"signal_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, signal_req), size_of_field(|value: &T| &value.signal_req));
        let _ = write!(out, ",\"pending_signum\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, pending_signum), size_of_field(|value: &T| &value.pending_signum));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_getaddrinfo_t;
        let _ = write!(out, ",\n\"uv_getaddrinfo_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"work_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, work_req), size_of_field(|value: &T| &value.work_req));
        let _ = write!(out, ",\"getaddrinfo_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, getaddrinfo_cb), size_of_field(|value: &T| &value.getaddrinfo_cb));
        let _ = write!(out, ",\"alloc\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, alloc), size_of_field(|value: &T| &value.alloc));
        let _ = write!(out, ",\"node\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, node), size_of_field(|value: &T| &value.node));
        let _ = write!(out, ",\"service\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, service), size_of_field(|value: &T| &value.service));
        let _ = write!(out, ",\"addrinfow\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, addrinfow), size_of_field(|value: &T| &value.addrinfow));
        let _ = write!(out, ",\"addrinfo\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, addrinfo), size_of_field(|value: &T| &value.addrinfo));
        let _ = write!(out, ",\"retcode\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, retcode), size_of_field(|value: &T| &value.retcode));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_work_t;
        let _ = write!(out, ",\n\"uv_work_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"work_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, work_cb), size_of_field(|value: &T| &value.work_cb));
        let _ = write!(out, ",\"after_work_cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, after_work_cb), size_of_field(|value: &T| &value.after_work_cb));
        let _ = write!(out, ",\"work_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, work_req), size_of_field(|value: &T| &value.work_req));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_timespec_t;
        let _ = write!(out, ",\n\"uv_timespec_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"sec\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sec), size_of_field(|value: &T| &value.sec));
        let _ = write!(out, ",\"nsec\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nsec), size_of_field(|value: &T| &value.nsec));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_timeval_t;
        let _ = write!(out, ",\n\"uv_timeval_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"sec\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sec), size_of_field(|value: &T| &value.sec));
        let _ = write!(out, ",\"usec\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, usec), size_of_field(|value: &T| &value.usec));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_stat_t;
        let _ = write!(out, ",\n\"uv_stat_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"st_dev\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_dev), size_of_field(|value: &T| &value.st_dev));
        let _ = write!(out, ",\"st_mode\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_mode), size_of_field(|value: &T| &value.st_mode));
        let _ = write!(out, ",\"st_nlink\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_nlink), size_of_field(|value: &T| &value.st_nlink));
        let _ = write!(out, ",\"st_uid\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_uid), size_of_field(|value: &T| &value.st_uid));
        let _ = write!(out, ",\"st_gid\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_gid), size_of_field(|value: &T| &value.st_gid));
        let _ = write!(out, ",\"st_rdev\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_rdev), size_of_field(|value: &T| &value.st_rdev));
        let _ = write!(out, ",\"st_ino\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_ino), size_of_field(|value: &T| &value.st_ino));
        let _ = write!(out, ",\"st_size\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_size), size_of_field(|value: &T| &value.st_size));
        let _ = write!(out, ",\"st_blksize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_blksize), size_of_field(|value: &T| &value.st_blksize));
        let _ = write!(out, ",\"st_blocks\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_blocks), size_of_field(|value: &T| &value.st_blocks));
        let _ = write!(out, ",\"st_flags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_flags), size_of_field(|value: &T| &value.st_flags));
        let _ = write!(out, ",\"st_gen\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, st_gen), size_of_field(|value: &T| &value.st_gen));
        let _ = write!(out, ",\"atim\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, atim), size_of_field(|value: &T| &value.atim));
        let _ = write!(out, ",\"mtim\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, mtim), size_of_field(|value: &T| &value.mtim));
        let _ = write!(out, ",\"ctim\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ctim), size_of_field(|value: &T| &value.ctim));
        let _ = write!(out, ",\"birthtim\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, birthtim), size_of_field(|value: &T| &value.birthtim));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::fs_t;
        let _ = write!(out, ",\n\"uv_fs_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"data\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, data), size_of_field(|value: &T| &value.data));
        let _ = write!(out, ",\"type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, type_), size_of_field(|value: &T| &value.type_));
        let _ = write!(out, ",\"reserved\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, reserved), size_of_field(|value: &T| &value.reserved));
        let _ = write!(out, ",\"u\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, u), size_of_field(|value: &T| &value.u));
        let _ = write!(out, ",\"next_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, next_req), size_of_field(|value: &T| &value.next_req));
        let _ = write!(out, ",\"fs_type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, fs_type), size_of_field(|value: &T| &value.fs_type));
        let _ = write!(out, ",\"loop\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, loop_), size_of_field(|value: &T| &value.loop_));
        let _ = write!(out, ",\"cb\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cb), size_of_field(|value: &T| &value.cb));
        let _ = write!(out, ",\"result\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, result), size_of_field(|value: &T| &value.result));
        let _ = write!(out, ",\"path\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, path), size_of_field(|value: &T| &value.path));
        let _ = write!(out, ",\"statbuf\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, statbuf), size_of_field(|value: &T| &value.statbuf));
        let _ = write!(out, ",\"work_req\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, work_req), size_of_field(|value: &T| &value.work_req));
        let _ = write!(out, ",\"sys_errno_\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sys_errno_), size_of_field(|value: &T| &value.sys_errno_));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_cpu_times_t;
        let _ = write!(out, ",\n\"uv_cpu_times_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"user\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, user), size_of_field(|value: &T| &value.user));
        let _ = write!(out, ",\"nice\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, nice), size_of_field(|value: &T| &value.nice));
        let _ = write!(out, ",\"sys\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sys), size_of_field(|value: &T| &value.sys));
        let _ = write!(out, ",\"idle\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, idle), size_of_field(|value: &T| &value.idle));
        let _ = write!(out, ",\"irq\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, irq), size_of_field(|value: &T| &value.irq));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_cpu_info_t;
        let _ = write!(out, ",\n\"uv_cpu_info_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"model\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, model), size_of_field(|value: &T| &value.model));
        let _ = write!(out, ",\"speed\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, speed), size_of_field(|value: &T| &value.speed));
        let _ = write!(out, ",\"cpu_times\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, cpu_times), size_of_field(|value: &T| &value.cpu_times));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::addr_union;
        let _ = write!(out, ",\n\"addr_union\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"address4\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, address4), size_of_field(|value: &T| unsafe { &value.address4 }));
        let _ = write!(out, ",\"address6\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, address6), size_of_field(|value: &T| unsafe { &value.address6 }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::netmask_union;
        let _ = write!(out, ",\n\"netmask_union\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"netmask4\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, netmask4), size_of_field(|value: &T| unsafe { &value.netmask4 }));
        let _ = write!(out, ",\"netmask6\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, netmask6), size_of_field(|value: &T| unsafe { &value.netmask6 }));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_interface_address_t;
        let _ = write!(out, ",\n\"uv_interface_address_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"name\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, name), size_of_field(|value: &T| &value.name));
        let _ = write!(out, ",\"phys_addr\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, phys_addr), size_of_field(|value: &T| &value.phys_addr));
        let _ = write!(out, ",\"is_internal\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, is_internal), size_of_field(|value: &T| &value.is_internal));
        let _ = write!(out, ",\"address\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, address), size_of_field(|value: &T| &value.address));
        let _ = write!(out, ",\"netmask\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, netmask), size_of_field(|value: &T| &value.netmask));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_utsname_t;
        let _ = write!(out, ",\n\"uv_utsname_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"sysname\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, sysname), size_of_field(|value: &T| &value.sysname));
        let _ = write!(out, ",\"release\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, release), size_of_field(|value: &T| &value.release));
        let _ = write!(out, ",\"version\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, version), size_of_field(|value: &T| &value.version));
        let _ = write!(out, ",\"machine\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, machine), size_of_field(|value: &T| &value.machine));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_statfs_t;
        let _ = write!(out, ",\n\"uv_statfs_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"f_type\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_type), size_of_field(|value: &T| &value.f_type));
        let _ = write!(out, ",\"f_bsize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_bsize), size_of_field(|value: &T| &value.f_bsize));
        let _ = write!(out, ",\"f_blocks\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_blocks), size_of_field(|value: &T| &value.f_blocks));
        let _ = write!(out, ",\"f_bfree\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_bfree), size_of_field(|value: &T| &value.f_bfree));
        let _ = write!(out, ",\"f_bavail\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_bavail), size_of_field(|value: &T| &value.f_bavail));
        let _ = write!(out, ",\"f_files\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_files), size_of_field(|value: &T| &value.f_files));
        let _ = write!(out, ",\"f_ffree\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_ffree), size_of_field(|value: &T| &value.f_ffree));
        let _ = write!(out, ",\"f_spare\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, f_spare), size_of_field(|value: &T| &value.f_spare));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_libuv_sys::uv_rusage_t;
        let _ = write!(out, ",\n\"uv_rusage_t\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ru_utime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_utime), size_of_field(|value: &T| &value.ru_utime));
        let _ = write!(out, ",\"ru_stime\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_stime), size_of_field(|value: &T| &value.ru_stime));
        let _ = write!(out, ",\"ru_maxrss\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_maxrss), size_of_field(|value: &T| &value.ru_maxrss));
        let _ = write!(out, ",\"ru_ixrss\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_ixrss), size_of_field(|value: &T| &value.ru_ixrss));
        let _ = write!(out, ",\"ru_idrss\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_idrss), size_of_field(|value: &T| &value.ru_idrss));
        let _ = write!(out, ",\"ru_isrss\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_isrss), size_of_field(|value: &T| &value.ru_isrss));
        let _ = write!(out, ",\"ru_minflt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_minflt), size_of_field(|value: &T| &value.ru_minflt));
        let _ = write!(out, ",\"ru_majflt\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_majflt), size_of_field(|value: &T| &value.ru_majflt));
        let _ = write!(out, ",\"ru_nswap\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_nswap), size_of_field(|value: &T| &value.ru_nswap));
        let _ = write!(out, ",\"ru_inblock\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_inblock), size_of_field(|value: &T| &value.ru_inblock));
        let _ = write!(out, ",\"ru_oublock\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_oublock), size_of_field(|value: &T| &value.ru_oublock));
        let _ = write!(out, ",\"ru_msgsnd\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_msgsnd), size_of_field(|value: &T| &value.ru_msgsnd));
        let _ = write!(out, ",\"ru_msgrcv\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_msgrcv), size_of_field(|value: &T| &value.ru_msgrcv));
        let _ = write!(out, ",\"ru_nsignals\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_nsignals), size_of_field(|value: &T| &value.ru_nsignals));
        let _ = write!(out, ",\"ru_nvcsw\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_nvcsw), size_of_field(|value: &T| &value.ru_nvcsw));
        let _ = write!(out, ",\"ru_nivcsw\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ru_nivcsw), size_of_field(|value: &T| &value.ru_nivcsw));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_sys::windows::FILE_NOTIFY_INFORMATION;
        let _ = write!(out, ",\n\"FILE_NOTIFY_INFORMATION\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"NextEntryOffset\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, NextEntryOffset), size_of_field(|value: &T| &value.NextEntryOffset));
        let _ = write!(out, ",\"Action\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, Action), size_of_field(|value: &T| &value.Action));
        let _ = write!(out, ",\"FileNameLength\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileNameLength), size_of_field(|value: &T| &value.FileNameLength));
        let _ = write!(out, ",\"FileName\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, FileName), size_of_field(|value: &T| &value.FileName));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_sys::windows::EXCEPTION_RECORD;
        let _ = write!(out, ",\n\"EXCEPTION_RECORD\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ExceptionCode\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExceptionCode), size_of_field(|value: &T| &value.ExceptionCode));
        let _ = write!(out, ",\"ExceptionFlags\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExceptionFlags), size_of_field(|value: &T| &value.ExceptionFlags));
        let _ = write!(out, ",\"ExceptionRecord\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExceptionRecord), size_of_field(|value: &T| &value.ExceptionRecord));
        let _ = write!(out, ",\"ExceptionAddress\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExceptionAddress), size_of_field(|value: &T| &value.ExceptionAddress));
        let _ = write!(out, ",\"NumberParameters\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, NumberParameters), size_of_field(|value: &T| &value.NumberParameters));
        let _ = write!(out, ",\"ExceptionInformation\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExceptionInformation), size_of_field(|value: &T| &value.ExceptionInformation));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_sys::windows::EXCEPTION_POINTERS;
        let _ = write!(out, ",\n\"EXCEPTION_POINTERS\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"ExceptionRecord\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ExceptionRecord), size_of_field(|value: &T| &value.ExceptionRecord));
        let _ = write!(out, ",\"ContextRecord\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, ContextRecord), size_of_field(|value: &T| &value.ContextRecord));
        out.extend_from_slice(b"}}");
    }
    {
        type T = bun_sys::windows::PROCESS_MEMORY_COUNTERS;
        let _ = write!(out, ",\n\"PROCESS_MEMORY_COUNTERS\":{{\"size\":{},\"align\":{},\"fields\":{{", size_of::<T>(), align_of::<T>());
        let _ = write!(out, "\"PeakWorkingSetSize\":{{\"offset\":{},\"size\":{}}}", offset_of!(T, PeakWorkingSetSize), size_of_field(|value: &T| &value.PeakWorkingSetSize));
        out.extend_from_slice(b"}}");
    }
    report.raw(&out);
}

pub fn constants(report: &mut Report) {
    let mut out = Vec::new();
    let _ = write!(out, "\n\"FALSE\":\"{}\"", bun_windows_sys::FALSE as i64);
    let _ = write!(out, ",\n\"TRUE\":\"{}\"", bun_windows_sys::TRUE as i64);
    let _ = write!(out, ",\n\"MAX_PATH\":\"{}\"", bun_windows_sys::MAX_PATH as u64);
    let _ = write!(out, ",\n\"PATH_MAX_WIDE\":\"{}\"", bun_windows_sys::PATH_MAX_WIDE as u64);
    let _ = write!(out, ",\n\"FILE_BEGIN\":\"{}\"", bun_windows_sys::FILE_BEGIN as u64);
    let _ = write!(out, ",\n\"FILE_END\":\"{}\"", bun_windows_sys::FILE_END as u64);
    let _ = write!(out, ",\n\"DUPLICATE_SAME_ACCESS\":\"{}\"", bun_windows_sys::DUPLICATE_SAME_ACCESS as u64);
    let _ = write!(out, ",\n\"FILE_SHARE_READ\":\"{}\"", bun_windows_sys::FILE_SHARE_READ as u64);
    let _ = write!(out, ",\n\"FILE_SHARE_WRITE\":\"{}\"", bun_windows_sys::FILE_SHARE_WRITE as u64);
    let _ = write!(out, ",\n\"FILE_SHARE_DELETE\":\"{}\"", bun_windows_sys::FILE_SHARE_DELETE as u64);
    let _ = write!(out, ",\n\"FILE_ATTRIBUTE_READONLY\":\"{}\"", bun_windows_sys::FILE_ATTRIBUTE_READONLY as u64);
    let _ = write!(out, ",\n\"FILE_ATTRIBUTE_HIDDEN\":\"{}\"", bun_windows_sys::FILE_ATTRIBUTE_HIDDEN as u64);
    let _ = write!(out, ",\n\"FILE_ATTRIBUTE_DIRECTORY\":\"{}\"", bun_windows_sys::FILE_ATTRIBUTE_DIRECTORY as u64);
    let _ = write!(out, ",\n\"FILE_ATTRIBUTE_NORMAL\":\"{}\"", bun_windows_sys::FILE_ATTRIBUTE_NORMAL as u64);
    let _ = write!(out, ",\n\"FILE_ATTRIBUTE_TEMPORARY\":\"{}\"", bun_windows_sys::FILE_ATTRIBUTE_TEMPORARY as u64);
    let _ = write!(out, ",\n\"FILE_ATTRIBUTE_REPARSE_POINT\":\"{}\"", bun_windows_sys::FILE_ATTRIBUTE_REPARSE_POINT as u64);
    let _ = write!(out, ",\n\"FILE_OPEN\":\"{}\"", bun_windows_sys::FILE_OPEN as u64);
    let _ = write!(out, ",\n\"FILE_CREATE\":\"{}\"", bun_windows_sys::FILE_CREATE as u64);
    let _ = write!(out, ",\n\"FILE_OPEN_IF\":\"{}\"", bun_windows_sys::FILE_OPEN_IF as u64);
    let _ = write!(out, ",\n\"FILE_OVERWRITE\":\"{}\"", bun_windows_sys::FILE_OVERWRITE as u64);
    let _ = write!(out, ",\n\"FILE_OVERWRITE_IF\":\"{}\"", bun_windows_sys::FILE_OVERWRITE_IF as u64);
    let _ = write!(out, ",\n\"FILE_DIRECTORY_FILE\":\"{}\"", bun_windows_sys::FILE_DIRECTORY_FILE as u64);
    let _ = write!(out, ",\n\"FILE_SYNCHRONOUS_IO_NONALERT\":\"{}\"", bun_windows_sys::FILE_SYNCHRONOUS_IO_NONALERT as u64);
    let _ = write!(out, ",\n\"FILE_NON_DIRECTORY_FILE\":\"{}\"", bun_windows_sys::FILE_NON_DIRECTORY_FILE as u64);
    let _ = write!(out, ",\n\"FILE_OPEN_REPARSE_POINT\":\"{}\"", bun_windows_sys::FILE_OPEN_REPARSE_POINT as u64);
    let _ = write!(out, ",\n\"OPEN_EXISTING\":\"{}\"", bun_windows_sys::OPEN_EXISTING as u64);
    let _ = write!(out, ",\n\"FILE_FLAG_BACKUP_SEMANTICS\":\"{}\"", bun_windows_sys::FILE_FLAG_BACKUP_SEMANTICS as u64);
    let _ = write!(out, ",\n\"FILE_FLAG_OVERLAPPED\":\"{}\"", bun_windows_sys::FILE_FLAG_OVERLAPPED as u64);
    let _ = write!(out, ",\n\"PIPE_ACCESS_INBOUND\":\"{}\"", bun_windows_sys::PIPE_ACCESS_INBOUND as u64);
    let _ = write!(out, ",\n\"PIPE_ACCESS_OUTBOUND\":\"{}\"", bun_windows_sys::PIPE_ACCESS_OUTBOUND as u64);
    let _ = write!(out, ",\n\"PIPE_TYPE_BYTE\":\"{}\"", bun_windows_sys::PIPE_TYPE_BYTE as u64);
    let _ = write!(out, ",\n\"PIPE_READMODE_BYTE\":\"{}\"", bun_windows_sys::PIPE_READMODE_BYTE as u64);
    let _ = write!(out, ",\n\"PIPE_WAIT\":\"{}\"", bun_windows_sys::PIPE_WAIT as u64);
    let _ = write!(out, ",\n\"SYMBOLIC_LINK_FLAG_DIRECTORY\":\"{}\"", bun_windows_sys::SYMBOLIC_LINK_FLAG_DIRECTORY as u64);
    let _ = write!(out, ",\n\"SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE\":\"{}\"", bun_windows_sys::SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE as u64);
    let _ = write!(out, ",\n\"FILE_DEVICE_NAMED_PIPE\":\"{}\"", bun_windows_sys::FILE_DEVICE_NAMED_PIPE as u64);
    let _ = write!(out, ",\n\"FILE_DEVICE_NULL\":\"{}\"", bun_windows_sys::FILE_DEVICE_NULL as u64);
    let _ = write!(out, ",\n\"FILE_DEVICE_CONSOLE\":\"{}\"", bun_windows_sys::FILE_DEVICE_CONSOLE as u64);
    let _ = write!(out, ",\n\"FILE_RENAME_REPLACE_IF_EXISTS\":\"{}\"", bun_windows_sys::FILE_RENAME_REPLACE_IF_EXISTS as u64);
    let _ = write!(out, ",\n\"FILE_RENAME_POSIX_SEMANTICS\":\"{}\"", bun_windows_sys::FILE_RENAME_POSIX_SEMANTICS as u64);
    let _ = write!(out, ",\n\"FILE_RENAME_IGNORE_READONLY_ATTRIBUTE\":\"{}\"", bun_windows_sys::FILE_RENAME_IGNORE_READONLY_ATTRIBUTE as u64);
    let _ = write!(out, ",\n\"FILE_NAME_NORMALIZED\":\"{}\"", bun_windows_sys::FILE_NAME_NORMALIZED as u64);
    let _ = write!(out, ",\n\"VOLUME_NAME_DOS\":\"{}\"", bun_windows_sys::VOLUME_NAME_DOS as u64);
    let _ = write!(out, ",\n\"VOLUME_NAME_GUID\":\"{}\"", bun_windows_sys::VOLUME_NAME_GUID as u64);
    let _ = write!(out, ",\n\"VOLUME_NAME_NT\":\"{}\"", bun_windows_sys::VOLUME_NAME_NT as u64);
    let _ = write!(out, ",\n\"VOLUME_NAME_NONE\":\"{}\"", bun_windows_sys::VOLUME_NAME_NONE as u64);
    let _ = write!(out, ",\n\"UNW_FLAG_NHANDLER\":\"{}\"", bun_windows_sys::UNW_FLAG_NHANDLER as u64);
    let _ = write!(out, ",\n\"MEM_COMMIT\":\"{}\"", bun_windows_sys::kernel32::MEM_COMMIT as u64);
    let _ = write!(out, ",\n\"PAGE_NOACCESS\":\"{}\"", bun_windows_sys::kernel32::PAGE_NOACCESS as u64);
    let _ = write!(out, ",\n\"PAGE_READONLY\":\"{}\"", bun_windows_sys::kernel32::PAGE_READONLY as u64);
    let _ = write!(out, ",\n\"PAGE_READWRITE\":\"{}\"", bun_windows_sys::kernel32::PAGE_READWRITE as u64);
    let _ = write!(out, ",\n\"PAGE_WRITECOPY\":\"{}\"", bun_windows_sys::kernel32::PAGE_WRITECOPY as u64);
    let _ = write!(out, ",\n\"PAGE_EXECUTE_READ\":\"{}\"", bun_windows_sys::kernel32::PAGE_EXECUTE_READ as u64);
    let _ = write!(out, ",\n\"PAGE_EXECUTE_READWRITE\":\"{}\"", bun_windows_sys::kernel32::PAGE_EXECUTE_READWRITE as u64);
    let _ = write!(out, ",\n\"PAGE_EXECUTE_WRITECOPY\":\"{}\"", bun_windows_sys::kernel32::PAGE_EXECUTE_WRITECOPY as u64);
    let _ = write!(out, ",\n\"PAGE_GUARD\":\"{}\"", bun_windows_sys::kernel32::PAGE_GUARD as u64);
    let _ = write!(out, ",\n\"INFINITE\":\"{}\"", bun_windows_sys::INFINITE as u64);
    let _ = write!(out, ",\n\"WAIT_FAILED\":\"{}\"", bun_windows_sys::WAIT_FAILED as u64);
    let _ = write!(out, ",\n\"STARTF_USESTDHANDLES\":\"{}\"", bun_windows_sys::STARTF_USESTDHANDLES as u64);
    let _ = write!(out, ",\n\"AF_UNSPEC\":\"{}\"", bun_windows_sys::ws2_32::AF_UNSPEC as i64);
    let _ = write!(out, ",\n\"AF_UNIX\":\"{}\"", bun_windows_sys::ws2_32::AF_UNIX as i64);
    let _ = write!(out, ",\n\"AF_INET\":\"{}\"", bun_windows_sys::ws2_32::AF_INET as i64);
    let _ = write!(out, ",\n\"AF_INET6\":\"{}\"", bun_windows_sys::ws2_32::AF_INET6 as i64);
    let _ = write!(out, ",\n\"SOCK_STREAM\":\"{}\"", bun_windows_sys::ws2_32::SOCK_STREAM as i64);
    let _ = write!(out, ",\n\"SOCK_DGRAM\":\"{}\"", bun_windows_sys::ws2_32::SOCK_DGRAM as i64);
    let _ = write!(out, ",\n\"IPPROTO_TCP\":\"{}\"", bun_windows_sys::ws2_32::IPPROTO_TCP as i64);
    let _ = write!(out, ",\n\"IPPROTO_UDP\":\"{}\"", bun_windows_sys::ws2_32::IPPROTO_UDP as i64);
    let _ = write!(out, ",\n\"SOCKET_ERROR\":\"{}\"", bun_windows_sys::ws2_32::SOCKET_ERROR as i64);
    let _ = write!(out, ",\n\"POLLWRNORM\":\"{}\"", bun_windows_sys::ws2_32::POLLWRNORM as i64);
    let _ = write!(out, ",\n\"TOKEN_QUERY\":\"{}\"", bun_windows_sys::TOKEN_QUERY as u64);
    let _ = write!(out, ",\n\"TOKEN_IS_APP_CONTAINER\":\"{}\"", bun_windows_sys::TOKEN_IS_APP_CONTAINER as i64);
    let _ = write!(out, ",\n\"JobObjectAssociateCompletionPortInformation\":\"{}\"", bun_windows_sys::JobObjectAssociateCompletionPortInformation as u64);
    let _ = write!(out, ",\n\"JobObjectExtendedLimitInformation\":\"{}\"", bun_windows_sys::JobObjectExtendedLimitInformation as u64);
    let _ = write!(out, ",\n\"WT_EXECUTEONLYONCE\":\"{}\"", bun_windows_sys::WT_EXECUTEONLYONCE as u64);
    let _ = write!(out, ",\n\"ProcessBasicInformation\":\"{}\"", bun_windows_sys::ProcessBasicInformation as u64);
    let _ = write!(out, ",\n\"CTRL_C_EVENT\":\"{}\"", bun_windows_sys::CTRL_C_EVENT as u64);
    let _ = write!(out, ",\n\"CTRL_BREAK_EVENT\":\"{}\"", bun_windows_sys::CTRL_BREAK_EVENT as u64);
    let _ = write!(out, ",\n\"CTRL_CLOSE_EVENT\":\"{}\"", bun_windows_sys::CTRL_CLOSE_EVENT as u64);
    let _ = write!(out, ",\n\"UV_HANDLE_TYPE_MAX\":\"{}\"", bun_libuv_sys::UV_HANDLE_TYPE_MAX as i64);
    let _ = write!(out, ",\n\"CREAT\":\"{}\"", bun_libuv_sys::O::CREAT as i64);
    let _ = write!(out, ",\n\"RANDOM\":\"{}\"", bun_libuv_sys::O::RANDOM as i64);
    let _ = write!(out, ",\n\"RDONLY\":\"{}\"", bun_libuv_sys::O::RDONLY as i64);
    let _ = write!(out, ",\n\"RDWR\":\"{}\"", bun_libuv_sys::O::RDWR as i64);
    let _ = write!(out, ",\n\"SEQUENTIAL\":\"{}\"", bun_libuv_sys::O::SEQUENTIAL as i64);
    let _ = write!(out, ",\n\"SHORT_LIVED\":\"{}\"", bun_libuv_sys::O::SHORT_LIVED as i64);
    let _ = write!(out, ",\n\"TEMPORARY\":\"{}\"", bun_libuv_sys::O::TEMPORARY as i64);
    let _ = write!(out, ",\n\"TRUNC\":\"{}\"", bun_libuv_sys::O::TRUNC as i64);
    let _ = write!(out, ",\n\"WRONLY\":\"{}\"", bun_libuv_sys::O::WRONLY as i64);
    let _ = write!(out, ",\n\"DIRECTORY\":\"{}\"", bun_libuv_sys::O::DIRECTORY as i64);
    let _ = write!(out, ",\n\"EXLOCK\":\"{}\"", bun_libuv_sys::O::EXLOCK as i64);
    let _ = write!(out, ",\n\"NOATIME\":\"{}\"", bun_libuv_sys::O::NOATIME as i64);
    let _ = write!(out, ",\n\"NOCTTY\":\"{}\"", bun_libuv_sys::O::NOCTTY as i64);
    let _ = write!(out, ",\n\"NONBLOCK\":\"{}\"", bun_libuv_sys::O::NONBLOCK as i64);
    let _ = write!(out, ",\n\"SYMLINK\":\"{}\"", bun_libuv_sys::O::SYMLINK as i64);
    let _ = write!(out, ",\n\"UV__EOF\":\"{}\"", bun_libuv_sys::UV__EOF as i64);
    let _ = write!(out, ",\n\"UV__UNKNOWN\":\"{}\"", bun_libuv_sys::UV__UNKNOWN as i64);
    let _ = write!(out, ",\n\"UV__ECHARSET\":\"{}\"", bun_libuv_sys::UV__ECHARSET as i64);
    let _ = write!(out, ",\n\"UV_E2BIG\":\"{}\"", bun_libuv_sys::UV_E2BIG as i64);
    let _ = write!(out, ",\n\"UV_EACCES\":\"{}\"", bun_libuv_sys::UV_EACCES as i64);
    let _ = write!(out, ",\n\"UV_EADDRINUSE\":\"{}\"", bun_libuv_sys::UV_EADDRINUSE as i64);
    let _ = write!(out, ",\n\"UV_EADDRNOTAVAIL\":\"{}\"", bun_libuv_sys::UV_EADDRNOTAVAIL as i64);
    let _ = write!(out, ",\n\"UV_EAFNOSUPPORT\":\"{}\"", bun_libuv_sys::UV_EAFNOSUPPORT as i64);
    let _ = write!(out, ",\n\"UV_EAGAIN\":\"{}\"", bun_libuv_sys::UV_EAGAIN as i64);
    let _ = write!(out, ",\n\"UV_EAI_ADDRFAMILY\":\"{}\"", bun_libuv_sys::UV_EAI_ADDRFAMILY as i64);
    let _ = write!(out, ",\n\"UV_EAI_AGAIN\":\"{}\"", bun_libuv_sys::UV_EAI_AGAIN as i64);
    let _ = write!(out, ",\n\"UV_EAI_BADFLAGS\":\"{}\"", bun_libuv_sys::UV_EAI_BADFLAGS as i64);
    let _ = write!(out, ",\n\"UV_EAI_BADHINTS\":\"{}\"", bun_libuv_sys::UV_EAI_BADHINTS as i64);
    let _ = write!(out, ",\n\"UV_EAI_CANCELED\":\"{}\"", bun_libuv_sys::UV_EAI_CANCELED as i64);
    let _ = write!(out, ",\n\"UV_EAI_FAIL\":\"{}\"", bun_libuv_sys::UV_EAI_FAIL as i64);
    let _ = write!(out, ",\n\"UV_EAI_FAMILY\":\"{}\"", bun_libuv_sys::UV_EAI_FAMILY as i64);
    let _ = write!(out, ",\n\"UV_EAI_MEMORY\":\"{}\"", bun_libuv_sys::UV_EAI_MEMORY as i64);
    let _ = write!(out, ",\n\"UV_EAI_NODATA\":\"{}\"", bun_libuv_sys::UV_EAI_NODATA as i64);
    let _ = write!(out, ",\n\"UV_EAI_NONAME\":\"{}\"", bun_libuv_sys::UV_EAI_NONAME as i64);
    let _ = write!(out, ",\n\"UV_EAI_OVERFLOW\":\"{}\"", bun_libuv_sys::UV_EAI_OVERFLOW as i64);
    let _ = write!(out, ",\n\"UV_EAI_PROTOCOL\":\"{}\"", bun_libuv_sys::UV_EAI_PROTOCOL as i64);
    let _ = write!(out, ",\n\"UV_EAI_SERVICE\":\"{}\"", bun_libuv_sys::UV_EAI_SERVICE as i64);
    let _ = write!(out, ",\n\"UV_EAI_SOCKTYPE\":\"{}\"", bun_libuv_sys::UV_EAI_SOCKTYPE as i64);
    let _ = write!(out, ",\n\"UV_EALREADY\":\"{}\"", bun_libuv_sys::UV_EALREADY as i64);
    let _ = write!(out, ",\n\"UV_EBADF\":\"{}\"", bun_libuv_sys::UV_EBADF as i64);
    let _ = write!(out, ",\n\"UV_EBUSY\":\"{}\"", bun_libuv_sys::UV_EBUSY as i64);
    let _ = write!(out, ",\n\"UV_ECANCELED\":\"{}\"", bun_libuv_sys::UV_ECANCELED as i64);
    let _ = write!(out, ",\n\"UV_ECHARSET\":\"{}\"", bun_libuv_sys::UV_ECHARSET as i64);
    let _ = write!(out, ",\n\"UV_ECONNABORTED\":\"{}\"", bun_libuv_sys::UV_ECONNABORTED as i64);
    let _ = write!(out, ",\n\"UV_ECONNREFUSED\":\"{}\"", bun_libuv_sys::UV_ECONNREFUSED as i64);
    let _ = write!(out, ",\n\"UV_ECONNRESET\":\"{}\"", bun_libuv_sys::UV_ECONNRESET as i64);
    let _ = write!(out, ",\n\"UV_EDESTADDRREQ\":\"{}\"", bun_libuv_sys::UV_EDESTADDRREQ as i64);
    let _ = write!(out, ",\n\"UV_EEXIST\":\"{}\"", bun_libuv_sys::UV_EEXIST as i64);
    let _ = write!(out, ",\n\"UV_EFAULT\":\"{}\"", bun_libuv_sys::UV_EFAULT as i64);
    let _ = write!(out, ",\n\"UV_EFBIG\":\"{}\"", bun_libuv_sys::UV_EFBIG as i64);
    let _ = write!(out, ",\n\"UV_EHOSTUNREACH\":\"{}\"", bun_libuv_sys::UV_EHOSTUNREACH as i64);
    let _ = write!(out, ",\n\"UV_EINTR\":\"{}\"", bun_libuv_sys::UV_EINTR as i64);
    let _ = write!(out, ",\n\"UV_EINVAL\":\"{}\"", bun_libuv_sys::UV_EINVAL as i64);
    let _ = write!(out, ",\n\"UV_EIO\":\"{}\"", bun_libuv_sys::UV_EIO as i64);
    let _ = write!(out, ",\n\"UV_EISCONN\":\"{}\"", bun_libuv_sys::UV_EISCONN as i64);
    let _ = write!(out, ",\n\"UV_EISDIR\":\"{}\"", bun_libuv_sys::UV_EISDIR as i64);
    let _ = write!(out, ",\n\"UV_ELOOP\":\"{}\"", bun_libuv_sys::UV_ELOOP as i64);
    let _ = write!(out, ",\n\"UV_EMFILE\":\"{}\"", bun_libuv_sys::UV_EMFILE as i64);
    let _ = write!(out, ",\n\"UV_EMSGSIZE\":\"{}\"", bun_libuv_sys::UV_EMSGSIZE as i64);
    let _ = write!(out, ",\n\"UV_ENAMETOOLONG\":\"{}\"", bun_libuv_sys::UV_ENAMETOOLONG as i64);
    let _ = write!(out, ",\n\"UV_ENETDOWN\":\"{}\"", bun_libuv_sys::UV_ENETDOWN as i64);
    let _ = write!(out, ",\n\"UV_ENETUNREACH\":\"{}\"", bun_libuv_sys::UV_ENETUNREACH as i64);
    let _ = write!(out, ",\n\"UV_ENFILE\":\"{}\"", bun_libuv_sys::UV_ENFILE as i64);
    let _ = write!(out, ",\n\"UV_ENOBUFS\":\"{}\"", bun_libuv_sys::UV_ENOBUFS as i64);
    let _ = write!(out, ",\n\"UV_ENODEV\":\"{}\"", bun_libuv_sys::UV_ENODEV as i64);
    let _ = write!(out, ",\n\"UV_ENOENT\":\"{}\"", bun_libuv_sys::UV_ENOENT as i64);
    let _ = write!(out, ",\n\"UV_ENOMEM\":\"{}\"", bun_libuv_sys::UV_ENOMEM as i64);
    let _ = write!(out, ",\n\"UV_ENONET\":\"{}\"", bun_libuv_sys::UV_ENONET as i64);
    let _ = write!(out, ",\n\"UV_ENOPROTOOPT\":\"{}\"", bun_libuv_sys::UV_ENOPROTOOPT as i64);
    let _ = write!(out, ",\n\"UV_ENOSPC\":\"{}\"", bun_libuv_sys::UV_ENOSPC as i64);
    let _ = write!(out, ",\n\"UV_ENOSYS\":\"{}\"", bun_libuv_sys::UV_ENOSYS as i64);
    let _ = write!(out, ",\n\"UV_ENOTCONN\":\"{}\"", bun_libuv_sys::UV_ENOTCONN as i64);
    let _ = write!(out, ",\n\"UV_ENOTDIR\":\"{}\"", bun_libuv_sys::UV_ENOTDIR as i64);
    let _ = write!(out, ",\n\"UV_ENOTEMPTY\":\"{}\"", bun_libuv_sys::UV_ENOTEMPTY as i64);
    let _ = write!(out, ",\n\"UV_ENOTSOCK\":\"{}\"", bun_libuv_sys::UV_ENOTSOCK as i64);
    let _ = write!(out, ",\n\"UV_ENOTSUP\":\"{}\"", bun_libuv_sys::UV_ENOTSUP as i64);
    let _ = write!(out, ",\n\"UV_EOVERFLOW\":\"{}\"", bun_libuv_sys::UV_EOVERFLOW as i64);
    let _ = write!(out, ",\n\"UV_EPERM\":\"{}\"", bun_libuv_sys::UV_EPERM as i64);
    let _ = write!(out, ",\n\"UV_EPIPE\":\"{}\"", bun_libuv_sys::UV_EPIPE as i64);
    let _ = write!(out, ",\n\"UV_EPROTO\":\"{}\"", bun_libuv_sys::UV_EPROTO as i64);
    let _ = write!(out, ",\n\"UV_EPROTONOSUPPORT\":\"{}\"", bun_libuv_sys::UV_EPROTONOSUPPORT as i64);
    let _ = write!(out, ",\n\"UV_EPROTOTYPE\":\"{}\"", bun_libuv_sys::UV_EPROTOTYPE as i64);
    let _ = write!(out, ",\n\"UV_ERANGE\":\"{}\"", bun_libuv_sys::UV_ERANGE as i64);
    let _ = write!(out, ",\n\"UV_EROFS\":\"{}\"", bun_libuv_sys::UV_EROFS as i64);
    let _ = write!(out, ",\n\"UV_ESHUTDOWN\":\"{}\"", bun_libuv_sys::UV_ESHUTDOWN as i64);
    let _ = write!(out, ",\n\"UV_ESPIPE\":\"{}\"", bun_libuv_sys::UV_ESPIPE as i64);
    let _ = write!(out, ",\n\"UV_ESRCH\":\"{}\"", bun_libuv_sys::UV_ESRCH as i64);
    let _ = write!(out, ",\n\"UV_ETIMEDOUT\":\"{}\"", bun_libuv_sys::UV_ETIMEDOUT as i64);
    let _ = write!(out, ",\n\"UV_ETXTBSY\":\"{}\"", bun_libuv_sys::UV_ETXTBSY as i64);
    let _ = write!(out, ",\n\"UV_EXDEV\":\"{}\"", bun_libuv_sys::UV_EXDEV as i64);
    let _ = write!(out, ",\n\"UV_UNKNOWN\":\"{}\"", bun_libuv_sys::UV_UNKNOWN as i64);
    let _ = write!(out, ",\n\"UV_EOF\":\"{}\"", bun_libuv_sys::UV_EOF as i64);
    let _ = write!(out, ",\n\"UV_ENXIO\":\"{}\"", bun_libuv_sys::UV_ENXIO as i64);
    let _ = write!(out, ",\n\"UV_EMLINK\":\"{}\"", bun_libuv_sys::UV_EMLINK as i64);
    let _ = write!(out, ",\n\"UV_EHOSTDOWN\":\"{}\"", bun_libuv_sys::UV_EHOSTDOWN as i64);
    let _ = write!(out, ",\n\"UV_EREMOTEIO\":\"{}\"", bun_libuv_sys::UV_EREMOTEIO as i64);
    let _ = write!(out, ",\n\"UV_ENOTTY\":\"{}\"", bun_libuv_sys::UV_ENOTTY as i64);
    let _ = write!(out, ",\n\"UV_EFTYPE\":\"{}\"", bun_libuv_sys::UV_EFTYPE as i64);
    let _ = write!(out, ",\n\"UV_EILSEQ\":\"{}\"", bun_libuv_sys::UV_EILSEQ as i64);
    let _ = write!(out, ",\n\"UV_ESOCKTNOSUPPORT\":\"{}\"", bun_libuv_sys::UV_ESOCKTNOSUPPORT as i64);
    let _ = write!(out, ",\n\"UV_ENODATA\":\"{}\"", bun_libuv_sys::UV_ENODATA as i64);
    let _ = write!(out, ",\n\"UV_EUNATCH\":\"{}\"", bun_libuv_sys::UV_EUNATCH as i64);
    let _ = write!(out, ",\n\"UV_ENOEXEC\":\"{}\"", bun_libuv_sys::UV_ENOEXEC as i64);
    let _ = write!(out, ",\n\"UV_ERRNO_MAX\":\"{}\"", bun_libuv_sys::UV_ERRNO_MAX as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_UNKNOWN\":\"{}\"", bun_libuv_sys::UV_DIRENT_UNKNOWN as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_FILE\":\"{}\"", bun_libuv_sys::UV_DIRENT_FILE as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_DIR\":\"{}\"", bun_libuv_sys::UV_DIRENT_DIR as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_LINK\":\"{}\"", bun_libuv_sys::UV_DIRENT_LINK as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_FIFO\":\"{}\"", bun_libuv_sys::UV_DIRENT_FIFO as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_SOCKET\":\"{}\"", bun_libuv_sys::UV_DIRENT_SOCKET as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_CHAR\":\"{}\"", bun_libuv_sys::UV_DIRENT_CHAR as i64);
    let _ = write!(out, ",\n\"UV_DIRENT_BLOCK\":\"{}\"", bun_libuv_sys::UV_DIRENT_BLOCK as i64);
    let _ = write!(out, ",\n\"UV_READABLE\":\"{}\"", bun_libuv_sys::UV_READABLE as i64);
    let _ = write!(out, ",\n\"UV_WRITABLE\":\"{}\"", bun_libuv_sys::UV_WRITABLE as i64);
    let _ = write!(out, ",\n\"UV_DISCONNECT\":\"{}\"", bun_libuv_sys::UV_DISCONNECT as i64);
    let _ = write!(out, ",\n\"UV_PRIORITIZED\":\"{}\"", bun_libuv_sys::UV_PRIORITIZED as i64);
    let _ = write!(out, ",\n\"UV_FS_SYMLINK_DIR\":\"{}\"", bun_libuv_sys::UV_FS_SYMLINK_DIR as i64);
    let _ = write!(out, ",\n\"UV_FS_SYMLINK_JUNCTION\":\"{}\"", bun_libuv_sys::UV_FS_SYMLINK_JUNCTION as i64);
    let _ = write!(out, ",\n\"UV_RENAME\":\"{}\"", bun_libuv_sys::UV_RENAME as i64);
    let _ = write!(out, ",\n\"UV_CHANGE\":\"{}\"", bun_libuv_sys::UV_CHANGE as i64);
    let _ = write!(out, ",\n\"UV_FS_EVENT_WATCH_ENTRY\":\"{}\"", bun_libuv_sys::UV_FS_EVENT_WATCH_ENTRY as i64);
    let _ = write!(out, ",\n\"UV_FS_EVENT_STAT\":\"{}\"", bun_libuv_sys::UV_FS_EVENT_STAT as i64);
    let _ = write!(out, ",\n\"UV_FS_EVENT_RECURSIVE\":\"{}\"", bun_libuv_sys::UV_FS_EVENT_RECURSIVE as i64);
    let _ = write!(out, ",\n\"UV_IGNORE\":\"{}\"", bun_libuv_sys::UV_IGNORE as u64);
    let _ = write!(out, ",\n\"UV_CREATE_PIPE\":\"{}\"", bun_libuv_sys::UV_CREATE_PIPE as u64);
    let _ = write!(out, ",\n\"UV_INHERIT_FD\":\"{}\"", bun_libuv_sys::UV_INHERIT_FD as u64);
    let _ = write!(out, ",\n\"UV_INHERIT_STREAM\":\"{}\"", bun_libuv_sys::UV_INHERIT_STREAM as u64);
    let _ = write!(out, ",\n\"UV_READABLE_PIPE\":\"{}\"", bun_libuv_sys::UV_READABLE_PIPE as u64);
    let _ = write!(out, ",\n\"UV_WRITABLE_PIPE\":\"{}\"", bun_libuv_sys::UV_WRITABLE_PIPE as u64);
    let _ = write!(out, ",\n\"UV_NONBLOCK_PIPE\":\"{}\"", bun_libuv_sys::UV_NONBLOCK_PIPE as u64);
    let _ = write!(out, ",\n\"UV_OVERLAPPED_PIPE\":\"{}\"", bun_libuv_sys::UV_OVERLAPPED_PIPE as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_SETUID\":\"{}\"", bun_libuv_sys::UV_PROCESS_SETUID as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_SETGID\":\"{}\"", bun_libuv_sys::UV_PROCESS_SETGID as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS\":\"{}\"", bun_libuv_sys::UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_DETACHED\":\"{}\"", bun_libuv_sys::UV_PROCESS_DETACHED as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_WINDOWS_HIDE\":\"{}\"", bun_libuv_sys::UV_PROCESS_WINDOWS_HIDE as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_WINDOWS_HIDE_CONSOLE\":\"{}\"", bun_libuv_sys::UV_PROCESS_WINDOWS_HIDE_CONSOLE as u64);
    let _ = write!(out, ",\n\"UV_PROCESS_WINDOWS_HIDE_GUI\":\"{}\"", bun_libuv_sys::UV_PROCESS_WINDOWS_HIDE_GUI as u64);
    let _ = write!(out, ",\n\"SIGHUP\":\"{}\"", bun_libuv_sys::SIGHUP as i64);
    let _ = write!(out, ",\n\"SIGQUIT\":\"{}\"", bun_libuv_sys::SIGQUIT as i64);
    let _ = write!(out, ",\n\"SIGKILL\":\"{}\"", bun_libuv_sys::SIGKILL as i64);
    let _ = write!(out, ",\n\"SIGWINCH\":\"{}\"", bun_libuv_sys::SIGWINCH as i64);
    let _ = write!(out, ",\n\"ENABLE_VIRTUAL_TERMINAL_PROCESSING\":\"{}\"", bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_PROCESSING as u64);
    let _ = write!(out, ",\n\"MOVEFILE_COPY_ALLOWED\":\"{}\"", bun_sys::windows::MOVEFILE_COPY_ALLOWED as u64);
    let _ = write!(out, ",\n\"MOVEFILE_REPLACE_EXISTING\":\"{}\"", bun_sys::windows::MOVEFILE_REPLACE_EXISTING as u64);
    let _ = write!(out, ",\n\"MOVEFILE_WRITE_THROUGH\":\"{}\"", bun_sys::windows::MOVEFILE_WRITE_THROUGH as u64);
    let _ = write!(out, ",\n\"INVALID_FILE_ATTRIBUTES\":\"{}\"", bun_sys::windows::INVALID_FILE_ATTRIBUTES as u64);
    let _ = write!(out, ",\n\"S_OK\":\"{}\"", bun_sys::windows::S_OK as i64);
    let _ = write!(out, ",\n\"FILE_LIST_DIRECTORY\":\"{}\"", bun_sys::windows::FILE_LIST_DIRECTORY as u64);
    let _ = write!(out, ",\n\"FILE_OPEN_FOR_BACKUP_INTENT\":\"{}\"", bun_sys::windows::FILE_OPEN_FOR_BACKUP_INTENT as u64);
    let _ = write!(out, ",\n\"FILE_ACTION_ADDED\":\"{}\"", bun_sys::windows::FILE_ACTION_ADDED as u64);
    let _ = write!(out, ",\n\"FILE_ACTION_REMOVED\":\"{}\"", bun_sys::windows::FILE_ACTION_REMOVED as u64);
    let _ = write!(out, ",\n\"FILE_ACTION_MODIFIED\":\"{}\"", bun_sys::windows::FILE_ACTION_MODIFIED as u64);
    let _ = write!(out, ",\n\"FILE_ACTION_RENAMED_OLD_NAME\":\"{}\"", bun_sys::windows::FILE_ACTION_RENAMED_OLD_NAME as u64);
    let _ = write!(out, ",\n\"FILE_ACTION_RENAMED_NEW_NAME\":\"{}\"", bun_sys::windows::FILE_ACTION_RENAMED_NEW_NAME as u64);
    let _ = write!(out, ",\n\"FILE_TYPE_CHAR\":\"{}\"", bun_sys::windows::FILE_TYPE_CHAR as u64);
    let _ = write!(out, ",\n\"FILE_TYPE_PIPE\":\"{}\"", bun_sys::windows::FILE_TYPE_PIPE as u64);
    let _ = write!(out, ",\n\"PROCESS_QUERY_LIMITED_INFORMATION\":\"{}\"", bun_sys::windows::PROCESS_QUERY_LIMITED_INFORMATION as u64);
    let _ = write!(out, ",\n\"ENABLE_ECHO_INPUT\":\"{}\"", bun_sys::windows::ENABLE_ECHO_INPUT as u64);
    let _ = write!(out, ",\n\"ENABLE_LINE_INPUT\":\"{}\"", bun_sys::windows::ENABLE_LINE_INPUT as u64);
    let _ = write!(out, ",\n\"ENABLE_PROCESSED_INPUT\":\"{}\"", bun_sys::windows::ENABLE_PROCESSED_INPUT as u64);
    let _ = write!(out, ",\n\"ENABLE_VIRTUAL_TERMINAL_INPUT\":\"{}\"", bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT as u64);
    let _ = write!(out, ",\n\"ENABLE_WRAP_AT_EOL_OUTPUT\":\"{}\"", bun_sys::windows::ENABLE_WRAP_AT_EOL_OUTPUT as u64);
    let _ = write!(out, ",\n\"ENABLE_PROCESSED_OUTPUT\":\"{}\"", bun_sys::windows::ENABLE_PROCESSED_OUTPUT as u64);
    let _ = write!(out, ",\n\"EXCEPTION_CONTINUE_EXECUTION\":\"{}\"", bun_sys::windows::EXCEPTION_CONTINUE_EXECUTION as i64);
    let _ = write!(out, ",\n\"EXCEPTION_CONTINUE_SEARCH\":\"{}\"", bun_sys::windows::EXCEPTION_CONTINUE_SEARCH as i64);
    let _ = write!(out, ",\n\"MS_VC_EXCEPTION\":\"{}\"", bun_sys::windows::MS_VC_EXCEPTION as u64);
    let _ = write!(out, ",\n\"ExceptionContinueExecution\":\"{}\"", bun_sys::windows::disposition::ExceptionContinueExecution as i64);
    let _ = write!(out, ",\n\"ExceptionContinueSearch\":\"{}\"", bun_sys::windows::disposition::ExceptionContinueSearch as i64);
    let _ = write!(out, ",\n\"EXCEPTION_UNWIND\":\"{}\"", bun_sys::windows::EXCEPTION_UNWIND as u64);
    let _ = write!(out, ",\n\"EXCEPTION_ACCESS_VIOLATION\":\"{}\"", bun_sys::windows::EXCEPTION_ACCESS_VIOLATION as u64);
    let _ = write!(out, ",\n\"EXCEPTION_DATATYPE_MISALIGNMENT\":\"{}\"", bun_sys::windows::EXCEPTION_DATATYPE_MISALIGNMENT as u64);
    let _ = write!(out, ",\n\"EXCEPTION_ILLEGAL_INSTRUCTION\":\"{}\"", bun_sys::windows::EXCEPTION_ILLEGAL_INSTRUCTION as u64);
    let _ = write!(out, ",\n\"EXCEPTION_STACK_OVERFLOW\":\"{}\"", bun_sys::windows::EXCEPTION_STACK_OVERFLOW as u64);
    let _ = write!(out, ",\n\"STATUS_CONTROL_C_EXIT\":\"{}\"", bun_sys::windows::STATUS_CONTROL_C_EXIT as u64);
    let _ = write!(out, ",\n\"JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE\":\"{}\"", bun_sys::windows::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE as u64);
    let _ = write!(out, ",\n\"JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE\":\"{}\"", bun_sys::windows::JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE as u64);
    report.raw(&out);
}
