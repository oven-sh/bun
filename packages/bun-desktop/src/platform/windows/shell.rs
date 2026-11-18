use std::cell::{OnceCell, RefCell};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::pixels::Bitmap;
use crate::error::{Context as _, Result, ensure};
use crate::protocol::{Application, Media};
use crate::sync::Mutex;
use crate::win32::com::{self, Borrowed, Interface, Outcome, made};
use crate::win32::*;

/// For what may take long, or opens a window of its own.
pub fn in_apartment(name: &str, work: impl FnOnce() + Send + 'static) -> Result<()> {
    std::thread::Builder::new().name(name.into()).spawn(|| {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        _ = CoInitializeEx(0, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        work();
        CoUninitialize();
    })?;
    Ok(())
}

pub fn item<T: Interface>(path: impl AsRef<Path>) -> Outcome<T> {
    // It only knows backslashes.
    let path = Wide::new(std::path::absolute(path).map_err(|_| com::Status::INVALID_ARGUMENT)?);
    // SAFETY: room for a reference of that kind.
    made(|it| unsafe {
        SHCreateItemFromParsingName(path.str(), 0, &T::ID, std::ptr::from_mut(it).cast())
    })
}

pub fn icon_of_app() -> Handle {
    Some(LoadIconW(GetModuleHandleW(Str::NULL), Str::numbered(1)))
        .filter(|it| *it != 0)
        .unwrap_or_else(|| {
            ExtractIconW(
                module(),
                Wide::new(std::env::current_exe().unwrap_or_default()).str(),
                0,
            )
        })
}

pub fn with_taskbar(f: impl FnOnce(&ITaskbarList3) -> com::Status) -> Outcome {
    thread_local! {
        static TASKBAR: OnceCell<Option<std::mem::ManuallyDrop<ITaskbarList3>>> = const { OnceCell::new() };
    }
    let create = || {
        com::create::<ITaskbarList3>(CLSID_TASKBAR_LIST)
            .ok()
            .filter(|it| it.hr_init().ok().is_ok())
            .map(std::mem::ManuallyDrop::new)
    };
    TASKBAR.with(|it| {
        it.get_or_init(create)
            .as_deref()
            .map_or(com::Status::FAILED, f)
            .ok()
    })
}

pub fn show_in_taskbar(window: Handle, shows: bool) {
    _ = with_taskbar(|it| {
        if shows {
            it.add_tab(window)
        } else {
            it.delete_tab(window)
        }
    });
}

pub fn mark_fullscreen(window: Handle, is_fullscreen: bool) {
    _ = with_taskbar(|it| it.mark_fullscreen_window(window, is_fullscreen.into()));
}

pub fn is_in_tablet_mode(window: Handle) -> bool {
    const TOUCH: i32 = 1;
    let mode = || {
        let views: IUIViewSettingsInterop =
            com::factory("Windows.UI.ViewManagement.UIViewSettings")?;
        let view: IUIViewSettings =
            made(|it| views.get_for_window(window, &IUIViewSettings::ID, it))?.cast()?;
        com::filled(|it| view.get_user_interaction_mode(it))
    };
    mode() == Ok(TOUCH)
}

/// As `Question::Access` has it.
pub fn access_to(media: Media) -> Option<u32> {
    let name = match media {
        Media::Microphone => "microphone",
        Media::Camera => "webcam",
        Media::Screen => return None,
    };
    let key = format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{name}"
    );
    let denies = |root, below| {
        registry::text(
            root,
            Wide::new(format!("{key}{below}")).str(),
            wide!("Value"),
        ) == "Deny"
    };
    Some(match () {
        () if denies(HKEY_LOCAL_MACHINE, "") => 1,
        () if denies(HKEY_CURRENT_USER, "") || denies(HKEY_CURRENT_USER, "\\NonPackaged") => 2,
        () => 3,
    })
}

pub const HIDDEN_BARS_CHANGED: u32 = WM_APP + 17;

static HIDDEN_BARS: Mutex<Vec<(DeviceRect, [bool; 4])>> = Mutex::new(Vec::new());

/// At the left, top, right and bottom of a display.
pub fn hidden_bars(display: DeviceRect) -> [bool; 4] {
    HIDDEN_BARS
        .lock()
        .iter()
        .find(|it| it.0 == display)
        .map_or([false; 4], |it| it.1)
}

/// The taskbar answers when it gets around to it.
pub fn look_for_hidden_bars() {
    static WANTED: Mutex<Option<Vec<DeviceRect>>> = Mutex::new(None);
    static IS_LOOKING: AtomicBool = AtomicBool::new(false);
    let (mut wanted, listener) = (WANTED.lock(), crate::host::system::window());
    *wanted = Some(super::displays::areas());
    if IS_LOOKING.swap(true, Ordering::Relaxed) {
        return;
    }
    let next = || {
        WANTED
            .lock()
            .take()
            .or_else(|| (IS_LOOKING.store(false, Ordering::Relaxed), None).1)
    };
    let has = |rc, u_edge| {
        SHAppBarMessage(
            ABM_GETAUTOHIDEBAREX,
            &mut AppBarData {
                cb_size: size_of::<AppBarData>() as u32,
                u_edge,
                rc,
                ..Default::default()
            },
        ) != 0
    };
    let started = in_apartment("taskbar", move || {
        for displays in std::iter::from_fn(next) {
            let found: Vec<_> = displays
                .into_iter()
                .map(|it| {
                    (
                        it,
                        [ABE_LEFT, ABE_TOP, ABE_RIGHT, ABE_BOTTOM].map(|edge| has(it, edge)),
                    )
                })
                .filter(|it| it.1 != [false; 4])
                .collect();
            if std::mem::replace(&mut *HIDDEN_BARS.lock(), found.clone()) != found {
                PostMessageW(listener, HIDDEN_BARS_CHANGED, 0, 0);
            }
        }
    });
    IS_LOOKING.store(started.is_ok(), Ordering::Relaxed);
}

