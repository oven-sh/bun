use std::rc::Rc;

use anyhow::Result;
use gpui::{Platform, Window};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use windows::Win32::Foundation::{COLORREF, HWND, POINT};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GWL_STYLE, GetCursorPos, GetWindowLongPtrW, HWND_NOTOPMOST, HWND_TOPMOST,
    IsIconic, LWA_ALPHA, SW_HIDE, SW_RESTORE, SW_SHOW, SW_SHOWNOACTIVATE, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetLayeredWindowAttributes,
    SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, ShowWindow, WDA_EXCLUDEFROMCAPTURE,
    WDA_NONE, WINDOW_LONG_PTR_INDEX, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT, WS_MAXIMIZEBOX, WS_THICKFRAME,
};
use windows_registry::CURRENT_USER;

pub const CAN_OPEN_HIDDEN: bool = true;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

pub fn prewarm() {}

pub fn paints_pixels() -> bool {
    false
}

pub fn switch_renderer() -> bool {
    false
}

pub fn platform(headless: bool) -> Rc<dyn Platform> {
    Rc::new(gpui_windows::WindowsPlatform::new(headless).expect("could not initialize the UI"))
}

pub fn launched() {}

/// A handle that outlived its window makes these calls fail, which Win32 defines.
#[derive(Clone, Copy)]
pub struct NativeWindow {
    hwnd: HWND,
    scale: f32,
}

impl NativeWindow {
    pub fn of(window: &Window) -> NativeWindow {
        let hwnd = match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
            Ok(RawWindowHandle::Win32(handle)) => HWND(handle.hwnd.get() as _),
            _ => HWND::default(),
        };
        NativeWindow {
            hwnd,
            scale: window.scale_factor(),
        }
    }

    fn change_style(self, index: WINDOW_LONG_PTR_INDEX, set: u32, clear: u32) -> Result<()> {
        let unchanged = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE;
        // SAFETY: no pointers are passed.
        unsafe {
            let style = GetWindowLongPtrW(self.hwnd, index) as u32;
            SetWindowLongPtrW(self.hwnd, index, ((style | set) & !clear) as isize);
            SetWindowPos(self.hwnd, None, 0, 0, 0, 0, unchanged | SWP_FRAMECHANGED)?;
        }
        Ok(())
    }

    pub fn handle(self) -> u64 {
        self.hwnd.0 as u64
    }

    pub fn can_hide(self) -> bool {
        true
    }

    pub fn set_visible(self, visible: bool, focus: bool) -> Result<()> {
        let command = match (visible, focus) {
            (false, _) => SW_HIDE,
            (true, true) => SW_SHOW,
            (true, false) => SW_SHOWNOACTIVATE,
        };
        // SAFETY: no pointers are passed. The result is the previous visibility.
        let _ = unsafe { ShowWindow(self.hwnd, command) };
        Ok(())
    }

    pub fn set_position(self, x: f32, y: f32) -> Result<()> {
        let (x, y) = ((x * self.scale) as i32, (y * self.scale) as i32);
        let flags = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE;
        // SAFETY: no pointers are passed.
        Ok(unsafe { SetWindowPos(self.hwnd, None, x, y, 0, 0, flags) }?)
    }

    pub fn set_always_on_top(self, on: bool) -> Result<()> {
        let after = if on { HWND_TOPMOST } else { HWND_NOTOPMOST };
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
        // SAFETY: no pointers are passed.
        Ok(unsafe { SetWindowPos(self.hwnd, Some(after), 0, 0, 0, 0, flags) }?)
    }

    pub fn set_skip_taskbar(self, on: bool) -> Result<()> {
        match on {
            true => self.change_style(GWL_EXSTYLE, WS_EX_TOOLWINDOW.0, WS_EX_APPWINDOW.0),
            false => self.change_style(GWL_EXSTYLE, WS_EX_APPWINDOW.0, WS_EX_TOOLWINDOW.0),
        }
    }

    pub fn set_visible_on_all_workspaces(self, _on: bool) -> Result<()> {
        Ok(())
    }

    pub fn set_opacity(self, opacity: f32) -> Result<()> {
        self.change_style(GWL_EXSTYLE, WS_EX_LAYERED.0, 0)?;
        let alpha = (opacity * 255.).round() as u8;
        // SAFETY: no pointers are passed.
        Ok(unsafe { SetLayeredWindowAttributes(self.hwnd, COLORREF(0), alpha, LWA_ALPHA) }?)
    }

    /// GPUI answers `WM_GETMINMAXINFO` with the minimum that the window was created with.
    pub fn set_size_limits(
        self,
        _min: (f32, f32),
        _max: Option<(f32, f32)>,
        resizable: bool,
    ) -> Result<()> {
        let bits = WS_THICKFRAME.0 | WS_MAXIMIZEBOX.0;
        match resizable {
            true => self.change_style(GWL_STYLE, bits, 0),
            false => self.change_style(GWL_STYLE, 0, bits),
        }
    }

    pub fn set_ignore_mouse_events(self, ignore: bool) -> Result<()> {
        match ignore {
            true => self.change_style(GWL_EXSTYLE, WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0, 0),
            false => self.change_style(GWL_EXSTYLE, 0, WS_EX_TRANSPARENT.0),
        }
    }

    pub fn set_content_protection(self, on: bool) -> Result<()> {
        let affinity = if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        // SAFETY: no pointers are passed.
        Ok(unsafe { SetWindowDisplayAffinity(self.hwnd, affinity) }?)
    }

    pub fn is_minimized(self) -> bool {
        // SAFETY: no pointers are passed.
        unsafe { IsIconic(self.hwnd) }.as_bool()
    }

    pub fn restore(self) -> Result<()> {
        // SAFETY: no pointers are passed. The result is the previous visibility.
        let _ = unsafe { ShowWindow(self.hwnd, SW_RESTORE) };
        Ok(())
    }
}

