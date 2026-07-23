//! Raw FFI declarations for libghostty-vt plus `VirtualTerminal`, a safe
//! owning wrapper over the handful of entry points Bun needs.
//!
//! The declarations mirror `vendor/ghostty-vt/include/ghostty/vt/*.h`.
//! Every enum in that API is explicitly backed by C `int`
//! (`GHOSTTY_ENUM_TYPED`), so they are declared here as `c_int` constants
//! rather than Rust enums: the library may add variants and we must not
//! UB on an unknown discriminant.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

// ───────────────────────────────────────────────────────────────────────────
// Types (ghostty/vt/types.h)
// ───────────────────────────────────────────────────────────────────────────

/// `GhosttyResult`
pub type Result_ = c_int;
pub const GHOSTTY_SUCCESS: Result_ = 0;
pub const GHOSTTY_OUT_OF_MEMORY: Result_ = -1;
pub const GHOSTTY_INVALID_VALUE: Result_ = -2;
pub const GHOSTTY_OUT_OF_SPACE: Result_ = -3;
pub const GHOSTTY_NO_VALUE: Result_ = -4;

/// `GhosttyFormatterFormat`
pub type FormatterFormat = c_int;
pub const GHOSTTY_FORMATTER_FORMAT_PLAIN: FormatterFormat = 0;
pub const GHOSTTY_FORMATTER_FORMAT_VT: FormatterFormat = 1;

/// `GhosttyTerminalData` (the subset Bun reads).
pub type TerminalData = c_int;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_X: TerminalData = 3;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_Y: TerminalData = 4;
pub const GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS: TerminalData = 15;

/// `GhosttyPointTag`
pub type PointTag = c_int;
pub const GHOSTTY_POINT_TAG_ACTIVE: PointTag = 0;

// Opaque handles. The C side declares `typedef struct FooImpl* Foo;` — we
// model them as `NonNull<Opaque>` where non-null is guaranteed.
#[repr(C)]
pub struct TerminalImpl {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct FormatterImpl {
    _opaque: [u8; 0],
}

/// `GhosttyTerminalOptions`
#[repr(C)]
#[derive(Clone, Copy)]
pub struct TerminalOptions {
    pub cols: u16,
    pub rows: u16,
    /// Scrollback retention limit in bytes (ghostty pages the history and
    /// trims the oldest page once the total exceeds this).
    pub max_scrollback: usize,
}

/// `GhosttyPointCoordinate`
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PointCoordinate {
    pub x: u16,
    pub y: u32,
}

/// `GhosttyPointValue` (union padded to 16 bytes for ABI stability)
#[repr(C)]
#[derive(Clone, Copy)]
pub union PointValue {
    pub coordinate: PointCoordinate,
    pub _padding: [u64; 2],
}

/// `GhosttyPoint`
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Point {
    pub tag: PointTag,
    pub value: PointValue,
}

impl Point {
    pub fn active(x: u16, y: u32) -> Self {
        Self {
            tag: GHOSTTY_POINT_TAG_ACTIVE,
            value: PointValue {
                coordinate: PointCoordinate { x, y },
            },
        }
    }
}

/// `GhosttyGridRef` — an untracked reference into the terminal grid. Only
/// valid until the next mutating terminal call (`vt_write`, `resize`, ...).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GridRef {
    pub size: usize,
    pub node: *mut c_void,
    pub x: u16,
    pub y: u16,
}

impl GridRef {
    pub fn zeroed() -> Self {
        Self {
            size: core::mem::size_of::<Self>(),
            node: core::ptr::null_mut(),
            x: 0,
            y: 0,
        }
    }
}

/// `GhosttySelection`
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Selection {
    pub size: usize,
    pub start: GridRef,
    pub end: GridRef,
    pub rectangle: bool,
}

/// `GhosttyFormatterScreenExtra`
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct FormatterScreenExtra {
    pub size: usize,
    pub cursor: bool,
    pub style: bool,
    pub hyperlink: bool,
    pub protection: bool,
    pub kitty_keyboard: bool,
    pub charsets: bool,
}

