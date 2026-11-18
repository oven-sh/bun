use std::ffi::{CStr, c_char, c_void};
use std::sync::OnceLock;

use super::com::{Borrowed, Guid, Status, Unknown, Variant};
use super::*;

pub type Start = unsafe extern "system" fn(*mut c_void) -> u32;
pub type Waited = unsafe extern "system" fn(*mut c_void, u8);
pub type EachMonitor = unsafe extern "system" fn(Handle, Handle, *mut DeviceRect, isize) -> Bool;

#[link(name = "kernel32", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn ActivateActCtx(context: Handle, cookie: &mut usize) -> Bool;
    pub safe fn CancelWaitableTimer(timer: Handle) -> Bool;
    pub safe fn CloseHandle(object: Handle) -> Bool;
    pub safe fn CreateActCtxW(context: &ActCtxW) -> Handle;
    pub safe fn CreateEventW(security: usize, is_manual: Bool, is_set: Bool, name: Str) -> Handle;
    pub safe fn CreateFileMappingW(
        file: Handle,
        security: usize,
        protection: u32,
        high: u32,
        low: u32,
        name: Str,
    ) -> Handle;
    pub safe fn CreatePipe(
        reads: &mut Handle,
        writes: &mut Handle,
        security: usize,
        size: u32,
    ) -> Bool;
    pub fn CreateThread(
        security: usize,
        stack: usize,
        start: Start,
        context: *mut c_void,
        flags: u32,
        id: Option<&mut u32>,
    ) -> Handle;
    pub safe fn CreateWaitableTimerExW(
        security: usize,
        name: Str,
        flags: u32,
        access: u32,
    ) -> Handle;
    pub safe fn GetCurrentProcess() -> Handle;
    pub safe fn GetCurrentThread() -> Handle;
    pub safe fn GetProcessTimes(
        process: Handle,
        created: &mut u64,
        ended: &mut u64,
        kernel: &mut u64,
        user: &mut u64,
    ) -> Bool;
    pub safe fn GetTickCount64() -> u64;
    pub safe fn GetPhysicallyInstalledSystemMemory(kilobytes: &mut u64) -> Bool;
    pub safe fn GetModuleHandleW(name: Str) -> Handle;
    fn GetProcAddress(module: Handle, name: *const c_char) -> *mut c_void;
    pub fn GetQueuedCompletionStatusEx(
        port: Handle,
        entries: *mut OverlappedEntry,
        count: u32,
        removed: &mut u32,
        milliseconds: u32,
        is_alertable: Bool,
    ) -> Bool;
    pub fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    pub safe fn GetSystemPowerStatus(status: &mut SystemPowerStatus) -> Bool;
    pub safe fn GetTickCount() -> u32;
    pub fn GetUserDefaultLocaleName(buffer: *mut u16, size: i32) -> i32;
    pub safe fn LocaleNameToLCID(name: Str, flags: u32) -> u32;
    pub safe fn GlobalAlloc(flags: u32, size: usize) -> Handle;
    pub fn GlobalFree(memory: Handle) -> Handle;
    pub fn GlobalLock(memory: Handle) -> *mut c_void;
    pub fn GlobalSize(memory: Handle) -> usize;
    pub fn GlobalUnlock(memory: Handle) -> Bool;
    safe fn LoadLibraryExW(name: Str, file: Handle, flags: u32) -> Handle;
    pub safe fn MapViewOfFile(
        mapping: Handle,
        access: u32,
        high: u32,
        low: u32,
        size: usize,
    ) -> *mut c_void;
    pub fn UnmapViewOfFile(start: *mut c_void) -> Bool;
    pub fn PostQueuedCompletionStatus(
        port: Handle,
        bytes: u32,
        key: usize,
        overlapped: *mut c_void,
    ) -> Bool;
    pub safe fn PowerCreateRequest(reason: &ReasonContext) -> Handle;
    pub safe fn PowerSetRequest(request: Handle, kind: i32) -> Bool;
    pub safe fn QueryPerformanceCounter(ticks: &mut i64) -> Bool;
    pub safe fn QueryPerformanceFrequency(ticks: &mut i64) -> Bool;
    pub fn RegisterWaitForSingleObject(
        wait: &mut Handle,
        object: Handle,
        callback: Waited,
        context: *mut c_void,
        milliseconds: u32,
        flags: u32,
    ) -> Bool;
    fn ResolveDelayLoadedAPI(
        module: Handle,
        library: *const c_void,
        failed: usize,
        otherwise: usize,
        slot: *mut c_void,
        flags: u32,
    ) -> *mut c_void;
    pub safe fn SetEvent(event: Handle) -> Bool;
    pub safe fn SetThreadDescription(thread: Handle, name: Str) -> Status;
    pub safe fn SetThreadPriority(thread: Handle, priority: i32) -> Bool;
    pub safe fn SetWaitableTimer(
        timer: Handle,
        due: &i64,
        period: i32,
        callback: usize,
        context: usize,
        resumes: Bool,
    ) -> Bool;
    pub fn VirtualAlloc(at: *mut c_void, size: usize, how: u32, protection: u32) -> *mut c_void;
    pub fn VirtualFree(at: *mut c_void, size: usize, how: u32) -> Bool;
    pub safe fn WaitForSingleObject(object: Handle, milliseconds: u32) -> u32;
}