pub fn cursor_position(scale: f32) -> Option<(f32, f32)> {
    let mut point = POINT::default();
    // SAFETY: `point` is a valid out-pointer.
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x as f32 / scale, point.y as f32 / scale))
}

pub fn idle_seconds() -> Result<f64> {
    let mut info = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a valid out-pointer whose size is set.
    unsafe {
        GetLastInputInfo(&mut info).ok()?;
        Ok(f64::from(GetTickCount().wrapping_sub(info.dwTime)) / 1000.)
    }
}

pub fn on_battery() -> bool {
    const AC_OFFLINE: u8 = 0;
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: `status` is a valid out-pointer.
    unsafe { GetSystemPowerStatus(&mut status) }.is_ok() && status.ACLineStatus == AC_OFFLINE
}

pub fn set_badge(_text: &str, _app_id: &str) -> Result<()> {
    Ok(())
}

pub fn opens_at_login(name: &str) -> Result<bool> {
    Ok(CURRENT_USER.create(RUN_KEY)?.get_string(name).is_ok())
}

pub fn set_opens_at_login(name: &str, command: &str, on: bool) -> Result<()> {
    let key = CURRENT_USER.create(RUN_KEY)?;
    if on {
        key.set_string(name, command)?;
    } else if key.get_string(name).is_ok() {
        key.remove_value(name)?;
    }
    Ok(())
}

fn protocol_key(scheme: &str) -> String {
    format!(r"Software\Classes\{scheme}")
}

pub fn protocol_command(scheme: &str) -> Option<String> {
    let path = format!(r"{}\shell\open\command", protocol_key(scheme));
    CURRENT_USER.open(path).ok()?.get_string("").ok()
}

pub fn set_protocol_command(scheme: &str, command: Option<&str>) -> Result<()> {
    let Some(command) = command else {
        return Ok(CURRENT_USER.remove_tree(protocol_key(scheme))?);
    };
    let key = CURRENT_USER.create(protocol_key(scheme))?;
    key.set_string("", format!("URL:{scheme}"))?;
    key.set_string("URL Protocol", "")?;
    key.create(r"shell\open\command")?.set_string("", command)?;
    Ok(())
}

/// DPAPI, for the current user.
pub fn protect_data(mut data: Vec<u8>, protects: bool) -> Result<Vec<u8>> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CryptProtectData, CryptUnprotectData,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len())?,
        pbData: data.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `input` describes `data`. `output` is allocated by the call, and freed after it is copied.
    unsafe {
        if protects {
            CryptProtectData(&input, None, None, None, None, 0, &mut output)?;
        } else {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output)?;
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(result)
    }
}