/// `GhosttyFormatterTerminalExtra`
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct FormatterTerminalExtra {
    pub size: usize,
    pub palette: bool,
    pub modes: bool,
    pub scrolling_region: bool,
    pub tabstops: bool,
    pub pwd: bool,
    pub keyboard: bool,
    pub screen: FormatterScreenExtra,
}

/// `GhosttyFormatterTerminalOptions`
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FormatterTerminalOptions {
    pub size: usize,
    pub emit: FormatterFormat,
    pub unwrap: bool,
    pub trim: bool,
    pub extra: FormatterTerminalExtra,
    pub selection: *const Selection,
}

// ───────────────────────────────────────────────────────────────────────────
// Functions
// ───────────────────────────────────────────────────────────────────────────

unsafe extern "C" {
    // Allocator: `None` ⇔ the C `NULL` "use the default allocator" contract.
    // `GhosttyAllocator` is never constructed on the Rust side, so its shape
    // is irrelevant here; declare the parameter as an opaque pointer.
    pub(crate) fn ghostty_terminal_new(
        allocator: *const c_void,
        terminal: *mut *mut TerminalImpl,
        options: TerminalOptions,
    ) -> Result_;
    pub(crate) fn ghostty_terminal_free(terminal: *mut TerminalImpl);
    pub(crate) fn ghostty_terminal_resize(
        terminal: *mut TerminalImpl,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    ) -> Result_;
    pub(crate) fn ghostty_terminal_vt_write(
        terminal: *mut TerminalImpl,
        data: *const u8,
        len: usize,
    );
    pub(crate) fn ghostty_terminal_get(
        terminal: *mut TerminalImpl,
        data: TerminalData,
        out: *mut c_void,
    ) -> Result_;
    pub(crate) fn ghostty_terminal_grid_ref(
        terminal: *mut TerminalImpl,
        point: Point,
        out_ref: *mut GridRef,
    ) -> Result_;

    pub(crate) fn ghostty_formatter_terminal_new(
        allocator: *const c_void,
        formatter: *mut *mut FormatterImpl,
        terminal: *mut TerminalImpl,
        options: FormatterTerminalOptions,
    ) -> Result_;
    pub(crate) fn ghostty_formatter_format_buf(
        formatter: *mut FormatterImpl,
        buf: *mut u8,
        buf_len: usize,
        out_written: *mut usize,
    ) -> Result_;
    pub(crate) fn ghostty_formatter_free(formatter: *mut FormatterImpl);
}

// ───────────────────────────────────────────────────────────────────────────
// Safe wrapper
// ───────────────────────────────────────────────────────────────────────────

/// An owning handle to a libghostty-vt terminal emulator.
///
/// Feed raw child output through [`write`](Self::write) and read back a
/// styled snapshot one row at a time with
/// [`format_active_row`](Self::format_active_row). The terminal owns a cell
/// grid plus bounded scrollback, so carriage-return progress bars, cursor
/// movement, and screen clears all resolve to the text a real terminal
/// would be showing rather than leaking control bytes into the UI.
///
/// Not `Send`/`Sync`: libghostty-vt terminals have no internal locking.
pub struct VirtualTerminal {
    term: NonNull<TerminalImpl>,
    cols: u16,
    rows: u16,
    /// Reused across `format` calls; grown on `GHOSTTY_OUT_OF_SPACE`.
    fmt_buf: Vec<u8>,
    /// `!Send + !Sync`
    _not_send: core::marker::PhantomData<*mut TerminalImpl>,
}