#[link(name = "user32", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn AdjustWindowRectExForDpi(
        rect: &mut DeviceRect,
        style: u32,
        has_menu: Bool,
        extended: u32,
        dpi: u32,
    ) -> Bool;
    pub safe fn BeginPaint(window: Handle, paint: &mut PaintStruct) -> Handle;
    pub safe fn ChangeWindowMessageFilterEx(
        window: Handle,
        message: u32,
        action: u32,
        filter: usize,
    ) -> Bool;
    pub safe fn ClientToScreen(window: Handle, point: &mut DevicePoint) -> Bool;
    pub safe fn CloseClipboard() -> Bool;
    pub safe fn CreateCaret(window: Handle, bitmap: Handle, width: i32, height: i32) -> Bool;
    pub safe fn CreateIconIndirect(icon: &IconInfo) -> Handle;
    pub safe fn CreatePopupMenu() -> Handle;
    pub safe fn CreateWindowExW(
        extended: u32,
        class: Str,
        title: Str,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Handle,
        menu: Handle,
        module: Handle,
        context: usize,
    ) -> Handle;
    pub fn DefWindowProcW(window: Handle, message: u32, w: usize, l: isize) -> isize;
    pub safe fn DestroyCaret() -> Bool;
    pub safe fn DestroyIcon(icon: Handle) -> Bool;
    pub safe fn DestroyMenu(menu: Handle) -> Bool;
    pub safe fn DestroyWindow(window: Handle) -> Bool;
    pub fn DispatchMessageW(message: &Msg) -> isize;
    pub safe fn EmptyClipboard() -> Bool;
    pub safe fn EnableMenuItem(menu: Handle, item: u32, state: u32) -> Bool;
    pub safe fn EnableWindow(window: Handle, is_enabled: Bool) -> Bool;
    pub safe fn EndMenu() -> Bool;
    pub safe fn EndPaint(window: Handle, paint: &PaintStruct) -> Bool;
    pub fn EnumDisplayMonitors(
        device: Handle,
        clip: Option<&DeviceRect>,
        each: EachMonitor,
        context: isize,
    ) -> Bool;
    pub fn EnumDisplaySettingsW(device: *const u16, mode: u32, settings: &mut DevModeW) -> Bool;
    pub safe fn FlashWindowEx(how: &FlashWInfo) -> Bool;
    pub safe fn GetCapture() -> Handle;
    pub safe fn GetClientRect(window: Handle, rect: &mut DeviceRect) -> Bool;
    pub safe fn GetClipboardData(format: u32) -> Handle;
    pub safe fn GetCursorPos(point: &mut DevicePoint) -> Bool;
    pub safe fn GetDC(window: Handle) -> Handle;
    pub safe fn GetDoubleClickTime() -> u32;
    pub safe fn GetDpiForWindow(window: Handle) -> u32;
    pub safe fn GetKeyState(key: u32) -> i16;
    pub safe fn GetKeyboardLayout(thread: u32) -> Handle;
    pub safe fn GetKeyboardState(state: &mut [u8; 256]) -> Bool;
    pub safe fn GetLastInputInfo(info: &mut LastInputInfo) -> Bool;
    pub safe fn GetPointerType(pointer: u32, kind: &mut u32) -> Bool;
    pub safe fn GetPointerTouchInfo(pointer: u32, info: &mut PointerTouchInfo) -> Bool;
    pub safe fn GetPointerPenInfo(pointer: u32, info: &mut PointerPenInfo) -> Bool;
    pub safe fn GetCurrentInputMessageSource(source: &mut InputMessageSource) -> Bool;
    pub safe fn GetCaretBlinkTime() -> u32;
    pub safe fn GetSysColor(index: i32) -> u32;
    pub safe fn GetForegroundWindow() -> Handle;
    pub fn QueryDisplayConfig(
        flags: u32,
        count: &mut u32,
        paths: *mut DisplayConfigPathInfo,
        count_of_modes: &mut u32,
        modes: *mut c_void,
        topology: usize,
    ) -> i32;
    pub fn DisplayConfigGetDeviceInfo(request: *mut c_void) -> i32;
    pub safe fn GetMessageTime() -> i32;
    pub safe fn GetMonitorInfoW(monitor: Handle, info: &mut MonitorInfoExW) -> Bool;
    pub safe fn GetSystemMenu(window: Handle, reverts: Bool) -> Handle;
    pub safe fn GetSystemMetricsForDpi(index: i32, dpi: u32) -> i32;
    pub safe fn GetWindow(window: Handle, which: u32) -> Handle;
    pub safe fn GetWindowLongPtrW(window: Handle, index: i32) -> isize;
    pub safe fn GetWindowPlacement(window: Handle, placement: &mut WindowPlacement) -> Bool;
    pub safe fn GetWindowRect(window: Handle, rect: &mut DeviceRect) -> Bool;
    pub safe fn InsertMenuItemW(
        menu: Handle,
        position: u32,
        is_position: Bool,
        item: &MenuItemInfoW,
    ) -> Bool;
    pub safe fn IsIconic(window: Handle) -> Bool;
    pub safe fn IsWindowVisible(window: Handle) -> Bool;
    pub safe fn IsZoomed(window: Handle) -> Bool;
    pub safe fn LoadCursorW(module: Handle, name: Str) -> Handle;
    pub safe fn LoadIconW(module: Handle, name: Str) -> Handle;
    pub safe fn MapVirtualKeyExW(code: u32, how: u32, layout: Handle) -> u32;
    pub safe fn KillTimer(window: Handle, id: usize) -> Bool;
    pub safe fn MessageBeep(kind: u32) -> Bool;
    pub safe fn MonitorFromRect(rect: &DeviceRect, otherwise: u32) -> Handle;
    pub safe fn MonitorFromWindow(window: Handle, otherwise: u32) -> Handle;
    pub safe fn OpenClipboard(owner: Handle) -> Bool;
    pub safe fn PeekMessageW(
        message: &mut Msg,
        window: Handle,
        first: u32,
        last: u32,
        how: u32,
    ) -> Bool;
    pub safe fn PostMessageW(window: Handle, message: u32, w: usize, l: isize) -> Bool;
    pub safe fn RegisterClassExW(class: &WndClassExW) -> u16;
    pub safe fn RegisterClipboardFormatW(name: Str) -> u32;
    pub safe fn RegisterHotKey(window: Handle, id: i32, modifiers: u32, key: u32) -> Bool;
    pub safe fn RegisterWindowMessageW(name: Str) -> u32;
    pub safe fn ReleaseCapture() -> Bool;
    pub safe fn ReleaseDC(window: Handle, device: Handle) -> i32;
    pub safe fn ScreenToClient(window: Handle, point: &mut DevicePoint) -> Bool;
    pub fn SendInput(count: u32, inputs: *const SentInput, size: i32) -> u32;
    pub fn SendMessageW(window: Handle, message: u32, w: usize, l: isize) -> isize;
    pub safe fn SetCapture(window: Handle) -> Handle;
    pub safe fn SetCaretPos(x: i32, y: i32) -> Bool;
    pub fn SetClipboardData(format: u32, memory: Handle) -> Handle;
    pub safe fn SetCursor(cursor: Handle) -> Handle;
    pub safe fn SetForegroundWindow(window: Handle) -> Bool;
    pub safe fn SetLayeredWindowAttributes(window: Handle, key: u32, alpha: u8, flags: u32)
    -> Bool;
    pub safe fn SetThreadDpiAwarenessContext(context: Handle) -> Handle;
    pub safe fn SetWindowDisplayAffinity(window: Handle, affinity: u32) -> Bool;
    pub fn SetWindowLongPtrW(window: Handle, index: i32, value: isize) -> isize;
    pub safe fn SetWindowPlacement(window: Handle, placement: &WindowPlacement) -> Bool;
    pub safe fn SetTimer(window: Handle, id: usize, milliseconds: u32, no_callback: usize)
    -> usize;
    pub safe fn SetWindowPos(
        window: Handle,
        after: Handle,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> Bool;
    pub safe fn SetWindowRgn(window: Handle, region: Handle, redraws: Bool) -> i32;
    pub safe fn SetWindowTextW(window: Handle, text: Str) -> Bool;
    pub safe fn ShowWindow(window: Handle, how: i32) -> Bool;
    pub fn SystemParametersInfoW(which: u32, number: u32, value: *mut c_void, flags: u32) -> Bool;
    pub fn ToUnicodeEx(
        key: u32,
        code: u32,
        state: &[u8; 256],
        buffer: *mut u16,
        size: i32,
        flags: u32,
        layout: Handle,
    ) -> i32;
    pub safe fn TrackMouseEvent(how: &mut MouseTracking) -> Bool;
    pub safe fn TrackPopupMenuEx(
        menu: Handle,
        flags: u32,
        x: i32,
        y: i32,
        window: Handle,
        parameters: usize,
    ) -> Bool;
    pub safe fn TranslateMessage(message: &Msg) -> Bool;
    pub safe fn UnregisterHotKey(window: Handle, id: i32) -> Bool;
    pub safe fn UpdateWindow(window: Handle) -> Bool;
    pub safe fn VkKeyScanExW(character: u16, layout: Handle) -> i16;
    pub safe fn WaitMessage() -> Bool;
}

