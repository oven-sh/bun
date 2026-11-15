//! Terminal progress indicator used for Bun install and some other places.
//!
//! TODO: It would be worth considering using our own progress indicator for
//! Bun install, as this bar only shows the most recent action.
//!
//! This API is non-allocating and non-fallible.

use core::cell::Cell;
use core::fmt;
use std::io::Write as _;
use std::time::Instant;

use crate::strings;
#[cfg(windows)]
use crate::windows_sys as windows;

// `HANDLE` is an opaque kernel handle (kernel32 validates and returns 0/FALSE
// on a non-console handle); every out-param is `&mut T` to a `#[repr(C)]` POD,
// ABI-identical to the Win32 `LP*` pointer (thin non-null). The reference type
// encodes the only pointer-validity precondition, so `safe fn` discharges the
// link-time proof. (`bun_windows_sys::kernel32` declares these with `*mut`;
// redeclared locally so the legacy-conhost cursor path below is plain calls.)
#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetConsoleMode(
        hConsoleHandle: windows::HANDLE,
        lpMode: &mut windows::DWORD,
    ) -> windows::BOOL;
    safe fn GetConsoleScreenBufferInfo(
        hConsoleOutput: windows::HANDLE,
        lpConsoleScreenBufferInfo: &mut windows::CONSOLE_SCREEN_BUFFER_INFO,
    ) -> windows::BOOL;
    safe fn FillConsoleOutputAttribute(
        hConsoleOutput: windows::HANDLE,
        wAttribute: windows::WORD,
        nLength: windows::DWORD,
        dwWriteCoord: windows::COORD,
        lpNumberOfAttrsWritten: &mut windows::DWORD,
    ) -> windows::BOOL;
    safe fn FillConsoleOutputCharacterW(
        hConsoleOutput: windows::HANDLE,
        cCharacter: windows::WCHAR,
        nLength: windows::DWORD,
        dwWriteCoord: windows::COORD,
        lpNumberOfCharsWritten: &mut windows::DWORD,
    ) -> windows::BOOL;
    safe fn SetConsoleCursorPosition(
        hConsoleOutput: windows::HANDLE,
        dwCursorPosition: windows::COORD,
    ) -> windows::BOOL;
}

// Progress's terminal handle is the canonical `output::File` (vtable-backed
// stderr/File from `OutputSinkVTable`). The duplicate `ProgressTerminalVTable`
// from B-0 round 1 is removed; tty/ansi/winsize route through the new
// `OutputSinkVTable` slots so `bun_core` stays T0 (no `bun_sys` dep).
pub use crate::output::File;
use crate::output::output_sink;

impl File {
    /// Whether ANSI escape codes are supported — on unix this is `isatty()`;
    /// on Windows it requires `ENABLE_VIRTUAL_TERMINAL_PROCESSING` (set by
    /// `Output.Source.init`). We route through the sink so the platform check
    /// lives in `bun_sys`.
    #[inline]
    pub(crate) fn supports_ansi_escape_codes(self) -> bool {
        #[cfg(windows)]
        {
            // Query the live console
            // mode for ENABLE_VIRTUAL_TERMINAL_PROCESSING — a *capability*
            // check. Do NOT proxy through ENABLE_ANSI_COLORS_STDERR: that is a
            // color-*preference* flag (NO_COLOR/FORCE_COLOR/tty) and never
            // inspects whether SetConsoleMode(VT) actually succeeded, so it
            // would pick the wrong branch in `Progress::start` on legacy
            // conhost (emit raw escapes) or under NO_COLOR on a VT terminal
            // (force the SetConsoleCursorPosition path).
            let mut mode: windows::DWORD = 0;
            GetConsoleMode(self.console_handle(), &mut mode) != 0
                && (mode & windows::ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0
        }
        #[cfg(not(windows))]
        {
            output_sink().is_terminal(self.fd())
        }
    }
    #[inline]
    #[cfg(windows)]
    pub(crate) fn is_tty(self) -> bool {
        output_sink().is_terminal(self.fd())
    }
    /// Windows console HANDLE for the legacy `SetConsoleCursorPosition` path.
    #[cfg(windows)]
    #[inline]
    pub(crate) fn console_handle(&self) -> *mut core::ffi::c_void {
        self.fd().native()
    }
    #[inline]
    pub fn winsize(self) -> Option<crate::Winsize> {
        output_sink().tty_winsize(self.fd())
    }
}

use crate::time::NS_PER_MS;

/// How many nanoseconds to keep the output hidden
const INITIAL_DELAY_NS: u64 = 500 * NS_PER_MS;

pub struct Progress {
    /// `None` if the current node (and its children) should
    /// not print on update()
    terminal: Cell<Option<File>>,