impl VirtualTerminal {
    /// `max_scrollback` is the history retention limit in bytes; 0 keeps no
    /// history beyond the visible `rows`. Returns `None` on allocation
    /// failure or if `cols`/`rows` is 0.
    pub fn new(cols: u16, rows: u16, max_scrollback: usize) -> Option<Self> {
        if cols == 0 || rows == 0 {
            return None;
        }
        let mut raw: *mut TerminalImpl = core::ptr::null_mut();
        // SAFETY: `raw` is a valid out-pointer; a NULL allocator selects the
        // library's default allocator.
        let rc = unsafe {
            ghostty_terminal_new(
                core::ptr::null(),
                &raw mut raw,
                TerminalOptions {
                    cols,
                    rows,
                    max_scrollback,
                },
            )
        };
        if rc != GHOSTTY_SUCCESS {
            return None;
        }
        Some(Self {
            term: NonNull::new(raw)?,
            cols,
            rows,
            fmt_buf: Vec::new(),
            _not_send: core::marker::PhantomData,
        })
    }

    pub fn cols(&self) -> u16 {
        self.cols
    }

    pub fn rows(&self) -> u16 {
        self.rows
    }

    /// Feed raw bytes from the child's pty into the emulator.
    pub fn write(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        // SAFETY: `term` is live; `data` is a valid slice for this call.
        unsafe { ghostty_terminal_vt_write(self.term.as_ptr(), data.as_ptr(), data.len()) };
    }

    /// Resize the grid. Existing content reflows.
    pub fn resize(&mut self, cols: u16, rows: u16) {
        if cols == 0 || rows == 0 || (cols == self.cols && rows == self.rows) {
            return;
        }
        // SAFETY: `term` is live. Pixel sizes are unused by Bun (no image
        // protocol rendering) so 0/0 is fine.
        if unsafe { ghostty_terminal_resize(self.term.as_ptr(), cols, rows, 0, 0) }
            == GHOSTTY_SUCCESS
        {
            self.cols = cols;
            self.rows = rows;
        }
    }

    /// 0-indexed column of the cursor.
    fn cursor_col(&self) -> u16 {
        let mut out: u16 = 0;
        // SAFETY: `term` is live; CURSOR_X writes a `uint16_t`.
        let rc = unsafe {
            ghostty_terminal_get(
                self.term.as_ptr(),
                GHOSTTY_TERMINAL_DATA_CURSOR_X,
                (&raw mut out).cast::<c_void>(),
            )
        };
        if rc == GHOSTTY_SUCCESS { out } else { 0 }
    }

    /// 0-indexed row of the cursor within the active area.
    fn cursor_row(&self) -> u16 {
        let mut out: u16 = 0;
        // SAFETY: `term` is live; CURSOR_Y writes a `uint16_t`.
        let rc = unsafe {
            ghostty_terminal_get(
                self.term.as_ptr(),
                GHOSTTY_TERMINAL_DATA_CURSOR_Y,
                (&raw mut out).cast::<c_void>(),
            )
        };
        if rc == GHOSTTY_SUCCESS { out } else { 0 }
    }

    /// Number of rows that have scrolled off the top of the active area
    /// into history.
    pub fn scrollback_rows(&self) -> usize {
        let mut out: usize = 0;
        // SAFETY: `term` is live; SCROLLBACK_ROWS writes a `size_t`.
        let rc = unsafe {
            ghostty_terminal_get(
                self.term.as_ptr(),
                GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS,
                (&raw mut out).cast::<c_void>(),
            )
        };
        if rc == GHOSTTY_SUCCESS { out } else { 0 }
    }

    /// Rows of the active area that carry content: everything through the
    /// cursor's row, EXCLUDING that row when the cursor is resting at
    /// column 0 on it (the position after a trailing newline). A task
    /// that has printed N complete lines renders N rows, not N plus a
    /// blank; a task that has printed nothing renders zero.
    pub fn used_rows(&self) -> u16 {
        (self.cursor_row() + u16::from(self.cursor_col() > 0)).min(self.rows)
    }