/// Only with a program that is registered for its scheme: the system takes anything else for a path.
pub fn for_handler(url: &str) -> Result<String> {
    let (scheme, quoted) = crate::platform::quoted_for_handler(url).context("it is not a URL")?;
    ensure!(
        scheme.eq_ignore_ascii_case("file")
            || registry::exists(
                HKEY_CLASSES_ROOT,
                Wide::new(scheme).str(),
                wide!("URL Protocol")
            ),
        "no program opens {scheme}: URLs"
    );
    Ok(quoted)
}

pub fn open(what: &str) -> Result<()> {
    let file = Wide::new(what);
    let size = size_of::<ShellExecuteInfoW>() as u32;
    let mut how = ShellExecuteInfoW {
        cb_size: size,
        f_mask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        lp_file: file.str(),
        n_show: SW_SHOWNORMAL,
        ..Default::default()
    };
    succeeded(ShellExecuteExW(&mut how)).with_context(|| format!("could not open {what}"))
}

pub fn reveal(path: &str) -> Result<()> {
    let list = ILCreateFromPathW(Wide::new(std::path::absolute(path)?).str());
    ensure!(!list.is_null(), "{path} does not exist");
    // SAFETY: the list of identifiers, which is this function's.
    unsafe {
        let status = SHOpenFolderAndSelectItems(list, 0, 0, 0);
        CoTaskMemFree(list);
        Ok(status.ok()?)
    }
}

pub fn trash(path: &str) -> Result<()> {
    let (operation, mut was_aborted) = (com::create::<IFileOperation>(CLSID_FILE_OPERATION)?, 0);
    // It asks before it deletes for good what does not fit.
    operation
        .set_operation_flags(
            FOF_ALLOWUNDO
                | FOF_NOCONFIRMATION
                | FOF_NOERRORUI
                | FOF_SILENT
                | FOF_WANTNUKEWARNING
                | FOFX_EARLYFAILURE
                | FOFX_RECYCLEONDELETE,
        )
        .ok()?;
    operation
        .delete_item(item::<IShellItem>(path)?.borrowed(), Borrowed::default())
        .ok()?;
    operation.perform_operations().ok()?;
    operation
        .get_any_operations_aborted(&mut was_aborted)
        .ok()?;
    ensure!(was_aborted == 0, "the operation was aborted");
    Ok(())
}

pub fn add_recent_document(path: &str) {
    // SAFETY: a string, as the first argument says.
    unsafe { SHAddToRecentDocs(SHARD_PATHW, Wide::new(path).as_ptr().cast()) };
}

pub fn application_for(url: &str) -> Option<Application> {
    let scheme = Wide::new(url.split(':').next()?);
    let ask = |part| {
        let (mut buffer, mut size) = ([0; 1024], 1024);
        // SAFETY: the buffer with its length.
        unsafe {
            assoc_query_string(
                ASSOCF_IS_PROTOCOL,
                part,
                scheme.str(),
                Str::NULL,
                buffer.as_mut_ptr(),
                &mut size,
            )
        }
        .ok()
        .ok()
        .map(|()| string_in(&buffer))
    };
    Some(Application {
        name: ask(ASSOCSTR_FRIENDLYAPPNAME)?.into(),
        path: ask(ASSOCSTR_EXECUTABLE).unwrap_or_default().into(),
        bundle: Default::default(),
    })
}

pub fn file_icon(path: &str, side: u32) -> Option<Vec<u8>> {
    let (size, mut found) = (
        DeviceSize {
            cx: side as i32,
            cy: side as i32,
        },
        0,
    );
    item::<IShellItemImageFactory>(path)
        .ok()?
        .get_image(size, SIIGBF_ICONONLY, &mut found)
        .ok()
        .ok()?;
    let (mut copy, device) = (Bitmap::new(size.cx, size.cy)?, GetDC(0));
    // SAFETY: room for that many rows, and the bitmap is this function's.
    unsafe {
        GetDIBits(
            device,
            found,
            0,
            side,
            copy.pixels().as_mut_ptr().cast(),
            &mut BitmapInfoHeader::of(size.cx, -size.cy),
            DIB_RGB_COLORS,
        );
        DeleteObject(found);
    }
    ReleaseDC(0, device);
    crate::codec::Rgba {
        width: side,
        height: side,
        data: copy
            .pixels()
            .iter()
            .flat_map(|&[b, g, r, a]| [r, g, b, a])
            .collect(),
    }
    .to_png()
}

thread_local! {
    static REASONS_TO_STAY_AWAKE: RefCell<Vec<(u32, Handle)>> = RefCell::default();
}

pub fn prevent_sleep(id: u32, reason: &str) {
    let reason = Wide::new(reason);
    let request = PowerCreateRequest(&ReasonContext {
        flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING as u32,
        reason: reason.str(),
        ..Default::default()
    });
    [
        POWER_REQUEST_DISPLAY_REQUIRED,
        POWER_REQUEST_SYSTEM_REQUIRED,
    ]
    .into_iter()
    .for_each(|it| _ = PowerSetRequest(request, it));
    REASONS_TO_STAY_AWAKE.with_borrow_mut(|it| it.push((id, request)));
}

pub fn allow_sleep(id: u32) {
    REASONS_TO_STAY_AWAKE.with_borrow_mut(|all| {
        all.extract_if(.., |it| it.0 == id)
            .for_each(|it| _ = CloseHandle(it.1))
    });
}