#[link(name = "gdi32", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn BitBlt(
        to: Handle,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        from: Handle,
        from_x: i32,
        from_y: i32,
        how: u32,
    ) -> Bool;
    pub safe fn CombineRgn(to: Handle, a: Handle, b: Handle, how: i32) -> i32;
    pub fn CreateBitmap(
        width: i32,
        height: i32,
        planes: u32,
        bits: u32,
        data: *const c_void,
    ) -> Handle;
    pub safe fn CreateCompatibleDC(device: Handle) -> Handle;
    pub safe fn CreateDIBSection(
        device: Handle,
        header: &BitmapInfoHeader,
        usage: u32,
        bits: &mut *mut c_void,
        section: Handle,
        offset: u32,
    ) -> Handle;
    pub safe fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> Handle;
    pub safe fn DeleteDC(device: Handle) -> Bool;
    pub fn DeleteObject(object: Handle) -> Bool;
    pub safe fn GdiFlush() -> Bool;
    pub fn GetDIBits(
        device: Handle,
        bitmap: Handle,
        first: u32,
        rows: u32,
        bits: *mut c_void,
        header: &mut BitmapInfoHeader,
        usage: u32,
    ) -> i32;
    pub safe fn PatBlt(to: Handle, x: i32, y: i32, width: i32, height: i32, how: u32) -> Bool;
    pub safe fn SelectObject(device: Handle, object: Handle) -> Handle;
}

