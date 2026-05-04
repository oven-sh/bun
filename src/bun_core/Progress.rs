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

use bun_sys::File;
use bun_threading::Mutex;
#[cfg(windows)]
use bun_sys::windows;

const NS_PER_MS: u64 = 1_000_000;

pub struct Progress {
    /// `None` if the current node (and its children) should
    /// not print on update()
    pub terminal: Option<File>,

    /// Is this a windows API terminal (note: this is not the same as being run on windows
    /// because other terminals exist like MSYS/git-bash)
    pub is_windows_terminal: bool,

    /// Whether the terminal supports ANSI escape codes.
    pub supports_ansi_escape_codes: bool,

    /// If the terminal is "dumb", don't print output.
    /// This can be useful if you don't want to print all
    /// the stages of code generation if there are a lot.
    /// You should not use it if the user should see output
    /// for example showing the user what tests run.
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
    pub update_mutex: Mutex,

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
            update_mutex: Mutex::default(),
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
    // 'static here as a Phase-A placeholder (callers in install/ pass string literals).
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
    /// Create a new child progress node. Thread-safe.
    /// Call `Node.end` when done.
    /// TODO solve https://github.com/ziglang/zig/issues/2765 and then change this
    /// API to set `self.parent.recently_updated_child` with the return value.
    /// Until that is fixed you probably want to call `activate` on the return value.
    /// Passing 0 for `estimated_total_items` means unknown.
    pub fn start(&mut self, name: &'static [u8], estimated_total_items: usize) -> Node {
        Node {
            context: self.context,
            parent: self as *mut Node,
            name,
            unit: Unit::None,
            recently_updated_child: AtomicPtr::new(ptr::null_mut()),
            unprotected_estimated_total_items: AtomicUsize::new(estimated_total_items),
            unprotected_completed_items: AtomicUsize::new(0),
        }
    }

    /// This is the same as calling `start` and then `end` on the returned `Node`. Thread-safe.
    pub fn complete_one(&mut self) {
        // SAFETY: parent backref is valid for the lifetime of this Node (caller-provided storage).
        if let Some(parent) = unsafe { self.parent.as_mut() } {
            parent
                .recently_updated_child
                .store(self as *mut Node, Ordering::Release);
        }
        self.unprotected_completed_items
            .fetch_add(1, Ordering::Relaxed);
        // SAFETY: context backref set in `Progress::start`, valid while Progress lives.
        unsafe { &mut *self.context }.maybe_refresh();
    }