    /// Serialize one row of the active area as VT text — SGR colors and
    /// styles preserved, trailing whitespace trimmed, no trailing newline —
    /// into `out`, which is cleared first.
    ///
    /// Returns `false` (leaving `out` empty) if `y` is out of range or the
    /// formatter fails.
    pub fn format_active_row(&mut self, y: u16, out: &mut Vec<u8>) -> bool {
        out.clear();
        if y >= self.rows {
            return false;
        }

        // Untracked grid refs go stale on the next mutating terminal call,
        // and the formatter captures them at creation, so both the selection
        // and the formatter must be rebuilt for every snapshot.
        let mut selection = Selection {
            size: core::mem::size_of::<Selection>(),
            start: GridRef::zeroed(),
            end: GridRef::zeroed(),
            rectangle: false,
        };
        let start = Point::active(0, u32::from(y));
        let end = Point::active(self.cols - 1, u32::from(y));
        // SAFETY: `term` is live; both points are within the active area.
        let ok = unsafe {
            ghostty_terminal_grid_ref(self.term.as_ptr(), start, &raw mut selection.start)
                == GHOSTTY_SUCCESS
                && ghostty_terminal_grid_ref(self.term.as_ptr(), end, &raw mut selection.end)
                    == GHOSTTY_SUCCESS
        };
        if !ok {
            return false;
        }

        let options = FormatterTerminalOptions {
            size: core::mem::size_of::<FormatterTerminalOptions>(),
            emit: GHOSTTY_FORMATTER_FORMAT_VT,
            unwrap: false,
            trim: true,
            extra: FormatterTerminalExtra {
                size: core::mem::size_of::<FormatterTerminalExtra>(),
                screen: FormatterScreenExtra {
                    size: core::mem::size_of::<FormatterScreenExtra>(),
                    ..Default::default()
                },
                ..Default::default()
            },
            selection: &raw const selection,
        };

        let mut formatter: *mut FormatterImpl = core::ptr::null_mut();
        // SAFETY: `term` is live, `formatter` is a valid out-pointer, and
        // `selection` (when set) outlives this call.
        let rc = unsafe {
            ghostty_formatter_terminal_new(
                core::ptr::null(),
                &raw mut formatter,
                self.term.as_ptr(),
                options,
            )
        };
        if rc != GHOSTTY_SUCCESS || formatter.is_null() {
            return false;
        }
        // SAFETY: `formatter` was created above and is freed exactly once here.
        let _free = scopeguard::guard(formatter, |f| unsafe { ghostty_formatter_free(f) });

        // First attempt reuses whatever capacity a previous format left; a
        // new buffer starts at a one-row estimate (up to 4 UTF-8 bytes per
        // cell plus SGR escapes), and GHOSTTY_OUT_OF_SPACE hands back the
        // exact required size for the retry.
        if self.fmt_buf.capacity() == 0 {
            self.fmt_buf.reserve((usize::from(self.cols) + 1) * 8);
        }
        loop {
            let cap = self.fmt_buf.capacity();
            let mut written: usize = 0;
            // SAFETY: `formatter` is live; `fmt_buf` has `cap` writable bytes.
            let rc = unsafe {
                ghostty_formatter_format_buf(
                    formatter,
                    self.fmt_buf.as_mut_ptr(),
                    cap,
                    &raw mut written,
                )
            };
            match rc {
                GHOSTTY_SUCCESS => {
                    // SAFETY: the formatter reported `written <= cap`
                    // initialized bytes.
                    unsafe { self.fmt_buf.set_len(written.min(cap)) };
                    break;
                }
                GHOSTTY_OUT_OF_SPACE => {
                    if written <= cap {
                        // Cannot make progress; treat as a failed format.
                        return false;
                    }
                    self.fmt_buf.reserve(written - self.fmt_buf.len());
                }
                _ => return false,
            }
        }

        out.extend_from_slice(&self.fmt_buf);
        true
    }
}

impl Drop for VirtualTerminal {
    fn drop(&mut self) {
        // SAFETY: `term` was created by `ghostty_terminal_new` and is freed
        // exactly once here.
        unsafe { ghostty_terminal_free(self.term.as_ptr()) };
    }
}