#[link(name = "advapi32", kind = "raw-dylib")]
unsafe extern "system" {
    pub fn RegGetValueW(
        key: Handle,
        path: Str,
        name: Str,
        flags: u32,
        kind: Option<&mut u32>,
        value: *mut c_void,
        size: &mut u32,
    ) -> i32;
    pub fn RegSetKeyValueW(
        key: Handle,
        path: Str,
        name: Str,
        kind: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

#[link(name = "ole32", kind = "raw-dylib")]
unsafe extern "system" {
    pub fn CoCreateInstance(
        class: &Guid,
        outer: Borrowed,
        context: u32,
        id: &Guid,
        object: *mut c_void,
    ) -> Status;
    pub safe fn CoInitializeEx(reserved: usize, model: u32) -> Status;
    pub safe fn CoTaskMemAlloc(size: usize) -> *mut c_void;
    pub safe fn PropVariantClear(value: &mut Variant) -> Status;
    pub fn CoTaskMemFree(memory: *mut c_void);
    pub safe fn CoUninitialize();
    pub safe fn DoDragDrop(
        data: Borrowed,
        source: Borrowed,
        allowed: u32,
        effect: &mut u32,
    ) -> Status;
    pub safe fn OleInitialize(reserved: usize) -> Status;
    pub safe fn RegisterDragDrop(window: Handle, target: Borrowed) -> Status;
    pub fn ReleaseStgMedium(medium: &mut StgMedium);
    pub safe fn RevokeDragDrop(window: Handle) -> Status;
}

#[link(name = "oleaut32", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn SafeArrayCreateVector(kind: u16, first: i32, count: u32) -> Handle;
    pub fn SafeArrayPutElement(array: Handle, index: &i32, value: *const c_void) -> Status;
    pub fn SysAllocStringLen(units: *const u16, length: u32) -> *mut u16;
    pub fn SysFreeString(string: *mut u16);
    pub fn SysStringLen(string: *mut u16) -> u32;
}

#[link(name = "combase", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn RoActivateInstance(class: Handle, object: &mut Option<Unknown>) -> Status;
    pub fn RoGetActivationFactory(class: Handle, id: &Guid, factory: *mut c_void) -> Status;
    pub fn WindowsCreateString(units: *const u16, length: u32, string: &mut Handle) -> Status;
    pub fn WindowsDeleteString(string: Handle) -> Status;
    pub fn WindowsGetStringRawBuffer(string: Handle, length: &mut u32) -> *const u16;
}