    /// Whether the terminal supports ANSI escape codes.
    pub supports_ansi_escape_codes: bool,

    /// Indexed by [`NodeId`].
    nodes: [Node; 4],

    /// The child that is shown after the root.
    recently_updated_child: Cell<Option<NodeId>>,

    /// Keeps track of how much time has passed since the beginning.
    /// Used to compare with `INITIAL_DELAY_NS` and `refresh_rate_ns`.
    timer: Option<Instant>,

    /// When the previous refresh was written to the terminal.
    /// Used to compare with `refresh_rate_ns`.
    prev_refresh_timestamp: Cell<u64>,

    /// How many nanoseconds between writing updates to the terminal.
    pub refresh_rate_ns: u64,

    done: Cell<bool>,

    /// Keeps track of how many columns in the terminal have been output, so that
    /// we can move the cursor back later.
    columns_written: Cell<usize>,
}

impl Default for Progress {
    fn default() -> Self {
        Self {
            terminal: Cell::new(None),
            supports_ansi_escape_codes: false,
            nodes: Default::default(),
            recently_updated_child: Cell::new(None),
            timer: None,
            prev_refresh_timestamp: Cell::new(0),
            refresh_rate_ns: 50 * NS_PER_MS,
            done: Cell::new(true),
            columns_written: Cell::new(0),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Unit {
    #[default]
    None,
    Files,
    Bytes,
}

/// The root, and the children that `bun install` gives it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NodeId {
    Root,
    Downloads,
    Install,
    Scripts,
}

/// The maximum number of bytes written to the terminal with each refresh.
type OutputBuffer = [u8; 100];

/// Longer than an [`OutputBuffer`], so that a name that was cut short is shown as cut short.
const MAX_NAME_LEN: usize = 128;

/// Represents one unit of progress.
pub struct Node {
    name: Cell<[u8; MAX_NAME_LEN]>,
    name_len: Cell<u8>,
    pub unit: Cell<Unit>,
    /// 0 means unknown.
    pub estimated_total_items: Cell<usize>,
    pub completed_items: Cell<usize>,
}

impl Default for Node {
    fn default() -> Self {
        Self {
            name: Cell::new([0; _]),
            name_len: Cell::new(0),
            unit: Cell::new(Unit::None),
            estimated_total_items: Cell::new(0),
            completed_items: Cell::new(0),
        }
    }
}

impl Node {
    pub fn set_name(&self, name: &[u8]) {
        self.name_len.set(0);
        self.append_to_name(name);
    }

    pub fn append_to_name(&self, text: &[u8]) {
        let len = usize::from(self.name_len.get());
        let spare = &self.name.as_array_of_cells()[len..];
        let text = strings::truncate_to_char_boundary(text, spare.len());
        for (slot, &byte) in spare.iter().zip(text) {
            slot.set(byte);
        }
        self.name_len.set((len + text.len()) as u8);
    }

    fn start(&self, name: &[u8], estimated_total_items: usize) {
        self.set_name(name);
        self.unit.set(Unit::None);
        self.estimated_total_items.set(estimated_total_items);
        self.completed_items.set(0);
    }
}

impl Progress {
    /// Start the root node. Call `end` when done.
    /// `estimated_total_items` value of 0 means unknown.
    pub fn start(&mut self, name: &[u8], estimated_total_items: usize) {
        let stderr = File::stderr();
        self.terminal.set(None);
        if stderr.supports_ansi_escape_codes() {
            self.terminal.set(Some(stderr));
            self.supports_ansi_escape_codes = true;
        } else {
            #[cfg(windows)]
            if stderr.is_tty() {
                self.terminal.set(Some(stderr));
            }
            #[cfg(not(windows))]
            {
                // we are in a "dumb" terminal like in acme or writing to a file
                self.terminal.set(Some(stderr));
            }
        }
        self.root().start(name, estimated_total_items);
        self.recently_updated_child.set(None);
        self.columns_written.set(0);
        self.prev_refresh_timestamp.set(0);
        self.timer = Some(Instant::now());
        self.done.set(false);
    }

    /// `child` is shown after its first `activate` or `complete_one`.
    pub fn start_child(&self, child: NodeId, name: &[u8], estimated_total_items: usize) {
        debug_assert!(child != NodeId::Root);
        self.node(child).start(name, estimated_total_items);
    }

    #[inline]
    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id as usize]
    }

    #[inline]
    pub fn root(&self) -> &Node {
        self.node(NodeId::Root)
    }

