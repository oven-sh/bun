pub const PRIMARY: u32 = 1;
pub const ATOM: u32 = 4;
pub const CARDINAL: u32 = 6;
pub const INTEGER: u32 = 19;
pub const RESOURCE_MANAGER: u32 = 23;
pub const STRING: u32 = 31;
pub const WINDOW: u32 = 33;
pub const WM_HINTS: u32 = 35;
pub const WM_NAME: u32 = 39;
pub const WM_NORMAL_HINTS: u32 = 40;
pub const WM_SIZE_HINTS: u32 = 41;
pub const WM_CLIENT_MACHINE: u32 = 36;
pub const WM_CLASS: u32 = 67;
pub const WM_TRANSIENT_FOR: u32 = 68;

macro_rules! atoms {
    ($($plain:ident)*; $($other:ident = $text:literal)*) => {
        /// Of an atom whose number the server chooses.
        #[derive(Clone, Copy)]
        #[expect(non_camel_case_types, clippy::upper_case_acronyms)]
        pub enum Name { $($plain,)* $($other,)* }
        pub use Name::*;
        pub const NAMES: &[&str] = &[$(stringify!($plain),)* $($text,)*];
    };
}

atoms! {
    ATOM_PAIR CLIPBOARD CLIPBOARD_MANAGER INCR MANAGER MULTIPLE SAVE_TARGETS TARGETS TEXT TIMESTAMP UTF8_STRING
    WM_CHANGE_STATE WM_DELETE_WINDOW WM_PROTOCOLS
    XdndActionCopy XdndAware XdndDrop XdndEnter XdndFinished XdndLeave XdndPosition XdndSelection XdndStatus
    XdndTypeList
    _GTK_SHOW_WINDOW_MENU _GTK_THEME_VARIANT _MOTIF_WM_HINTS
    _NET_ACTIVE_WINDOW _NET_CURRENT_DESKTOP _NET_SUPPORTED _NET_WM_ICON _NET_WM_MOVERESIZE _NET_WM_NAME _NET_WM_PID
    _NET_WM_PING _NET_WM_STATE _NET_WM_STATE_ABOVE _NET_WM_STATE_DEMANDS_ATTENTION _NET_WM_STATE_FOCUSED
    _NET_WM_STATE_FULLSCREEN _NET_WM_STATE_HIDDEN _NET_WM_STATE_MAXIMIZED_HORZ _NET_WM_STATE_MAXIMIZED_VERT
    _NET_WM_STATE_MODAL _NET_WM_STATE_SKIP_TASKBAR _NET_WM_STATE_STICKY _NET_WM_SYNC_REQUEST
    _NET_WM_SYNC_REQUEST_COUNTER _NET_WM_USER_TIME _NET_WM_WINDOW_OPACITY _NET_WM_WINDOW_TYPE
    _NET_WM_WINDOW_TYPE_DIALOG _NET_WM_WINDOW_TYPE_NORMAL _NET_WM_WINDOW_TYPE_NOTIFICATION _NET_WORKAREA
    _XSETTINGS_SETTINGS;
    TRANSFER = "_BUN_TRANSFER" PLAIN = "text/plain" PLAIN_UTF8 = "text/plain;charset=utf-8" HTML = "text/html"
    URI_LIST = "text/uri-list" PNG = "image/png" JPEG = "image/jpeg" WEBP = "image/webp" GIF = "image/gif"
    BMP = "image/bmp" SVG = "image/svg+xml"
}