#[link(name = "shell32", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn ExtractIconW(module: Handle, file: Str, index: u32) -> Handle;
    pub safe fn ILCreateFromPathW(path: Str) -> *mut c_void;
    pub fn SHChangeNotify(event: u32, flags: u32, first: *const c_void, second: *const c_void);
    pub safe fn SHGetPropertyStoreForWindow(
        window: Handle,
        id: &Guid,
        store: &mut Option<Unknown>,
    ) -> Status;
    pub fn SHAddToRecentDocs(kind: u32, item: *const c_void);
    pub safe fn SHAppBarMessage(message: u32, data: &mut AppBarData) -> usize;
    pub fn SHCreateItemFromParsingName(
        path: Str,
        context: usize,
        id: &Guid,
        item: *mut c_void,
    ) -> Status;
    pub fn SHCreateStdEnumFmtEtc(
        count: u32,
        formats: *const FormatEtc,
        all: &mut Option<Unknown>,
    ) -> Status;
    pub fn SHOpenFolderAndSelectItems(
        folder: *const c_void,
        count: u32,
        items: usize,
        flags: u32,
    ) -> Status;
    pub safe fn SetCurrentProcessExplicitAppUserModelID(id: Str) -> Status;
    pub safe fn ShellExecuteExW(what: &mut ShellExecuteInfoW) -> Bool;
    pub safe fn Shell_NotifyIconGetRect(
        icon: &NotifyIconIdentifier,
        rect: &mut DeviceRect,
    ) -> Status;
    pub safe fn Shell_NotifyIconW(message: u32, icon: &NotifyIconDataW) -> Bool;
}