    pub fn complete_one(&self, id: NodeId) {
        if id != NodeId::Root {
            self.recently_updated_child.set(Some(id));
        }
        self.node(id).completed_items.update(|items| items + 1);
        self.maybe_refresh();
    }

    /// Finish the root node.
    pub fn end(&self) {
        self.maybe_refresh();
        self.done.set(true);
        self.refresh();
    }

    pub fn end_child(&self, child: NodeId) {
        self.maybe_refresh();
        if self.recently_updated_child.get() == Some(child) {
            self.recently_updated_child.set(None);
        }
        self.complete_one(NodeId::Root);
    }

    /// This node is actively being worked on.
    pub fn activate(&self, id: NodeId) {
        if id != NodeId::Root {
            self.recently_updated_child.set(Some(id));
            self.maybe_refresh();
        }
    }

    /// Updates the terminal if enough time has passed since last update.
    pub fn maybe_refresh(&self) {
        let Some(timer) = self.timer else {
            return;
        };
        let now = u64::try_from(timer.elapsed().as_nanos()).expect("int cast");
        if now < INITIAL_DELAY_NS {
            return;
        }
        // TODO I have observed this to happen sometimes. I think we need to follow Rust's
        // lead and guarantee monotonically increasing times in the std lib itself.
        if now < self.prev_refresh_timestamp.get() {
            return;
        }
        if now - self.prev_refresh_timestamp.get() < self.refresh_rate_ns {
            return;
        }
        self.refresh();
    }