    /// Finish a started `Node`. Thread-safe.
    pub fn end(&mut self) {
        // SAFETY: context backref set in `Progress::start`, valid while Progress lives.
        let context = unsafe { &mut *self.context };
        context.maybe_refresh();
        // SAFETY: parent backref is valid for the lifetime of this Node.
        if let Some(parent) = unsafe { self.parent.as_mut() } {
            {
                context.update_mutex.lock();
                // PORT NOTE: `defer unlock` → explicit unlock at scope end below.
                let _ = parent.recently_updated_child.compare_exchange(
                    self as *mut Node,
                    ptr::null_mut(),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
                context.update_mutex.unlock();
            }
            parent.complete_one();
        } else {
            context.update_mutex.lock();
            context.done = true;
            context.refresh_with_held_lock();
            context.update_mutex.unlock();
        }
    }

    /// Tell the parent node that this node is actively being worked on. Thread-safe.
    pub fn activate(&mut self) {
        // SAFETY: parent backref is valid for the lifetime of this Node.
        if let Some(parent) = unsafe { self.parent.as_mut() } {
            parent
                .recently_updated_child
                .store(self as *mut Node, Ordering::Release);
            // SAFETY: context backref valid while Progress lives.
            unsafe { &mut *self.context }.maybe_refresh();
        }
    }

    /// Thread-safe.
    pub fn set_name(&mut self, name: &'static [u8]) {
        // SAFETY: context backref valid while Progress lives.
        let progress = unsafe { &mut *self.context };
        progress.update_mutex.lock();
        self.name = name;
        // SAFETY: parent backref is valid for the lifetime of this Node.
        if let Some(parent) = unsafe { self.parent.as_mut() } {
            parent
                .recently_updated_child
                .store(self as *mut Node, Ordering::Release);
            // SAFETY: parent.parent backref is valid for the lifetime of parent.
            if let Some(grand_parent) = unsafe { parent.parent.as_mut() } {
                grand_parent
                    .recently_updated_child
                    .store(parent as *mut Node, Ordering::Release);
            }
            // PORT NOTE: reshaped for borrowck — Instant is Copy, captured by value.
            if let Some(timer) = progress.timer {
                progress.maybe_refresh_with_held_lock(timer);
            }
        }
        progress.update_mutex.unlock();
    }

    /// Thread-safe.
    pub fn set_unit(&mut self, unit: Unit) {
        // TODO(port): Zig signature was `unit: []const u8` assigned to an enum field —
        // dead code in Zig (lazy compilation never type-checked it). Ported with the
        // enum type to keep it well-typed; revisit if any caller appears.
        // SAFETY: context backref valid while Progress lives.
        let progress = unsafe { &mut *self.context };
        progress.update_mutex.lock();
        self.unit = unit;
        // SAFETY: parent backref is valid for the lifetime of this Node.
        if let Some(parent) = unsafe { self.parent.as_mut() } {
            parent
                .recently_updated_child
                .store(self as *mut Node, Ordering::Release);
            // SAFETY: parent.parent backref is valid for the lifetime of parent.
            if let Some(grand_parent) = unsafe { parent.parent.as_mut() } {
                grand_parent
                    .recently_updated_child
                    .store(parent as *mut Node, Ordering::Release);
            }
            // PORT NOTE: reshaped for borrowck — Instant is Copy, captured by value.
            if let Some(timer) = progress.timer {
                progress.maybe_refresh_with_held_lock(timer);
            }
        }
        progress.update_mutex.unlock();
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
    /// Create a new progress node.
    /// Call `Node.end` when done.
    /// TODO solve https://github.com/ziglang/zig/issues/2765 and then change this
    /// API to return Progress rather than accept it as a parameter.
    /// `estimated_total_items` value of 0 means unknown.
    pub fn start(&mut self, name: &'static [u8], estimated_total_items: usize) -> &mut Node {
        // TODO(port): std.fs.File.stderr() / supportsAnsiEscapeCodes() / isTty() —
        // map to bun_sys::File equivalents in Phase B.
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
            context: self as *mut Progress,
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
            if !self.update_mutex.try_lock() {
                return;
            }
            self.maybe_refresh_with_held_lock(timer);
            self.update_mutex.unlock();
        }
    }

    fn maybe_refresh_with_held_lock(&mut self, timer: Instant) {
        // Zig: timer.read() returns ns since start.
        let now = u64::try_from(timer.elapsed().as_nanos()).unwrap();
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
        if !self.update_mutex.try_lock() {
            return;
        }
        self.refresh_with_held_lock();
        self.update_mutex.unlock();
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
                end += buf_print(
                    &mut self.output_buffer[end..],
                    format_args!("\x1b[{}D", self.columns_written),
                );
                end += buf_print(&mut self.output_buffer[end..], format_args!("\x1b[0K"));
            } else {
                #[cfg(windows)]
                'winapi: {
                    debug_assert!(self.is_windows_terminal);

                    // TODO(port): verify bun_sys::windows::CONSOLE_SCREEN_BUFFER_INFO layout & kernel32 bindings.
                    let mut info: windows::CONSOLE_SCREEN_BUFFER_INFO =
                        // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (POD).
                        unsafe { core::mem::zeroed() };
                    // SAFETY: file.handle() is a valid console HANDLE (is_windows_terminal asserted
                    // above); `info` is a live stack local out-ptr.
                    if unsafe {
                        windows::kernel32::GetConsoleScreenBufferInfo(file.handle(), &mut info)
                    } != windows::TRUE
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
                    // SAFETY: file.handle() is a valid console HANDLE (is_windows_terminal asserted
                    // above); `cursor_pos` and `written` are live stack locals.
                    if unsafe {
                        windows::kernel32::FillConsoleOutputAttribute(
                            file.handle(),
                            info.wAttributes,
                            fill_chars,
                            cursor_pos,
                            &mut written,
                        )
                    } != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal = None;
                        break 'winapi;
                    }
                    // SAFETY: file.handle() is a valid console HANDLE (is_windows_terminal asserted
                    // above); `cursor_pos` and `written` are live stack locals.
                    if unsafe {
                        windows::kernel32::FillConsoleOutputCharacterW(
                            file.handle(),
                            b' ' as u16,
                            fill_chars,
                            cursor_pos,
                            &mut written,
                        )
                    } != windows::TRUE
                    {
                        // stop trying to write to this file
                        self.terminal = None;
                        break 'winapi;
                    }
                    // SAFETY: file.handle() is a valid console HANDLE (is_windows_terminal asserted
                    // above); `cursor_pos` is passed by value.
                    if unsafe {
                        windows::kernel32::SetConsoleCursorPosition(file.handle(), cursor_pos)
                    } != windows::TRUE
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
            let mut maybe_node: *mut Node = &mut self.root as *mut Node;
            // SAFETY: walking the recently_updated_child chain under update_mutex;
            // nodes are caller-owned and outlive this call per API contract.
            while let Some(node) = unsafe { maybe_node.as_mut() } {
                if need_ellipse {
                    self.buf_write(&mut end, format_args!("... "));
                }
                need_ellipse = false;
                let eti = node
                    .unprotected_estimated_total_items
                    .load(Ordering::Relaxed);
                let completed_items = node.unprotected_completed_items.load(Ordering::Relaxed);
                let current_item = completed_items + 1;
                if !node.name.is_empty() || eti > 0 {
                    if !node.name.is_empty() {
                        self.buf_write(&mut end, format_args!("{}", bstr::BStr::new(node.name)));
                        need_ellipse = true;
                    }
                    if eti > 0 {
                        if need_ellipse {
                            self.buf_write(&mut end, format_args!(" "));
                        }
                        match node.unit {
                            Unit::None => {
                                self.buf_write(&mut end, format_args!("[{}/{}] ", current_item, eti))
                            }
                            Unit::Files => self.buf_write(
                                &mut end,
                                format_args!("[{}/{} files] ", current_item, eti),
                            ),
                            // TODO(port): Zig `{Bi:.2}` is std.fmt binary-bytes formatter (e.g. "1.50KiB").
                            // Need a bun_core::fmt::BytesBi helper in Phase B.
                            Unit::Bytes => {
                                self.buf_write(&mut end, format_args!("[{}/{}] ", current_item, eti))
                            }
                        }
                        need_ellipse = false;
                    } else if completed_items != 0 {
                        if need_ellipse {
                            self.buf_write(&mut end, format_args!(" "));
                        }
                        match node.unit {
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
                maybe_node = node.recently_updated_child.load(Ordering::Acquire);
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
            self.prev_refresh_timestamp = u64::try_from(timer.elapsed().as_nanos()).unwrap();
        }
    }

    pub fn log(&mut self, args: fmt::Arguments<'_>) {
        let Some(file) = self.terminal else {
            // TODO(port): std.debug.print → bun_core::Output debug print equivalent.
            eprint!("{}", args);
            return;
        };
        // TODO(port): Zig `file.writerStreaming(&.{})` — map to bun_sys::File writer in Phase B.
        self.refresh();
        if file.write_fmt(args).is_err() {
            self.terminal = None;
            return;
        }
        self.columns_written = 0;
    }

    /// Allows the caller to freely write to stderr until unlock_stderr() is called.
    /// During the lock, the progress information is cleared from the terminal.
    pub fn lock_stderr(&mut self) {
        self.update_mutex.lock();
        if let Some(file) = self.terminal {
            let mut end: usize = 0;
            self.clear_with_held_lock(&mut end);
            if file.write(&self.output_buffer[0..end]).is_err() {
                // stop trying to write to this file
                self.terminal = None;
            }
        }
        // TODO(port): std.debug.getStderrMutex().lock() — need a global stderr mutex in bun_core.
    }

    pub fn unlock_stderr(&mut self) {
        // TODO(port): std.debug.getStderrMutex().unlock() — see lock_stderr.
        self.update_mutex.unlock();
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

/// Helper mirroring `std.fmt.bufPrint(buf, fmt, args).len` with `catch unreachable`.
fn buf_print(buf: &mut [u8], args: fmt::Arguments<'_>) -> usize {
    let mut cursor: &mut [u8] = buf;
    let before = cursor.len();
    cursor.write_fmt(args).expect("unreachable");
    before - cursor.len()
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
            // SAFETY: context backref valid while Progress lives.
            unsafe { &mut *node.context }.refresh();
            thread::sleep(Duration::from_nanos(10 * speed_factor));
            node.end();
        }
        root_node.end();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/Progress.zig (467 lines)
//   confidence: medium
//   todos:      10
//   notes:      bun_sys::File API (stderr/tty/ansi/write_fmt), bun_threading::Mutex raw lock/unlock, Windows kernel32 bindings, {Bi:.2} bytes formatter, and global stderr mutex all need Phase-B wiring; Node.name uses 'static placeholder for caller-borrowed slices.
// ──────────────────────────────────────────────────────────────────────────