#[link(name = "d3d11", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn D3D11CreateDevice(
        adapter: Borrowed,
        kind: i32,
        software: Handle,
        flags: u32,
        levels: usize,
        count: u32,
        version: u32,
        device: &mut Option<ID3D11Device>,
        level: &mut i32,
        context: &mut Option<ID3D11DeviceContext>,
    ) -> Status;
}

#[link(name = "dwmapi", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn DwmEnableBlurBehindWindow(window: Handle, how: &DwmBlurBehind) -> Status;
    pub safe fn DwmExtendFrameIntoClientArea(window: Handle, margins: &Margins) -> Status;
    pub safe fn DwmFlush() -> Status;
    pub fn DwmSetWindowAttribute(
        window: Handle,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> Status;
}

#[link(name = "shcore", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn GetDpiForMonitor(monitor: Handle, kind: i32, x: &mut u32, y: &mut u32) -> Status;
}

#[link(name = "imm32", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn ImmAssociateContextEx(window: Handle, context: Handle, flags: u32) -> Bool;
    pub fn ImmGetCompositionStringW(
        context: Handle,
        part: u32,
        buffer: *mut c_void,
        size: u32,
    ) -> i32;
    pub safe fn ImmGetContext(window: Handle) -> Handle;
    pub safe fn ImmGetVirtualKey(window: Handle) -> u32;
    pub safe fn ImmNotifyIME(context: Handle, action: u32, index: u32, value: u32) -> Bool;
    pub safe fn ImmReleaseContext(window: Handle, context: Handle) -> Bool;
    pub safe fn ImmSetCandidateWindow(context: Handle, form: &CandidateForm) -> Bool;
    pub safe fn ImmSetCompositionWindow(context: Handle, form: &CompositionForm) -> Bool;
}

#[link(name = "winmm", kind = "raw-dylib")]
unsafe extern "system" {
    pub safe fn timeBeginPeriod(milliseconds: u32) -> u32;
    pub safe fn timeEndPeriod(milliseconds: u32) -> u32;
}

/// The first call of what `build.rs` has the linker leave for later goes through this.
#[unsafe(no_mangle)]
unsafe extern "system" fn __delayLoadHelper2(
    library: *const c_void,
    slot: *mut c_void,
) -> *mut c_void {
    // SAFETY: from the linker.
    unsafe { ResolveDelayLoadedAPI(module(), library, 0, 0, slot, 0) }
}

pub fn address_of(library: Str, name: &CStr) -> usize {
    // SAFETY: a C string.
    unsafe {
        GetProcAddress(
            LoadLibraryExW(library, 0, LOAD_LIBRARY_SEARCH_SYSTEM32),
            name.as_ptr(),
        )
    }
    .expose_provenance()
}