    fn clear(&self, buf: &mut OutputBuffer, end_ptr: &mut usize) {
        let Some(file) = self.terminal.get() else {
            return;
        };
        let mut end = *end_ptr;
        if self.columns_written.get() > 0 {
            // restore the cursor position by moving the cursor
            // `columns_written` cells to the left, then clear the rest of the
            // line
            if self.supports_ansi_escape_codes {
                end += super::fmt::buf_print_len(
                    &mut buf[end..],
                    format_args!("\x1b[{}D", self.columns_written.get()),
                )
                .expect("unreachable");
                end += super::fmt::buf_print_len(&mut buf[end..], format_args!("\x1b[0K"))
                    .expect("unreachable");
            } else {
                #[cfg(windows)]
                'winapi: {
                    let mut info: windows::CONSOLE_SCREEN_BUFFER_INFO = crate::ffi::zeroed();
                    if GetConsoleScreenBufferInfo(file.console_handle(), &mut info) != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal.set(None);
                        break 'winapi;
                    }

                    let mut cursor_pos = windows::COORD {
                        X: info.dwCursorPosition.X
                            - windows::SHORT::try_from(self.columns_written.get()).unwrap(),
                        Y: info.dwCursorPosition.Y,
                    };

                    if cursor_pos.X < 0 {
                        cursor_pos.X = 0;
                    }

                    let fill_chars =
                        windows::DWORD::try_from(info.dwSize.X - cursor_pos.X).unwrap();

                    let mut written: windows::DWORD = 0;
                    if FillConsoleOutputAttribute(
                        file.console_handle(),
                        info.wAttributes,
                        fill_chars,
                        cursor_pos,
                        &mut written,
                    ) != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal.set(None);
                        break 'winapi;
                    }
                    if FillConsoleOutputCharacterW(
                        file.console_handle(),
                        b' ' as u16,
                        fill_chars,
                        cursor_pos,
                        &mut written,
                    ) != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal.set(None);
                        break 'winapi;
                    }
                    if SetConsoleCursorPosition(file.console_handle(), cursor_pos) != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal.set(None);
                        break 'winapi;
                    }
                }
                #[cfg(not(windows))]
                {
                    // we are in a "dumb" terminal like in acme or writing to a file
                    buf[end] = b'\n';
                    end += 1;
                }
            }

            self.columns_written.set(0);
        }
        let _ = file;
        *end_ptr = end;
    }

    /// Updates the terminal and resets `self.prev_refresh_timestamp`.
    pub fn refresh(&self) {
        let Some(file) = self.terminal.get() else {
            return;
        };

        let buf = &mut [0; _];
        let mut end: usize = 0;
        self.clear(buf, &mut end);

        if !self.done.get() {
            let mut need_ellipse = false;
            for id in core::iter::once(NodeId::Root).chain(self.recently_updated_child.get()) {
                let node = self.node(id);
                let name = node.name.get();
                let name = &name[..usize::from(node.name_len.get())];
                let unit = node.unit.get();
                let eti = node.estimated_total_items.get();
                let completed_items = node.completed_items.get();
                let current_item = completed_items + 1;

                if need_ellipse {
                    self.buf_write(buf, &mut end, format_args!("... "));
                }
                need_ellipse = false;
                if !name.is_empty() || eti > 0 {
                    if !name.is_empty() {
                        self.buf_write(buf, &mut end, format_args!("{}", bstr::BStr::new(name)));
                        need_ellipse = true;
                    }
                    if eti > 0 {
                        if need_ellipse {
                            self.buf_write(buf, &mut end, format_args!(" "));
                        }
                        match unit {
                            Unit::None => self.buf_write(
                                buf,
                                &mut end,
                                format_args!("[{}/{}] ", current_item, eti),
                            ),
                            Unit::Files => self.buf_write(
                                buf,
                                &mut end,
                                format_args!("[{}/{} files] ", current_item, eti),
                            ),
                            // Raw byte counts are printed until an IEC-units
                            // (KiB/MiB) formatting helper lands.
                            Unit::Bytes => self.buf_write(
                                buf,
                                &mut end,
                                format_args!("[{}/{}] ", current_item, eti),
                            ),
                        }
                        need_ellipse = false;
                    } else if completed_items != 0 {
                        if need_ellipse {
                            self.buf_write(buf, &mut end, format_args!(" "));
                        }
                        match unit {
                            Unit::None => {
                                self.buf_write(buf, &mut end, format_args!("[{}] ", current_item))
                            }
                            Unit::Files => self.buf_write(
                                buf,
                                &mut end,
                                format_args!("[{} files] ", current_item),
                            ),
                            // Raw byte counts; see the note above.
                            Unit::Bytes => {
                                self.buf_write(buf, &mut end, format_args!("[{}] ", current_item))
                            }
                        }
                        need_ellipse = false;
                    }
                }
            }
            if need_ellipse {
                self.buf_write(buf, &mut end, format_args!("... "));
            }
        }

        if file.write(&buf[0..end]).is_err() {
            // stop trying to write to this file
            self.terminal.set(None);
        }
        if let Some(timer) = self.timer {
            self.prev_refresh_timestamp
                .set(u64::try_from(timer.elapsed().as_nanos()).expect("int cast"));
        }
    }

    pub fn log(&self, args: fmt::Arguments<'_>) {
        let Some(file) = self.terminal.get() else {
            let _ = File::stderr().write_fmt(args);
            return;
        };
        self.refresh();
        if file.write_fmt(args).is_err() {
            self.terminal.set(None);
            return;
        }
        self.columns_written.set(0);
    }

    fn buf_write(&self, buf: &mut OutputBuffer, end: &mut usize, args: fmt::Arguments<'_>) {
        let mut cursor = &mut buf[*end..];
        let before = cursor.len();
        match cursor.write_fmt(args) {
            Ok(()) => {
                let amt = before - cursor.len();
                *end += amt;
                self.columns_written.update(|columns| columns + amt);
            }
            Err(_) => {
                // error.NoSpaceLeft
                self.columns_written.update(|columns| columns + before);
                *end = buf.len();
                const SUFFIX: &[u8] = b"... ";
                let dst_start = buf.len() - SUFFIX.len();
                buf[dst_start..].copy_from_slice(SUFFIX);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    #[ignore = "uses thread::sleep() and is therefore slow; also prints bogus progress data to stderr"]
    fn basic_functionality() {
        let mut progress = Progress::default();
        progress.start(b"", 100);
        let node = NodeId::Install;

        let speed_factor = NS_PER_MS;

        let sub_task_names: [&'static [u8]; 4] = [
            b"reticulating splines",
            b"adjusting shoes",
            b"climbing towers",
            b"pouring juice",
        ];
        let mut next_sub_task: usize = 0;

        let mut i: usize = 0;
        while i < 100 {
            progress.start_child(node, sub_task_names[next_sub_task], 5);
            progress.activate(node);
            next_sub_task = (next_sub_task + 1) % sub_task_names.len();

            progress.complete_one(node);
            thread::sleep(Duration::from_nanos(5 * speed_factor));
            progress.complete_one(node);
            progress.complete_one(node);
            thread::sleep(Duration::from_nanos(5 * speed_factor));
            progress.complete_one(node);
            progress.complete_one(node);
            thread::sleep(Duration::from_nanos(5 * speed_factor));

            progress.end_child(node);

            thread::sleep(Duration::from_nanos(5 * speed_factor));
            i += 1;
        }
        {
            progress.start_child(
                node,
                b"this is a really long name designed to activate the truncation code. let's find out if it works",
                0,
            );
            progress.activate(node);
            thread::sleep(Duration::from_nanos(10 * speed_factor));
            progress.refresh();
            thread::sleep(Duration::from_nanos(10 * speed_factor));
            progress.end_child(node);
        }
        progress.end();
    }
}
