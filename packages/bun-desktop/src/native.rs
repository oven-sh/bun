//! What GPUI does not wrap. Functions that take a `NativeWindow` call back into GPUI's window procedure, so they run
//! through `app::after_update`, when the `App` is not borrowed.

#[cfg_attr(target_os = "macos", path = "native/macos.rs")]
#[cfg_attr(target_os = "windows", path = "native/windows.rs")]
#[cfg_attr(
    not(any(target_os = "macos", target_os = "windows")),
    path = "native/linux.rs"
)]
mod platform;

pub use platform::*;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod hotkeys;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use global_hotkey::GlobalHotKeyManager;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use hotkeys::GlobalHotKeyManager;