/// From libraries that are loaded when they are needed. What the system does not have returns the value behind `or`.
macro_rules! lazily {
    ($($library:literal { $($symbol:literal $($name:ident)+ ($($argument:ident: $type:ty),*) -> $result:ty, or $otherwise:expr;)* })*) => {$($(
        lazily!(@function [$($name)+] ($($argument: $type),*) -> $result {
            static ADDRESS: OnceLock<usize> = OnceLock::new();
            let address = *ADDRESS.get_or_init(|| address_of(wide!($library), $symbol));
            // SAFETY: null, or the function that has this signature.
            let function = unsafe { std::mem::transmute::<usize, Option<extern "system" fn($($type),*) -> $result>>(address) };
            function.map_or($otherwise, |function| function($($argument),*))
        });
    )*)*};
    (@function [fn $name:ident] $arguments:tt -> $result:ty $body:block) => {
        pub fn $name $arguments -> $result $body
    };
    (@function [unsafe fn $name:ident] $arguments:tt -> $result:ty $body:block) => {
        /// # Safety
        /// The addresses are valid for what it does with them.
        pub unsafe fn $name $arguments -> $result $body
    };
}

const MISSING: Status = Status::NOT_IMPLEMENTED;

lazily! {
    "user32.dll" {
        c"IsWindowArranged" fn is_window_arranged(window: Handle) -> Bool, or 0;
    }
    "comctl32.dll" {
        c"TaskDialogIndirect" fn task_dialog_indirect(dialog: &TaskDialogConfig, button: &mut i32, radio: Option<&mut i32>, is_checked: &mut Bool) -> Status, or MISSING;
    }
    "dcomp.dll" {
        c"DCompositionBoostCompositorClock" fn boost_compositor_clock(is_on: Bool) -> Status, or MISSING;
        c"DCompositionCreateDevice3" fn create_composition_device(renderer: Borrowed, id: &Guid, device: &mut Option<Unknown>) -> Status, or MISSING;
        c"DCompositionWaitForCompositorClock" fn wait_for_compositor_clock(count: u32, handles: usize, milliseconds: u32) -> u32, or WAIT_FAILED;
    }
    "dwrite.dll" {
        c"DWriteCreateFactory" fn create_write_factory(kind: i32, id: &Guid, factory: &mut Option<Unknown>) -> Status, or MISSING;
    }
    "shlwapi.dll" {
        c"AssocQueryStringW" unsafe fn assoc_query_string(flags: u32, part: i32, name: Str, extra: Str, buffer: *mut u16, size: &mut u32) -> Status, or MISSING;
    }
    "uiautomationcore.dll" {
        c"UiaClientsAreListening" fn uia_clients_are_listening() -> Bool, or 0;
        c"UiaDisconnectProvider" fn uia_disconnect_provider(element: Borrowed) -> Status, or MISSING;
        c"UiaGetReservedMixedAttributeValue" fn uia_mixed_attribute(value: &mut Option<Unknown>) -> Status, or MISSING;
        c"UiaGetReservedNotSupportedValue" fn uia_not_supported(value: &mut Option<Unknown>) -> Status, or MISSING;
        c"UiaHostProviderFromHwnd" fn uia_host_provider(window: Handle, element: &mut Option<Unknown>) -> Status, or MISSING;
        c"UiaRaiseAsyncContentLoadedEvent" fn uia_raise_loaded(element: Borrowed, state: i32, percent: f64) -> Status, or MISSING;
        c"UiaRaiseAutomationEvent" fn uia_raise(element: Borrowed, event: i32) -> Status, or MISSING;
        c"UiaRaiseAutomationPropertyChangedEvent" fn uia_raise_property_changed(element: Borrowed, property: i32, old: &Variant, new: &Variant) -> Status, or MISSING;
        c"UiaRaiseNotificationEvent" fn uia_raise_notification(element: Borrowed, kind: i32, processing: i32, text: Str, activity: Str) -> Status, or MISSING;
        c"UiaRaiseStructureChangedEvent" unsafe fn uia_raise_structure_changed(element: Borrowed, change: i32, id: *const i32, length: i32) -> Status, or MISSING;
        c"UiaReturnRawElementProvider" fn uia_return_provider(window: Handle, w: usize, l: isize, element: Borrowed) -> isize, or 0;
    }
    "wtsapi32.dll" {
        c"WTSRegisterSessionNotification" fn register_session_notification(window: Handle, flags: u32) -> Bool, or 0;
    }
}
