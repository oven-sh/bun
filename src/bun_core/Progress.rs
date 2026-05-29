//! This is a snapshot of the Zig std.Progress API before it's rewrite in 0.13
//! We use this API for the progress in Bun install and some other places.
//!
//! TODO: It would be worth considering using our own progress indicator for
//! Bun install, as this bar only shows the most recent action.
//!
//! https://github.com/ziglang/zig/blob/0.12.0/lib/std/Progress.zig
//!
//! This API is non-allocating, non-fallible, and thread-safe.
//! The tradeoff is that users of this API must provide the storage
//! for each `Progress.Node`.
//!
//! Initialize the struct directly, overriding these fields as desired:
//! * `refresh_rate_ms`
//! * `initial_delay_ms`

use core::fmt;
use core::ptr;
use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};
use std::io::Write as _;
use std::time::Instant;

use crate::Mutex;
#[cfg(windows)]
use crate::windows_sys as windows;

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

pub use crate::output::File;
use crate::output::output_sink;

impl File {
    #[inline]
    pub fn supports_ansi_escape_codes(self) -> bool {
        #[cfg(windows)]
        {
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
    pub fn is_tty(self) -> bool {
        output_sink().is_terminal(self.fd())
    }
    /// Windows console HANDLE for the legacy `SetConsoleCursorPosition` path.
    #[cfg(windows)]
    #[inline]
    pub fn console_handle(&self) -> *mut core::ffi::c_void {
        self.fd().native()
    }
    #[inline]
    pub fn winsize(self) -> Option<crate::Winsize> {
        output_sink().tty_winsize(self.fd())
    }
}

use crate::time::NS_PER_MS;

pub struct Progress {
    /// `None` if the current node (and its children) should
    /// not print on update()
    pub terminal: Option<File>,

    /// Is this a windows API terminal (note: this is not the same as being run on windows
    /// because other terminals exist like MSYS/git-bash)
    pub is_windows_terminal: bool,

    /// Whether the terminal supports ANSI escape codes.
    pub supports_ansi_escape_codes: bool,

    pub dont_print_on_dumb: bool,

    pub root: Node,

    /// Keeps track of how much time has passed since the beginning.
    /// Used to compare with `initial_delay_ms` and `refresh_rate_ms`.
    pub timer: Option<Instant>,

    /// When the previous refresh was written to the terminal.
    /// Used to compare with `refresh_rate_ms`.
    pub prev_refresh_timestamp: u64,

    /// This buffer represents the maximum number of bytes written to the terminal
    /// with each refresh.
    pub output_buffer: [u8; 100],

    /// How many nanoseconds between writing updates to the terminal.
    pub refresh_rate_ns: u64,

    /// How many nanoseconds to keep the output hidden
    pub initial_delay_ns: u64,

    pub done: bool,

    /// Protects the `refresh` function, as well as `node.recently_updated_child`.
    /// Without this, callsites would call `Node.end` and then free `Node` memory
    /// while it was still being accessed by the `refresh` function.
    pub update_mutex: Mutex<()>,

    /// Keeps track of how many columns in the terminal have been output, so that
    /// we can move the cursor back later.
    pub columns_written: usize,
}

impl Default for Progress {
    fn default() -> Self {
        Self {
            // Zig: `= undefined` — overwritten in `start()`
            terminal: None,
            is_windows_terminal: false,
            supports_ansi_escape_codes: false,
            dont_print_on_dumb: false,
            // Zig: `= undefined` — overwritten in `start()`
            root: Node::default(),
            timer: None,
            // Zig: `= undefined`
            prev_refresh_timestamp: 0,
            // Zig: `= undefined`
            output_buffer: [0; 100],
            refresh_rate_ns: 50 * NS_PER_MS,
            initial_delay_ns: 500 * NS_PER_MS,
            done: true,
            update_mutex: Mutex::new(()),
            // Zig: `= undefined`
            columns_written: 0,
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

/// Represents one unit of progress. Each node can have children nodes, or
/// one can use integers with `update`.
pub struct Node {
    pub context: *mut Progress,
    pub parent: *mut Node,
    // TODO(port): lifetime — caller-borrowed slice, Zig is non-allocating; using
    // 'static here as a placeholder (callers in install/ pass string literals).
    pub name: &'static [u8],
    pub unit: Unit,
    /// Must be handled atomically to be thread-safe.
    pub recently_updated_child: AtomicPtr<Node>,
    /// Must be handled atomically to be thread-safe. 0 means null.
    pub unprotected_estimated_total_items: AtomicUsize,
    /// Must be handled atomically to be thread-safe.
    pub unprotected_completed_items: AtomicUsize,
}

impl Default for Node {
    fn default() -> Self {
        Self {
            context: ptr::null_mut(),
            parent: ptr::null_mut(),
            name: b"",
            unit: Unit::None,
            recently_updated_child: AtomicPtr::new(ptr::null_mut()),
            unprotected_estimated_total_items: AtomicUsize::new(0),
            unprotected_completed_items: AtomicUsize::new(0),
        }
    }
}

impl Node {
    #[inline]
    pub fn context_ptr(&self) -> *mut Progress {
        self.context
    }

    #[inline]
    pub fn parent(&self) -> Option<&Node> {
        // SAFETY: parent backref points into caller-provided storage that
        // outlives this node per the non-allocating API contract (see module
        // docs); null only for the root node.
        unsafe { self.parent.as_ref() }
    }

    /// Raw pointer to the parent node for paths that must mutate it
    /// (e.g. `end` → `parent.complete_one`, which re-enters `maybe_refresh`).
    /// See [`context_ptr`](Self::context_ptr) for the aliasing rationale.
    #[inline]
    pub fn parent_ptr(&self) -> *mut Node {
        self.parent
    }

    pub fn start(&mut self, name: &'static [u8], estimated_total_items: usize) -> Node {
        Node {
            context: self.context,
            parent: std::ptr::from_mut::<Node>(self),
            name,
            unit: Unit::None,
            recently_updated_child: AtomicPtr::new(ptr::null_mut()),
            unprotected_estimated_total_items: AtomicUsize::new(estimated_total_items),
            unprotected_completed_items: AtomicUsize::new(0),
        }
    }

    /// This is the same as calling `start` and then `end` on the returned `Node`. Thread-safe.
    pub fn complete_one(&mut self) {
        let self_ptr: *mut Node = self;
        if let Some(parent) = self.parent() {
            parent
                .recently_updated_child
                .store(self_ptr, Ordering::Release);
        }
        self.unprotected_completed_items
            .fetch_add(1, Ordering::Relaxed);
        // SAFETY: see `context_ptr` — `&mut Progress` would alias the node tree.
        unsafe { (*self.context_ptr()).maybe_refresh() };
    }

    /// Finish a started `Node`. Thread-safe.
    pub fn end(&mut self) {
        // SAFETY: see `context_ptr` — `&mut Progress` would alias the node tree.
        let context = unsafe { &mut *self.context_ptr() };
        context.maybe_refresh();
        // SAFETY: parent backref valid; `complete_one` below needs `&mut` and
        // re-enters `maybe_refresh`, so this stays a raw deref (see `parent_ptr`).
        if let Some(parent) = unsafe { self.parent_ptr().as_mut() } {
            {
                let _g = context.update_mutex.lock();
                let _ = parent.recently_updated_child.compare_exchange(
                    std::ptr::from_mut::<Node>(self),
                    ptr::null_mut(),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
            }
            parent.complete_one();
        } else {
            // PORT NOTE: reshaped for borrowck — guard borrows context.update_mutex;
            // we capture a raw ptr first so the &mut access goes through *mut.
            let ctx_ptr = std::ptr::from_mut::<Progress>(context);
            let _g = context.update_mutex.lock();
            // SAFETY: ctx_ptr derived from &mut; guard only references the mutex field.
            unsafe {
                (*ctx_ptr).done = true;
                (*ctx_ptr).refresh_with_held_lock();
            }
        }
    }

    /// Tell the parent node that this node is actively being worked on. Thread-safe.
    pub fn activate(&mut self) {
        let self_ptr: *mut Node = self;
        let ctx_ptr = self.context_ptr();
        if let Some(parent) = self.parent() {
            parent
                .recently_updated_child
                .store(self_ptr, Ordering::Release);
            // SAFETY: see `context_ptr` — `&mut Progress` would alias the node tree.
            unsafe { (*ctx_ptr).maybe_refresh() };
        }
    }

    /// Thread-safe.
    pub fn set_name(&mut self, name: &'static [u8]) {
        let ctx_ptr = self.context_ptr();
        // SAFETY: see `context_ptr` — `&mut Progress` would alias the node tree.
        let progress = unsafe { &mut *ctx_ptr };
        // `timer` is `Copy` and write-once (set in `Progress::start` before any
        // child node exists); read it through the live `&mut Progress` instead
        // of a second raw `(*ctx_ptr).timer` deref later.
        let timer = progress.timer;
        let _g = progress.update_mutex.lock();
        self.name = name;
        let self_ptr: *mut Node = self;
        let parent_ptr = self.parent_ptr();
        if let Some(parent) = self.parent() {
            parent
                .recently_updated_child
                .store(self_ptr, Ordering::Release);
            if let Some(grand_parent) = parent.parent() {
                grand_parent
                    .recently_updated_child
                    .store(parent_ptr, Ordering::Release);
            }
            if let Some(timer) = timer {
                // SAFETY: ctx_ptr from &mut; guard borrows only the mutex field.
                unsafe { (*ctx_ptr).maybe_refresh_with_held_lock(timer) };
            }
        }
    }

    /// Thread-safe.
    pub fn set_unit(&mut self, unit: Unit) {
        // TODO(port): Zig signature was `unit: []const u8` assigned to an enum field —
        // dead code in Zig (lazy compilation never type-checked it). Ported with the
        // enum type to keep it well-typed; revisit if any caller appears.
        let ctx_ptr = self.context_ptr();
        // SAFETY: see `context_ptr` — `&mut Progress` would alias the node tree.
        let progress = unsafe { &mut *ctx_ptr };
        // See `set_name` — `timer` is write-once `Copy`; hoist the read.
        let timer = progress.timer;
        let _g = progress.update_mutex.lock();
        self.unit = unit;
        let self_ptr: *mut Node = self;
        let parent_ptr = self.parent_ptr();
        if let Some(parent) = self.parent() {
            parent
                .recently_updated_child
                .store(self_ptr, Ordering::Release);
            if let Some(grand_parent) = parent.parent() {
                grand_parent
                    .recently_updated_child
                    .store(parent_ptr, Ordering::Release);
            }
            if let Some(timer) = timer {
                // SAFETY: ctx_ptr from &mut; guard borrows only the mutex field.
                unsafe { (*ctx_ptr).maybe_refresh_with_held_lock(timer) };
            }
        }
    }

    /// Thread-safe. 0 means unknown.
    pub fn set_estimated_total_items(&self, count: usize) {
        self.unprotected_estimated_total_items
            .store(count, Ordering::Relaxed);
    }

    /// Thread-safe.
    pub fn set_completed_items(&self, completed_items: usize) {
        self.unprotected_completed_items
            .store(completed_items, Ordering::Relaxed);
    }
}

impl Progress {
    pub fn start(&mut self, name: &'static [u8], estimated_total_items: usize) -> &mut Node {
        // TODO(port): std.fs.File.stderr() / supportsAnsiEscapeCodes() / isTty() —
        // map to bun_sys::File equivalents.
        let stderr = File::stderr();
        self.terminal = None;
        if stderr.supports_ansi_escape_codes() {
            self.terminal = Some(stderr);
            self.supports_ansi_escape_codes = true;
        } else {
            #[cfg(windows)]
            if stderr.is_tty() {
                self.is_windows_terminal = true;
                self.terminal = Some(stderr);
            }
            #[cfg(not(windows))]
            {
                // we are in a "dumb" terminal like in acme or writing to a file
                self.terminal = Some(stderr);
            }
        }
        self.root = Node {
            context: std::ptr::from_mut::<Progress>(self),
            parent: ptr::null_mut(),
            name,
            unit: Unit::None,
            recently_updated_child: AtomicPtr::new(ptr::null_mut()),
            unprotected_estimated_total_items: AtomicUsize::new(estimated_total_items),
            unprotected_completed_items: AtomicUsize::new(0),
        };
        self.columns_written = 0;
        self.prev_refresh_timestamp = 0;
        // Zig: std.time.Timer.start() catch null — Instant::now() is infallible.
        self.timer = Some(Instant::now());
        self.done = false;
        &mut self.root
    }

    /// Updates the terminal if enough time has passed since last update. Thread-safe.
    pub fn maybe_refresh(&mut self) {
        // PORT NOTE: reshaped for borrowck — Instant is Copy, captured by value.
        if let Some(timer) = self.timer {
            // PORT NOTE: reshaped for borrowck — capture *mut self before the
            // guard borrows update_mutex.
            let ctx_ptr = std::ptr::from_mut::<Self>(self);
            let Some(_g) = self.update_mutex.try_lock() else {
                return;
            };
            // SAFETY: ctx_ptr from &mut self; guard only references the mutex field.
            unsafe { (*ctx_ptr).maybe_refresh_with_held_lock(timer) };
        }
    }

    fn maybe_refresh_with_held_lock(&mut self, timer: Instant) {
        // Zig: timer.read() returns ns since start.
        let now = u64::try_from(timer.elapsed().as_nanos()).expect("int cast");
        if now < self.initial_delay_ns {
            return;
        }
        // TODO I have observed this to happen sometimes. I think we need to follow Rust's
        // lead and guarantee monotonically increasing times in the std lib itself.
        if now < self.prev_refresh_timestamp {
            return;
        }
        if now - self.prev_refresh_timestamp < self.refresh_rate_ns {
            return;
        }
        self.refresh_with_held_lock();
    }

    /// Updates the terminal and resets `self.next_refresh_timestamp`. Thread-safe.
    pub fn refresh(&mut self) {
        let ctx_ptr = std::ptr::from_mut::<Self>(self);
        let Some(_g) = self.update_mutex.try_lock() else {
            return;
        };
        // SAFETY: ctx_ptr from &mut self; guard only references the mutex field.
        unsafe { (*ctx_ptr).refresh_with_held_lock() };
    }

    fn clear_with_held_lock(&mut self, end_ptr: &mut usize) {
        let Some(file) = self.terminal else {
            return;
        };
        let mut end = *end_ptr;
        if self.columns_written > 0 {
            // restore the cursor position by moving the cursor
            // `columns_written` cells to the left, then clear the rest of the
            // line
            if self.supports_ansi_escape_codes {
                end += super::fmt::buf_print_len(
                    &mut self.output_buffer[end..],
                    format_args!("\x1b[{}D", self.columns_written),
                )
                .expect("unreachable");
                end += super::fmt::buf_print_len(
                    &mut self.output_buffer[end..],
                    format_args!("\x1b[0K"),
                )
                .expect("unreachable");
            } else {
                #[cfg(windows)]
                'winapi: {
                    debug_assert!(self.is_windows_terminal);

                    // TODO(port): verify bun_sys::windows::CONSOLE_SCREEN_BUFFER_INFO layout & kernel32 bindings.
                    let mut info: windows::CONSOLE_SCREEN_BUFFER_INFO = crate::ffi::zeroed();
                    if GetConsoleScreenBufferInfo(file.console_handle(), &mut info) != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal = None;
                        break 'winapi;
                    }

                    let mut cursor_pos = windows::COORD {
                        X: info.dwCursorPosition.X
                            - windows::SHORT::try_from(self.columns_written).unwrap(),
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
                        self.terminal = None;
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
                        self.terminal = None;
                        break 'winapi;
                    }
                    if SetConsoleCursorPosition(file.console_handle(), cursor_pos) != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal = None;
                        break 'winapi;
                    }
                }
                #[cfg(not(windows))]
                {
                    // we are in a "dumb" terminal like in acme or writing to a file
                    self.output_buffer[end] = b'\n';
                    end += 1;
                }
            }

            self.columns_written = 0;
        }
        let _ = file;
        *end_ptr = end;
    }

    fn refresh_with_held_lock(&mut self) {
        let is_dumb = !self.supports_ansi_escape_codes && !self.is_windows_terminal;
        if is_dumb && self.dont_print_on_dumb {
            return;
        }

        let Some(file) = self.terminal else {
            return;
        };

        let mut end: usize = 0;
        self.clear_with_held_lock(&mut end);

        if !self.done {
            let mut need_ellipse = false;
            let mut maybe_node: *mut Node = &raw mut self.root;
            while !maybe_node.is_null() {
                let (name, unit, eti, completed_items);
                // SAFETY: walking the recently_updated_child chain under
                // update_mutex; nodes are caller-owned and outlive this call
                // per API contract. Read every field through the raw pointer
                // and advance `maybe_node` *before* any `self.buf_write` call:
                // on the first iteration `maybe_node` is `&raw mut self.root`,
                // and `buf_write`'s `&mut self` reborrow would invalidate any
                // tag derived from it under Stacked Borrows. (Zig has no
                // aliasing model, so Progress.zig:313-345 holds `node: *Node`
                // across `self.bufWrite` freely; Rust must not.)
                unsafe {
                    name = (*maybe_node).name;
                    unit = (*maybe_node).unit;
                    eti = (*maybe_node)
                        .unprotected_estimated_total_items
                        .load(Ordering::Relaxed);
                    completed_items = (*maybe_node)
                        .unprotected_completed_items
                        .load(Ordering::Relaxed);
                    maybe_node = (*maybe_node).recently_updated_child.load(Ordering::Acquire);
                }
                let current_item = completed_items + 1;

                if need_ellipse {
                    self.buf_write(&mut end, format_args!("... "));
                }
                need_ellipse = false;
                if !name.is_empty() || eti > 0 {
                    if !name.is_empty() {
                        self.buf_write(&mut end, format_args!("{}", crate::fmt::s(name)));
                        need_ellipse = true;
                    }
                    if eti > 0 {
                        if need_ellipse {
                            self.buf_write(&mut end, format_args!(" "));
                        }
                        match unit {
                            Unit::None => self
                                .buf_write(&mut end, format_args!("[{}/{}] ", current_item, eti)),
                            Unit::Files => self.buf_write(
                                &mut end,
                                format_args!("[{}/{} files] ", current_item, eti),
                            ),
                            // TODO(port): Zig `{Bi:.2}` is std.fmt binary-bytes formatter (e.g. "1.50KiB").
                            // Need a bun_core::fmt::BytesBi helper.
                            Unit::Bytes => self
                                .buf_write(&mut end, format_args!("[{}/{}] ", current_item, eti)),
                        }
                        need_ellipse = false;
                    } else if completed_items != 0 {
                        if need_ellipse {
                            self.buf_write(&mut end, format_args!(" "));
                        }
                        match unit {
                            Unit::None => {
                                self.buf_write(&mut end, format_args!("[{}] ", current_item))
                            }
                            Unit::Files => {
                                self.buf_write(&mut end, format_args!("[{} files] ", current_item))
                            }
                            // TODO(port): Zig `{Bi:.2}` binary-bytes formatter.
                            Unit::Bytes => {
                                self.buf_write(&mut end, format_args!("[{}] ", current_item))
                            }
                        }
                        need_ellipse = false;
                    }
                }
            }
            if need_ellipse {
                self.buf_write(&mut end, format_args!("... "));
            }
        }

        if file.write(&self.output_buffer[0..end]).is_err() {
            // stop trying to write to this file
            self.terminal = None;
        }
        if let Some(timer) = self.timer {
            self.prev_refresh_timestamp =
                u64::try_from(timer.elapsed().as_nanos()).expect("int cast");
        }
    }

    pub fn log(&mut self, args: fmt::Arguments<'_>) {
        let Some(file) = self.terminal else {
            // TODO(port): std.debug.print → bun_core::Output debug print equivalent.
            eprint!("{}", args);
            return;
        };
        // TODO(port): Zig `file.writerStreaming(&.{})` — map to bun_sys::File writer.
        self.refresh();
        if file.write_fmt(args).is_err() {
            self.terminal = None;
            return;
        }
        self.columns_written = 0;
    }

    pub fn lock_stderr(&mut self) {
        let ctx_ptr = std::ptr::from_mut::<Self>(self);
        let _g = self.update_mutex.lock();
        // SAFETY: ctx_ptr from &mut self; guard only references the mutex field
        // (same disjoint-field pattern as `refresh`/`maybe_refresh` above).
        let this = unsafe { &mut *ctx_ptr };
        if let Some(file) = this.terminal {
            let mut end: usize = 0;
            this.clear_with_held_lock(&mut end);
            if file.write(&this.output_buffer[0..end]).is_err() {
                // stop trying to write to this file
                this.terminal = None;
            }
        }
        // `_g` drops here; lock is NOT held past return — see PORT NOTE above.
        // TODO(port): std.debug.getStderrMutex().lock() — need a global stderr mutex in bun_core.
    }

    pub fn unlock_stderr(&mut self) {
        // TODO(port): std.debug.getStderrMutex().unlock() — see lock_stderr.
        // No-op; see PORT NOTE on `lock_stderr`.
        let _ = self;
    }

    fn buf_write(&mut self, end: &mut usize, args: fmt::Arguments<'_>) {
        let mut cursor = &mut self.output_buffer[*end..];
        let before = cursor.len();
        match cursor.write_fmt(args) {
            Ok(()) => {
                let amt = before - cursor.len();
                *end += amt;
                self.columns_written += amt;
            }
            Err(_) => {
                // error.NoSpaceLeft
                self.columns_written += self.output_buffer.len() - *end;
                *end = self.output_buffer.len();
                const SUFFIX: &[u8] = b"... ";
                let dst_start = self.output_buffer.len() - SUFFIX.len();
                self.output_buffer[dst_start..].copy_from_slice(SUFFIX);
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
        let root_node = progress.start(b"", 100);

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
            let mut node = root_node.start(sub_task_names[next_sub_task], 5);
            node.activate();
            next_sub_task = (next_sub_task + 1) % sub_task_names.len();

            node.complete_one();
            thread::sleep(Duration::from_nanos(5 * speed_factor));
            node.complete_one();
            node.complete_one();
            thread::sleep(Duration::from_nanos(5 * speed_factor));
            node.complete_one();
            node.complete_one();
            thread::sleep(Duration::from_nanos(5 * speed_factor));

            node.end();

            thread::sleep(Duration::from_nanos(5 * speed_factor));
            i += 1;
        }
        {
            let mut node = root_node.start(
                b"this is a really long name designed to activate the truncation code. let's find out if it works",
                0,
            );
            node.activate();
            thread::sleep(Duration::from_nanos(10 * speed_factor));
            // PORT NOTE: reshaped for borrowck — cannot borrow `progress` while `root_node`
            // (a &mut into progress.root) is live; refresh via the node's context backref.
            // SAFETY: see `context_ptr` — `&mut Progress` would alias the node tree.
            unsafe { (*node.context_ptr()).refresh() };
            thread::sleep(Duration::from_nanos(10 * speed_factor));
            node.end();
        }
        root_node.end();
    }
}

// ported from: src/bun_core/Progress.zig
