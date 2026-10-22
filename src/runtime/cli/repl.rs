//! Bun REPL - A modern, feature-rich Read-Eval-Print Loop
//!
//! This is a native implementation of Bun's REPL with advanced TUI features:
//! - Syntax highlighting using QuickAndDirtySyntaxHighlighter
//! - Full line editing with cursor movement (Emacs-style keybindings)
//! - Persistent history with file storage
//! - Tab completion for properties and commands
//! - Multi-line input support
//! - REPL commands (.help, .exit, .clear, .load, .save, .editor)
//! - Result formatting with util.inspect integration
//!
//! This replaces the TypeScript-based REPL for faster startup and better integration.

#[cfg(unix)]
use core::ffi::c_int;
use core::fmt::Arguments;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::VecExt;
use bun_core::strings;
use bun_core::tty;
use bun_core::{Environment, Output, env_var, fmt, identifier};
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult, ProtectedJSValue};
use bun_paths as path;
use bun_sys::{self as sys, Fd};

// ============================================================================
// C++ Bindings
// ============================================================================

// NOTE: `globalObject` is `*const` here because `JSGlobalObject` is an opaque
// FFI handle (zero Rust-visible bytes). All mutation happens on the C++ side;
// Rust only ever holds `&JSGlobalObject`, so deriving a `*mut` from that shared
// reference would violate provenance. This matches the convention in
// `src/jsc/lib.rs`.
unsafe extern "C" {
    fn Bun__REPL__evaluate(
        globalObject: *const JSGlobalObject,
        sourcePtr: *const u8,
        sourceLen: usize,
        filenamePtr: *const u8,
        filenameLen: usize,
        exception: *mut JSValue,
    ) -> JSValue;

    fn Bun__REPL__getCompletions(
        globalObject: *const JSGlobalObject,
        targetValue: JSValue,
        prefixPtr: *const u8,
        prefixLen: usize,
    ) -> JSValue;

    fn Bun__REPL__getProperty(
        globalObject: *const JSGlobalObject,
        baseValue: JSValue,
        namePtr: *const u8,
        nameLen: usize,
    ) -> JSValue;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_SIZE: usize = 1000;
const HISTORY_FILENAME: &[u8] = b".bun_repl_history";

// ANSI escape codes
const CSI: &str = concat!("\x1b", "[");

// Colors — Color::RESET, Color::CYAN, … resolve unchanged
use bun_core::output::ansi as Color;

// Cursor control
struct Cursor;
impl Cursor {
    const HOME: &'static str = concat!("\x1b", "[", "H");
    /// Erase from the cursor to the end of the screen.
    const CLEAR_BELOW: &'static str = concat!("\x1b", "[", "J");
    const CLEAR_SCREEN: &'static str = concat!("\x1b", "[", "2J");
    const CLEAR_SCROLLBACK: &'static str = concat!("\x1b", "[", "3J");
}

/// DEC private mode 2004: the terminal sends a paste as `ESC [ 200 ~`, the pasted bytes, `ESC [ 201 ~`.
struct BracketedPaste;
impl BracketedPaste {
    /// Switches the mode on and starts a redraw (one write).
    const ON_THEN_CR: &'static str = concat!("\x1b", "[", "?2004h", "\r");
    const OFF: &'static str = concat!("\x1b", "[", "?2004l");
    const OFF_THEN_CR: &'static str = concat!("\x1b", "[", "?2004l", "\r");
    const CLEAR_BELOW_THEN_OFF: &'static str = concat!("\x1b", "[", "J", "\x1b", "[", "?2004l");
    /// The CSI parameter of the marker before a paste.
    const START: u16 = 200;
    /// What ends the body of a paste.
    const END: &'static [u8] = concat!("\x1b", "[", "201~").as_bytes();
}

// ============================================================================
// Key Codes
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq)]
enum Key {
    // Control keys
    CtrlA,
    CtrlB,
    CtrlC,
    CtrlD,
    CtrlE,
    CtrlF,
    CtrlK,
    CtrlL,
    CtrlN,
    CtrlP,
    CtrlR,
    CtrlT,
    CtrlU,
    CtrlW,
    Backspace,
    Tab,
    Enter,
    Escape,

    // Special keys
    Delete,
    Home,
    End,
    PageUp,
    PageDown,
    ArrowUp,
    ArrowDown,
    ArrowRight,
    ArrowLeft,

    // Alt combinations
    AltB,
    AltD,
    AltF,
    AltBackspace,
    AltLeft,
    AltRight,

    // Regular printable ASCII character
    Char(u8),

    // A full multi-byte UTF-8 sequence (len bytes of the array are valid)
    Text([u8; 4], usize),

    // A bracketed paste; its body is in `Repl::paste`
    Paste,

    // Unknown/unhandled
    Unknown,
}

impl Key {
    fn from_byte(byte: u8) -> Key {
        match byte {
            1 => Key::CtrlA,
            2 => Key::CtrlB,
            3 => Key::CtrlC,
            4 => Key::CtrlD,
            5 => Key::CtrlE,
            6 => Key::CtrlF,
            11 => Key::CtrlK,
            12 => Key::CtrlL,
            14 => Key::CtrlN,
            16 => Key::CtrlP,
            18 => Key::CtrlR,
            20 => Key::CtrlT,
            21 => Key::CtrlU,
            23 => Key::CtrlW,
            8 | 127 => Key::Backspace,
            9 => Key::Tab,
            10 | 13 => Key::Enter,
            27 => Key::Escape,
            32..=126 => Key::Char(byte),
            _ => Key::Unknown,
        }
    }
}

// ============================================================================
// History
// ============================================================================

struct History {
    entries: Vec<Box<[u8]>>,
    position: usize,
    temp_line: Option<Box<[u8]>>,
    file_path: Option<Box<[u8]>>,
    modified: bool,
}

impl History {
    fn init() -> History {
        History {
            entries: Vec::new(),
            position: 0,
            temp_line: None,
            file_path: None,
            modified: false,
        }
    }

    fn load(&mut self) -> Result<(), crate::Error> {
        let Some(home_path) = env_var::HOME.get() else {
            return Ok(());
        };
        if home_path.is_empty() {
            return Ok(());
        }

        let mut path_buf = bun_paths::path_buffer_pool::get();
        // Skip the history file if `$HOME` is too long.
        let Some(path) = path::resolve_path::join_z_buf_checked::<path::platform::Auto>(
            &mut path_buf[..],
            &[home_path, HISTORY_FILENAME],
        ) else {
            return Ok(());
        };
        self.file_path = Some(Box::<[u8]>::from(path.as_bytes()));

        let content: Box<[u8]> = match sys::File::read_from(Fd::cwd(), path) {
            sys::Result::Ok(bytes) => bytes.into(),
            sys::Result::Err(_) => return Ok(()),
        };

        for line in strings::split(&content, b"\n") {
            if !line.is_empty() {
                self.entries.push(Box::<[u8]>::from(line));
            }
        }

        // Trim to max size
        while self.entries.len() > MAX_HISTORY_SIZE {
            let _ = self.entries.remove(0);
        }

        self.position = self.entries.len();
        Ok(())
    }

    fn save(&mut self) {
        if !self.modified {
            return;
        }
        let Some(path) = self.file_path.as_deref() else {
            return;
        };

        // Build content
        let start = if self.entries.len() > MAX_HISTORY_SIZE {
            self.entries.len() - MAX_HISTORY_SIZE
        } else {
            0
        };

        let mut content: Vec<u8> = Vec::new();
        for entry in &self.entries[start..] {
            content.extend_from_slice(entry);
            content.push(b'\n');
        }

        let file = match sys::open_a(path, sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC, 0o600) {
            sys::Result::Ok(fd) => sys::File::from_fd(fd),
            sys::Result::Err(_) => return,
        };
        #[cfg(unix)]
        let _ = sys::fchmod(file.fd(), 0o600);
        match file.write_all(&content) {
            sys::Result::Ok(()) => {}
            sys::Result::Err(_) => return,
        }

        self.modified = false;
    }

    fn add(&mut self, line: &[u8]) -> Result<(), bun_alloc::AllocError> {
        if line.is_empty() {
            return Ok(());
        }

        // Don't add duplicates of the last entry
        if let Some(last) = self.entries.last() {
            if strings::eql_long(last, line, true) {
                self.position = self.entries.len();
                return Ok(());
            }
        }

        self.entries.push(Box::<[u8]>::from(line));
        self.position = self.entries.len();
        self.modified = true;

        // Trim if too large
        while self.entries.len() > MAX_HISTORY_SIZE {
            let _ = self.entries.remove(0);
            self.position = self.position.saturating_sub(1);
        }
        Ok(())
    }

    fn prev(&mut self, current_line: &[u8]) -> Option<&[u8]> {
        if self.entries.is_empty() {
            return None;
        }

        // Save current line if at the end
        if self.position == self.entries.len() {
            self.temp_line = Some(Box::<[u8]>::from(current_line));
        }

        if self.position > 0 {
            self.position -= 1;
            return Some(&self.entries[self.position]);
        }

        None
    }

    /// `None` when already on the line being entered (nothing to restore).
    fn next(&mut self) -> Option<&[u8]> {
        if self.position == self.entries.len() {
            return None;
        }
        self.position += 1;
        match self.entries.get(self.position) {
            Some(entry) => Some(entry),
            // Back on the line being entered; `prev` saved it on the way out.
            None => self.temp_line.as_deref(),
        }
    }

    fn reset_position(&mut self) {
        self.position = self.entries.len();
        self.temp_line = None;
    }
}

// ============================================================================
// Line Editor
// ============================================================================

struct LineEditor {
    buffer: Vec<u8>,
    cursor: usize,
    /// The buffer may hold control bytes, LF included (no key press puts one there): `refresh_line` then draws it line by line in display form.
    has_control_bytes: bool,
}

impl LineEditor {
    fn init() -> LineEditor {
        LineEditor {
            buffer: Vec::new(),
            cursor: 0,
            has_control_bytes: false,
        }
    }

    fn clear(&mut self) {
        self.buffer.clear();
        self.cursor = 0;
        self.has_control_bytes = false;
    }

    fn set(&mut self, text: &[u8]) -> Result<(), bun_alloc::AllocError> {
        self.buffer.clear();
        self.buffer.extend_from_slice(text);
        self.cursor = text.len();
        self.has_control_bytes = text.iter().copied().any(is_control_byte);
        Ok(())
    }

    /// Inserts text that did not come from key presses, so it may hold any byte.
    fn insert_text(&mut self, text: &[u8]) {
        self.has_control_bytes |= text.iter().copied().any(is_control_byte);
        let _ = self.insert_slice(text);
    }

    fn insert(&mut self, ch: u8) -> Result<(), bun_alloc::AllocError> {
        if self.cursor == self.buffer.len() {
            self.buffer.push(ch);
        } else {
            self.buffer.insert(self.cursor, ch);
        }
        self.cursor += 1;
        Ok(())
    }

    fn insert_slice(&mut self, slice: &[u8]) -> Result<(), bun_alloc::AllocError> {
        if self.cursor == self.buffer.len() {
            self.buffer.extend_from_slice(slice);
        } else {
            self.buffer
                .splice(self.cursor..self.cursor, slice.iter().copied());
        }
        self.cursor += slice.len();
        Ok(())
    }

    /// Byte offset of the start of the codepoint ending just before `pos`.
    /// Walks back over UTF-8 continuation bytes (0x80..=0xBF).
    fn prev_boundary(&self, pos: usize) -> usize {
        let mut i = pos;
        while i > 0 {
            i -= 1;
            if self.buffer[i] & 0xC0 != 0x80 {
                break;
            }
        }
        i
    }

    /// Byte offset of the start of the codepoint after the one beginning at
    /// `pos`. Advances by the lead byte's UTF-8 sequence length, clamped to the
    /// buffer so a truncated/invalid sequence still makes progress.
    fn next_boundary(&self, pos: usize) -> usize {
        if pos >= self.buffer.len() {
            return self.buffer.len();
        }
        let step = (strings::wtf8_byte_sequence_length(self.buffer[pos]) as usize).max(1);
        (pos + step).min(self.buffer.len())
    }

    fn delete_char(&mut self) {
        if self.cursor < self.buffer.len() {
            let end = self.next_boundary(self.cursor);
            self.buffer.drain(self.cursor..end);
        }
    }

    fn backspace(&mut self) {
        if self.cursor > 0 {
            let start = self.prev_boundary(self.cursor);
            self.buffer.drain(start..self.cursor);
            self.cursor = start;
        }
    }

    fn delete_word(&mut self) {
        // Delete word forward
        while self.cursor < self.buffer.len() && self.buffer[self.cursor].is_ascii_whitespace() {
            self.buffer.remove(self.cursor);
        }
        while self.cursor < self.buffer.len() && !self.buffer[self.cursor].is_ascii_whitespace() {
            self.buffer.remove(self.cursor);
        }
    }

    fn backspace_word(&mut self) {
        // Delete word backward
        while self.cursor > 0 && self.buffer[self.cursor - 1].is_ascii_whitespace() {
            self.cursor -= 1;
            self.buffer.remove(self.cursor);
        }
        while self.cursor > 0 && !self.buffer[self.cursor - 1].is_ascii_whitespace() {
            self.cursor -= 1;
            self.buffer.remove(self.cursor);
        }
    }

    fn delete_to_end(&mut self) {
        self.buffer.truncate(self.cursor);
    }

    fn delete_to_start(&mut self) {
        self.buffer.drain_front(self.cursor);
        self.cursor = 0;
    }

    fn move_left(&mut self) {
        if self.cursor > 0 {
            self.cursor = self.prev_boundary(self.cursor);
        }
    }

    fn move_right(&mut self) {
        if self.cursor < self.buffer.len() {
            self.cursor = self.next_boundary(self.cursor);
        }
    }

    fn move_word_left(&mut self) {
        while self.cursor > 0 && self.buffer[self.cursor - 1].is_ascii_whitespace() {
            self.cursor -= 1;
        }
        while self.cursor > 0 && !self.buffer[self.cursor - 1].is_ascii_whitespace() {
            self.cursor -= 1;
        }
    }

    fn move_word_right(&mut self) {
        while self.cursor < self.buffer.len() && !self.buffer[self.cursor].is_ascii_whitespace() {
            self.cursor += 1;
        }
        while self.cursor < self.buffer.len() && self.buffer[self.cursor].is_ascii_whitespace() {
            self.cursor += 1;
        }
    }

    fn move_to_start(&mut self) {
        self.cursor = 0;
    }

    fn move_to_end(&mut self) {
        self.cursor = self.buffer.len();
    }

    fn swap(&mut self) {
        // Transpose two whole codepoints (not bytes), so multi-byte UTF-8 is
        // not split. Mid-line swaps the codepoint before the cursor with the
        // one at it and advances past both; at end-of-line it transposes the
        // last two codepoints.
        let (left_start, mid, right_end) = if self.cursor > 0 && self.cursor < self.buffer.len() {
            let mid = self.cursor;
            (self.prev_boundary(mid), mid, self.next_boundary(mid))
        } else if self.cursor == self.buffer.len() {
            let mid = self.prev_boundary(self.cursor);
            if mid == 0 {
                return; // fewer than two codepoints
            }
            (self.prev_boundary(mid), mid, self.cursor)
        } else {
            return;
        };
        // Rotate the two adjacent codepoint ranges [left_start, mid) and
        // [mid, right_end): moving the left range to the end swaps them.
        self.buffer[left_start..right_end].rotate_left(mid - left_start);
        self.cursor = right_end;
    }

    fn get_line(&self) -> &[u8] {
        &self.buffer
    }
}

// ============================================================================
// REPL Commands
// ============================================================================

struct ReplCommand {
    name: &'static [u8],
    help: &'static str,
    // LIFETIMES.tsv: STATIC fn pointer; arg is &[u8] per byte-data rule
    handler: fn(&mut Repl, &[u8]) -> ReplResult,
}

impl ReplCommand {
    const ALL: [ReplCommand; 9] = [
        ReplCommand {
            name: b".help",
            help: "Print this help message",
            handler: cmd_help,
        },
        ReplCommand {
            name: b".exit",
            help: "Exit the REPL",
            handler: cmd_exit,
        },
        ReplCommand {
            name: b".clear",
            help: "Clear the screen",
            handler: cmd_clear,
        },
        ReplCommand {
            name: b".copy",
            help: "Copy result to clipboard (.copy [expr])",
            handler: cmd_copy,
        },
        ReplCommand {
            name: b".load",
            help: "Load a file into the REPL session",
            handler: cmd_load,
        },
        ReplCommand {
            name: b".save",
            help: "Save REPL history to a file",
            handler: cmd_save,
        },
        ReplCommand {
            name: b".editor",
            help: "Enter multi-line editor mode",
            handler: cmd_editor,
        },
        ReplCommand {
            name: b".break",
            help: "Cancel current input",
            handler: cmd_break,
        },
        ReplCommand {
            name: b".history",
            help: "Show command history",
            handler: cmd_history,
        },
    ];

    fn find(name: &[u8]) -> Option<&'static ReplCommand> {
        Self::ALL.iter().find(|&cmd| {
            strings::eql_long(cmd.name, name, true)
                || (name.len() > 1 && cmd.name.starts_with(name))
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplResult {
    ExitRepl,
    SkipEval,
}

fn cmd_help(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.print(format_args!(
        "\n{}REPL Commands:{}\n",
        Color::BOLD,
        Color::RESET
    ));
    for cmd in &ReplCommand::ALL {
        repl.print(format_args!(
            "  {}{:<12}{} {}\n",
            Color::CYAN,
            BStr::new(cmd.name),
            Color::RESET,
            cmd.help
        ));
    }
    repl.print(format_args!(
        "\n{}Keybindings:{}\n",
        Color::BOLD,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+A{}       Move to start of line\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+E{}       Move to end of line\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+B/F{}     Move backward/forward one character\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Alt+B/F{}      Move backward/forward one word\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+U{}       Delete to start of line\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+K{}       Delete to end of line\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+W{}       Delete word backward\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+D{}       Delete character / Exit if line empty\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+L{}       Clear screen\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Ctrl+T{}       Swap characters\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Up/Down{}      Navigate history\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Tab{}          Auto-complete / accept suggestion\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}Right/End{}    Accept inline suggestion\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "\n{}Special Variables:{}\n",
        Color::BOLD,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}_{}            Last expression result\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!(
        "  {}_error{}       Last error\n",
        Color::CYAN,
        Color::RESET
    ));
    repl.print(format_args!("\n"));
    ReplResult::SkipEval
}

fn cmd_copy(repl: &mut Repl, args: &[u8]) -> ReplResult {
    let code = strings::trim(args, b" \t");

    if code.is_empty() {
        // .copy with no args - copy _ (last result) to clipboard
        if let Err(err) = repl.copy_value_to_clipboard(repl.last_result.value()) {
            if let Some(global) = repl.global {
                let exc = global.take_exception(err);
                repl.set_last_error(exc);
                repl.print_js_error(exc);
            }
        }
        return ReplResult::SkipEval;
    }

    // .copy <code> - evaluate and copy result to clipboard instead of printing
    repl.evaluate_and_copy(code);
    ReplResult::SkipEval
}

fn cmd_exit(_: &mut Repl, _: &[u8]) -> ReplResult {
    ReplResult::ExitRepl
}

fn cmd_clear(repl: &mut Repl, _: &[u8]) -> ReplResult {
    // Clear screen
    repl.write(Cursor::CLEAR_SCREEN.as_bytes());
    repl.write(Cursor::CLEAR_SCROLLBACK.as_bytes());
    repl.write(Cursor::HOME.as_bytes());
    ReplResult::SkipEval
}

/// The file name that `.load` or `.save` got, or `None` after telling the user why there is none to open.
fn file_name_argument<'a>(repl: &Repl, command: &str, args: &'a [u8]) -> Option<&'a [u8]> {
    let filename = strings::trim(args, b" \t");
    if filename.is_empty() {
        repl.print_error(format_args!("Usage: {command} <filename>\n"));
        return None;
    }
    // The open takes a C string: it would stop at the NUL and open another file. A line break is not part of a name either.
    if strings::index_of_any(filename, b"\0\n").is_some() {
        repl.print_error(format_args!(
            "The file name must not contain a null byte or a line break: {}\n",
            bun_core::fmt::escape_control_chars(filename)
        ));
        return None;
    }
    Some(filename)
}

fn cmd_load(repl: &mut Repl, args: &[u8]) -> ReplResult {
    let Some(filename) = file_name_argument(repl, ".load", args) else {
        return ReplResult::SkipEval;
    };

    let content: Box<[u8]> = match sys::File::read_from(Fd::cwd(), filename) {
        sys::Result::Ok(bytes) => bytes.into(),
        sys::Result::Err(err) => {
            // The error names the file.
            repl.print_error(format_args!(
                "{}\n",
                bun_core::fmt::EscapeControlChars(&err)
            ));
            return ReplResult::SkipEval;
        }
    };

    repl.print(format_args!(
        "{}Loading {}...{}\n",
        Color::DIM,
        bun_core::fmt::escape_control_chars(filename),
        Color::RESET
    ));
    repl.evaluate_and_print(&content);
    ReplResult::SkipEval
}

fn cmd_save(repl: &mut Repl, args: &[u8]) -> ReplResult {
    let Some(filename) = file_name_argument(repl, ".save", args) else {
        return ReplResult::SkipEval;
    };

    // Build content
    let mut content: Vec<u8> = Vec::new();
    for entry in &repl.history.entries {
        content.extend_from_slice(entry);
        content.push(b'\n');
    }

    let file = match sys::open_a(
        filename,
        sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
        0o644,
    ) {
        sys::Result::Ok(fd) => sys::File::from_fd(fd),
        sys::Result::Err(err) => {
            // The error names the file.
            repl.print_error(format_args!(
                "{}\n",
                bun_core::fmt::EscapeControlChars(&err)
            ));
            return ReplResult::SkipEval;
        }
    };
    match file.write_all(&content) {
        sys::Result::Ok(()) => {}
        sys::Result::Err(err) => {
            repl.print_error(format_args!("{}\n", err));
            return ReplResult::SkipEval;
        }
    }

    repl.print(format_args!(
        "{}Session saved to {}{}\n",
        Color::GREEN,
        bun_core::fmt::escape_control_chars(filename),
        Color::RESET
    ));
    ReplResult::SkipEval
}

fn cmd_editor(repl: &mut Repl, _: &[u8]) -> ReplResult {
    if repl.input_mode == InputMode::Multiline {
        return ReplResult::SkipEval;
    }
    repl.print(format_args!(
        "{}// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel){}\n",
        Color::DIM,
        Color::RESET
    ));
    repl.input_mode = InputMode::Editor;
    repl.editor_buffer.clear();
    ReplResult::SkipEval
}

fn cmd_break(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.line_editor.clear();
    repl.multiline_buffer.clear();
    repl.suggestion.clear();
    repl.input_mode = InputMode::Normal;
    ReplResult::SkipEval
}

fn cmd_history(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.print(format_args!(
        "\n{}Command History:{}\n",
        Color::BOLD,
        Color::RESET
    ));
    let start = if repl.history.entries.len() > 20 {
        repl.history.entries.len() - 20
    } else {
        0
    };
    for (i, entry) in repl.history.entries[start..].iter().enumerate() {
        let i = i + start;
        repl.print(format_args!(
            "  {}{:>4}{}  {}\n",
            Color::DIM,
            i + 1,
            Color::RESET,
            bun_core::fmt::escape_control_chars_multiline(entry)
        ));
    }
    repl.print(format_args!("\n"));
    ReplResult::SkipEval
}

// ============================================================================
// Main REPL Struct
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq)]
enum InputMode {
    Normal,
    Multiline,
    Editor,
}

/// A terminal cell, in rows below the row that holds the prompt.
#[derive(Clone, Copy, Default)]
struct ScreenPos {
    row: usize,
    col: usize,
}

impl ScreenPos {
    fn next_row(self) -> ScreenPos {
        ScreenPos {
            row: self.row + 1,
            col: 0,
        }
    }
}

/// Starts every line of an input but the first.
const CONTINUATION_PROMPT: &[u8] = b"... ";
const CONTINUATION_PROMPT_DIM: &[u8] = concat!("\x1b[2m", "... ", "\x1b[0m").as_bytes();
const CONTINUATION_COLUMNS: usize = CONTINUATION_PROMPT.len();

/// Follows where the terminal puts text written after the prompt.
struct Layout {
    width: usize,
    pos: ScreenPos,
}

impl Layout {
    /// Lays out `text` and returns the cell its first glyph went to, or `next` for empty text.
    fn advance(&mut self, mut text: &[u8]) -> ScreenPos {
        let mut first: Option<ScreenPos> = None;
        while !text.is_empty() {
            let room = self.width.saturating_sub(self.pos.col);
            let mut fits =
                strings::visible::width::exclude_ansi_colors::utf8_index_at_width(text, room);
            if fits == 0 {
                // Like the terminal, a glyph that does not fit (a wide one) starts the next row.
                if self.pos.col > 0 {
                    self.pos = self.pos.next_row();
                    continue;
                }
                // Wider than the whole terminal.
                fits = text.len();
            }
            let (chunk, rest) = text.split_at(fits);
            let columns = strings::visible::width::exclude_ansi_colors::utf8(chunk);
            if columns > 0 {
                first.get_or_insert(self.pos);
            }
            self.pos.col += columns;
            text = rest;
        }
        first.unwrap_or_else(|| self.next())
    }

    /// `advance` over the lines `Repl::write_lines` draws.
    #[cold]
    fn advance_lines(&mut self, text: &[u8]) -> ScreenPos {
        let mut lines = strings::split(text, b"\n");
        let first = self.advance(lines.next().unwrap_or_default());
        for line in lines {
            // One row down from a full row too: CR LF comes before the terminal wraps.
            self.pos = ScreenPos {
                row: self.pos.row + 1,
                col: CONTINUATION_COLUMNS,
            };
            self.advance(line);
        }
        first
    }

    /// The cell the next glyph goes to. A full row counts as wrapped; `refresh_line` makes that so.
    fn next(&self) -> ScreenPos {
        if self.pos.col >= self.width {
            self.pos.next_row()
        } else {
            self.pos
        }
    }
}

/// What `refresh_line` last drew on the terminal. The REPL has one only when it is on a terminal.
#[derive(Clone, Copy)]
struct Drawing {
    /// Last width the terminal reported.
    width: u16,
    /// Last height the terminal reported.
    height: u16,
    /// Where the terminal cursor was left.
    cursor: ScreenPos,
    /// The cell after the last character of the line (the ghost text is not counted).
    end: ScreenPos,
}

impl Drawing {
    fn new() -> Drawing {
        Drawing {
            width: 80,
            height: 24,
            cursor: ScreenPos::default(),
            end: ScreenPos::default(),
        }
    }

    fn update_size(&mut self) {
        if let Some(size) = bun_core::output::File::from(Fd::stdout()).winsize() {
            if size.col > 0 {
                self.width = size.col;
            }
            if size.row > 0 {
                self.height = size.row;
            }
        }
    }

    /// The input is gone from the screen; the next redraw starts where the cursor is.
    fn erased(&mut self) {
        self.cursor = ScreenPos::default();
        self.end = ScreenPos::default();
    }
}

pub(super) struct Repl<'a> {
    line_editor: LineEditor,
    history: History,
    multiline_buffer: Vec<u8>,
    editor_buffer: Vec<u8>,
    /// Remainder of the current inline completion (not the full word); empty when none.
    suggestion: Vec<u8>,

    // State
    input_mode: InputMode,
    running: bool,
    use_colors: bool,
    /// `Some` on a terminal in raw mode: stdin is key presses. `None`: stdin is lines of text, never redrawn.
    drawing: Option<Drawing>,
    ctrl_c_pressed: bool,
    /// Bracketed paste is on. `leave_input` turns it off: `prompt()` or a child would read the markers while a line runs.
    bracketed_paste: bool,

    // Buffered stdin
    stdin_buf: [u8; 256],
    stdin_buf_start: usize,
    stdin_buf_end: usize,
    /// Body of the bracketed paste that `read_key` last returned as `Key::Paste`.
    paste: Vec<u8>,

    // JavaScript VM (JSC_BORROW per LIFETIMES.tsv)
    pub(super) vm: Option<&'a VirtualMachine>,
    pub(super) global: Option<&'a JSGlobalObject>,

    // Special REPL variables
    // Note: bare JSValue fields are safe here because Repl is stack-allocated
    // and values are explicitly protect()/unprotect()'d.
    last_result: ProtectedJSValue,
    last_error: ProtectedJSValue,

    // Windows: saved console mode for restoration
    #[cfg(windows)]
    original_windows_mode: Option<bun_sys::windows::DWORD>,

    // POSIX: the REPL's own stdin raw-mode state
    #[cfg(unix)]
    tty_state: tty::State,
}

impl<'a> Repl<'a> {
    pub(super) fn init() -> Repl<'a> {
        Repl {
            line_editor: LineEditor::init(),
            history: History::init(),
            multiline_buffer: Vec::new(),
            editor_buffer: Vec::new(),
            suggestion: Vec::new(),
            input_mode: InputMode::Normal,
            running: false,
            use_colors: false,
            drawing: None,
            ctrl_c_pressed: false,
            bracketed_paste: false,
            stdin_buf: [0u8; 256],
            stdin_buf_start: 0,
            stdin_buf_end: 0,
            paste: Vec::new(),
            vm: None,
            global: None,
            // `adopt(UNDEFINED)`: no protect taken; drop's unprotect() is a
            // C++-side no-op for non-cell values.
            last_result: ProtectedJSValue::adopt(JSValue::UNDEFINED),
            last_error: ProtectedJSValue::adopt(JSValue::UNDEFINED),
            #[cfg(windows)]
            original_windows_mode: None,
            #[cfg(unix)]
            tty_state: tty::State::new(),
        }
    }

    fn set_last_result(&mut self, value: JSValue) {
        // Assignment drops the previous guard (= unprotect old). `protected()`
        // on `undefined` is a C++ no-op, so the is_undefined() gate is elided.
        self.last_result = value.protected();
    }

    fn set_last_error(&mut self, value: JSValue) {
        self.last_error = value.protected();
    }

    // ========================================================================
    // Terminal I/O
    // ========================================================================

    fn setup_terminal(&mut self) {
        // Without raw mode stdin holds lines of text, not key presses; see `drawing`.
        if !(Output::is_stdout_tty() && Output::is_stdin_tty() && self.enter_raw_mode()) {
            self.use_colors = false;
            return;
        }
        self.drawing = Some(Drawing::new());

        // Check for NO_COLOR
        self.use_colors = !env_var::NO_COLOR.get().unwrap_or(false);
    }

    /// False when the terminal could not be switched: it still edits each line itself.
    fn enter_raw_mode(&mut self) -> bool {
        #[cfg(unix)]
        {
            self.tty_state
                .set_mode(0, tty::Mode::Raw, tty::SetAttrWhen::Drain)
                == 0
        }
        #[cfg(windows)]
        {
            self.original_windows_mode = bun_sys::windows::update_stdio_mode_flags(
                bun_sys::Stdio::StdIn,
                bun_sys::windows::UpdateStdioModeFlagsOpts {
                    set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                        | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                    unset: bun_sys::windows::ENABLE_LINE_INPUT
                        | bun_sys::windows::ENABLE_ECHO_INPUT,
                },
            )
            .ok();
            self.original_windows_mode.is_some()
        }
    }

    fn restore_terminal(&mut self) {
        if core::mem::take(&mut self.bracketed_paste) {
            self.write(BracketedPaste::OFF.as_bytes());
            tty::mark_dec_modes_reset(tty::dec::BRACKETED_PASTE);
        }
        #[cfg(unix)]
        {
            let _ = self
                .tty_state
                .set_mode(0, tty::Mode::Normal, tty::SetAttrWhen::Drain);
        }
        #[cfg(windows)]
        {
            if let Some(mode) = self.original_windows_mode {
                // SAFETY: stdin handle is valid console handle
                unsafe {
                    let _ = bun_sys::windows::SetConsoleMode(Fd::stdin().native(), mode);
                }
                self.original_windows_mode = None;
            }
        }
    }

    /// Temporarily enable SIGINT delivery during blocking promise waits
    fn enable_signals_during_wait(&mut self) {
        SIGINT_ARMED.store(true, core::sync::atomic::Ordering::Release);

        #[cfg(unix)]
        {
            // Switch to normal terminal mode (has ISIG) so Ctrl+C generates SIGINT
            let _ = self
                .tty_state
                .set_mode(0, tty::Mode::Normal, tty::SetAttrWhen::Drain);

            // Install SIGINT handler
            // SAFETY: zeroed `sigaction` is a valid empty mask + null restorer; we set
            // sa_sigaction/sa_flags below. `act` is valid for the duration of the call.
            unsafe {
                let mut act: bun_sys::posix::Sigaction = bun_core::ffi::zeroed();
                act.sa_sigaction = sigint_handler as *const () as usize;
                act.sa_flags = 0;
                bun_sys::posix::sigaction(libc::SIGINT, &raw const act, core::ptr::null_mut());
            }
        }
        // On Windows, ENABLE_PROCESSED_INPUT is already set so Ctrl+C works
    }

    /// Drive the loop until `promise` settles; `true` if a SIGINT (see `sigint_handler`) cut the wait short.
    fn wait_for_promise_or_sigint(vm: &VirtualMachine, promise: *mut jsc::JSPromise) -> bool {
        use core::sync::atomic::Ordering;
        SIGINT_DURING_WAIT.store(false, Ordering::Release);
        while jsc::JSPromise::opaque_mut(promise).status() == PromiseStatus::Pending {
            if SIGINT_DURING_WAIT.swap(false, Ordering::AcqRel) {
                return true;
            }
            vm.as_mut().event_loop_mut().tick();
            if jsc::JSPromise::opaque_mut(promise).status() == PromiseStatus::Pending
                && !SIGINT_DURING_WAIT.load(Ordering::Acquire)
            {
                vm.as_mut().event_loop_mut().auto_tick();
            }
        }
        false
    }

    /// Restore raw terminal mode after promise wait
    fn disable_signals_during_wait(&mut self) {
        SIGINT_ARMED.store(false, core::sync::atomic::Ordering::Release);

        #[cfg(unix)]
        {
            // Back to raw mode, but only in a session that has it (see `drawing`).
            if self.drawing.is_some() {
                let _ = self
                    .tty_state
                    .set_mode(0, tty::Mode::Raw, tty::SetAttrWhen::Drain);
            }

            // Restore default SIGINT handling
            // SAFETY: zeroed `sigaction` is a valid empty mask + null restorer; SIG_DFL
            // restores the default disposition. `act` is valid for the duration of the call.
            unsafe {
                let mut act: bun_sys::posix::Sigaction = bun_core::ffi::zeroed();
                act.sa_sigaction = libc::SIG_DFL;
                act.sa_flags = 0;
                bun_sys::posix::sigaction(libc::SIGINT, &raw const act, core::ptr::null_mut());
            }
        }
    }

    fn write(&self, data: &[u8]) {
        let _ = Output::writer().write_all(data);
    }

    fn print(&self, args: Arguments<'_>) {
        let _ = Output::writer().write_fmt(args);
    }

    fn print_error(&self, args: Arguments<'_>) {
        if self.use_colors {
            let w = Output::writer();
            let _ = w.write_all(Color::RED.as_bytes());
            let _ = w.write_fmt(args);
            let _ = w.write_all(Color::RESET.as_bytes());
        } else {
            let _ = Output::writer().write_fmt(args);
        }
    }

    /// Reads more of stdin into the empty `stdin_buf`; 0 at the end of input.
    #[inline]
    fn fill_stdin_buf(&mut self) -> sys::Result<usize> {
        // Stdio fd: `File::Drop` is a no-op, so this is safe to re-create on every call.
        let n = sys::File::stdin().read(&mut self.stdin_buf)?;
        self.stdin_buf_start = 0;
        self.stdin_buf_end = n;
        Ok(n)
    }

    fn read_byte(&mut self) -> Option<u8> {
        if self.stdin_buf_start == self.stdin_buf_end && !matches!(self.fill_stdin_buf(), Ok(1..)) {
            return None;
        }
        let b = self.stdin_buf[self.stdin_buf_start];
        self.stdin_buf_start += 1;
        Some(b)
    }

    /// Reads a CSI sequence (after `ESC [`) to its final byte: one that names no key must leave no text on the line.
    fn read_csi(&mut self) -> Key {
        // More parameter bytes than any key or terminal report has.
        const MAX_PARAMETER_BYTES: usize = 64;
        // Up to two numbers name a key: `ESC [ 3 ~`, `ESC [ 1 ; 5 C`.
        let mut params = [0u16; 2];
        let mut count = 0;
        let mut names_key = true;
        let mut parameter_bytes = 0;
        let last = loop {
            let Some(byte) = self.read_byte() else {
                return Key::Unknown;
            };
            match byte {
                b'0'..=b'9' => {
                    count = count.max(1);
                    if let Some(param) = params.get_mut(count - 1) {
                        *param = param
                            .saturating_mul(10)
                            .saturating_add(u16::from(byte - b'0'));
                    }
                }
                b';' => count = count.max(1) + 1,
                // `:` or a private-mode prefix (`<=>?`): a terminal report, not a key.
                b':' | b'<'..=b'?' => names_key = false,
                // `$` ends the shifted keys of rxvt (`ESC [ 3 $`).
                0x40..=0x7e | b'$' => break byte,
                // Not a byte of a key sequence (the user typed `ESC [` and then text): it is the next key.
                _ => {
                    self.stdin_buf_start -= 1;
                    return Key::Unknown;
                }
            }
            parameter_bytes += 1;
            if parameter_bytes == MAX_PARAMETER_BYTES {
                return Key::Unknown;
            }
        };
        if !names_key || count > params.len() {
            return Key::Unknown;
        }
        match (last, &params[..count]) {
            (b'A', []) => Key::ArrowUp,
            (b'B', []) => Key::ArrowDown,
            (b'C', []) => Key::ArrowRight,
            (b'D', []) => Key::ArrowLeft,
            (b'H', []) => Key::Home,
            (b'F', []) => Key::End,
            // Ctrl (5) or Alt (3) with an arrow; the first number is not checked.
            (b'C', [_, 3 | 5]) => Key::AltRight,
            (b'D', [_, 3 | 5]) => Key::AltLeft,
            (b'~', [1]) => Key::Home,
            (b'~', [3]) => Key::Delete,
            (b'~', [4]) => Key::End,
            (b'~', [5]) => Key::PageUp,
            (b'~', [6]) => Key::PageDown,
            (b'~', [BracketedPaste::START]) => {
                if self.read_paste() {
                    Key::Paste
                } else {
                    Key::CtrlC
                }
            }
            // Insert, the function keys, and an end marker with no paste before it.
            _ => Key::Unknown,
        }
    }

    /// Reads the body of a bracketed paste into `paste`, up to its end marker or the end of input. False when Ctrl+C gave up on a paste whose end marker never came.
    fn read_paste(&mut self) -> bool {
        self.paste.clear();
        while let Some(byte) = self.read_byte() {
            self.paste.push(byte);
            if byte == b'~' && self.paste.ends_with(BracketedPaste::END) {
                let body_len = self.paste.len() - BracketedPaste::END.len();
                self.paste.truncate(body_len);
                break;
            }
            // A terminal sends the rest of a paste at once. A 0x03 with nothing behind it is the Ctrl+C key: the end marker was lost.
            if byte == 0x03 && self.stdin_buf_start == self.stdin_buf_end && !stdin_has_more_soon()
            {
                self.paste.clear();
                return false;
            }
        }
        true
    }

    fn read_key(&mut self) -> Option<Key> {
        debug_assert!(
            self.drawing.is_some(),
            "stdin holds key presses only when the REPL put a terminal in raw mode"
        );
        let byte = self.read_byte()?;

        // Handle escape sequences
        if byte == 27 {
            // ESC
            let Some(second) = self.read_byte() else {
                return Some(Key::Escape);
            };

            if second == b'[' {
                return Some(self.read_csi());
            } else if second == b'O' {
                // SS3
                let Some(third) = self.read_byte() else {
                    return Some(Key::Escape);
                };
                return Some(match third {
                    b'H' => Key::Home,
                    b'F' => Key::End,
                    27 => {
                        self.stdin_buf_start -= 1;
                        Key::Unknown
                    }
                    _ => Key::Unknown,
                });
            } else if second == 27 {
                // The Esc key, then a sequence of its own (a paste marker, an arrow key): do not cut its ESC off.
                self.stdin_buf_start -= 1;
                return Some(Key::Escape);
            } else if second == b'b' {
                return Some(Key::AltB);
            } else if second == b'd' {
                return Some(Key::AltD);
            } else if second == b'f' {
                return Some(Key::AltF);
            } else if second == 127 {
                return Some(Key::AltBackspace);
            }

            return Some(Key::Escape);
        }

        // Multi-byte UTF-8: assemble the whole sequence so it is inserted as
        // one unit. A lone/invalid lead byte yields a length of 0; fall back to
        // reading it as a single raw byte so it is still dropped (not split).
        let seq_len = strings::utf8_byte_sequence_length(byte) as usize;
        if seq_len > 1 {
            let mut bytes = [0u8; 4];
            bytes[0] = byte;
            for slot in bytes.iter_mut().take(seq_len).skip(1) {
                let Some(cont) = self.read_byte() else {
                    // Stream ended mid-sequence; drop the truncated bytes.
                    return Some(Key::Unknown);
                };
                // A byte that is not a continuation byte (0x80..=0xBF) means the
                // sequence is malformed; drop the lead bytes but push this one
                // back so the next read_key sees it (it starts a new keystroke).
                if cont & 0xC0 != 0x80 {
                    self.stdin_buf_start -= 1;
                    return Some(Key::Unknown);
                }
                *slot = cont;
            }
            // Reject overlong encodings, surrogates, and values above U+10FFFF,
            // which pass the continuation-byte shape check but are not valid
            // UTF-8. Keeping the buffer valid avoids feeding bad bytes to the
            // highlighter and parser.
            if !strings::is_valid_utf8(&bytes[..seq_len]) {
                return Some(Key::Unknown);
            }
            return Some(Key::Text(bytes, seq_len));
        }

        Some(Key::from_byte(byte))
    }

    // ========================================================================
    // Prompt and Display
    // ========================================================================

    fn continuation_prompt(&self) -> &'static [u8] {
        if self.use_colors {
            CONTINUATION_PROMPT_DIM
        } else {
            CONTINUATION_PROMPT
        }
    }

    fn get_prompt(&self) -> &'static [u8] {
        if self.input_mode != InputMode::Normal {
            return self.continuation_prompt();
        }

        if self.use_colors {
            concat!("\x1b[2m", "\u{276f}", "\x1b[0m", " ").as_bytes()
        } else {
            b"> "
        }
    }

    fn get_prompt_length(&self) -> usize {
        if self.input_mode != InputMode::Normal {
            return CONTINUATION_COLUMNS;
        }
        2 // "> " or "\u{276f} "
    }

    /// The ghost text is only drawn while the cursor is at the end of the line.
    fn drawn_suggestion(&self) -> &[u8] {
        if self.use_colors && self.line_editor.cursor == self.line_editor.buffer.len() {
            &self.suggestion
        } else {
            b""
        }
    }

    /// Call `leave_input` before printing anything below the input this draws.
    fn refresh_line(&mut self) {
        // Non-TTY never redraws (like node): per-key redraws wedge write(2) on a full socketpair.
        let Some(mut drawing) = self.drawing else {
            if self.line_editor.buffer.is_empty() && self.input_mode == InputMode::Normal {
                Output::flush();
                self.write(self.get_prompt());
                Output::flush();
            }
            return;
        };

        // Flush any buffered output (e.g., from console.log in JS) before drawing prompt
        Output::flush();

        // Every redraw, so that a resize is picked up.
        drawing.update_size();
        let width = usize::from(drawing.width);

        let mut prompt = self.get_prompt();
        let mut prompt_len = self.get_prompt_length();
        let line = self.line_editor.get_line();
        let edit_cursor = self.line_editor.cursor;
        // What the terminal gets for the line, and where the edit cursor is in that.
        let has_control_bytes = self.line_editor.has_control_bytes;
        let mut display_form = Vec::new();
        let (line, edit_cursor) = if has_control_bytes {
            let mut column = prompt_len;
            push_display_form(&mut display_form, &line[..edit_cursor], &mut column);
            let cursor_at = display_form.len();
            push_display_form(&mut display_form, &line[edit_cursor..], &mut column);
            let height = usize::from(drawing.height);
            let visible = visible_lines(&display_form, cursor_at, prompt_len, width, height);
            if visible.start > 0 {
                prompt = self.continuation_prompt();
                prompt_len = CONTINUATION_COLUMNS;
            }
            (&display_form[visible.clone()], cursor_at - visible.start)
        } else {
            (line, edit_cursor)
        };

        // Erase the previous drawing from the prompt's row down.
        if drawing.cursor.row > 0 {
            self.print(format_args!("{}{}A", CSI, drawing.cursor.row));
        }
        if self.bracketed_paste {
            self.write(b"\r");
        } else {
            self.bracketed_paste = true;
            tty::mark_dec_modes_set(tty::dec::BRACKETED_PASTE);
            self.write(BracketedPaste::ON_THEN_CR.as_bytes());
        }
        self.write(Cursor::CLEAR_BELOW.as_bytes());

        // Write prompt
        self.write(prompt);

        // Write line with syntax highlighting
        if has_control_bytes {
            self.write_lines(line);
        } else if self.use_colors && !line.is_empty() && line.len() <= 2048 {
            self.write_highlighted(line);
        } else {
            self.write(line);
        }

        let ghost = self.drawn_suggestion();
        if !ghost.is_empty() {
            self.write(Color::DIM.as_bytes());
            self.write(ghost);
            self.write(Color::RESET.as_bytes());
        }

        let (before_cursor, after_cursor) = line.split_at(edit_cursor);
        let mut layout = Layout {
            width,
            pos: ScreenPos {
                row: 0,
                col: prompt_len,
            },
        };
        let mut cursor = if has_control_bytes {
            layout.advance_lines(before_cursor);
            layout.advance_lines(after_cursor)
        } else {
            layout.advance(before_cursor);
            layout.advance(after_cursor)
        };
        let end = layout.next();
        if !ghost.is_empty() {
            // Only drawn with the cursor at the end of the line, so the cursor sits on the ghost.
            cursor = layout.advance(ghost);
        }

        // Terminals defer the wrap after the last column; force it to match `layout`.
        if layout.pos.col >= width {
            self.write(b"\n");
            layout.pos = layout.pos.next_row();
        }
        if layout.pos.row > cursor.row {
            self.print(format_args!("{}{}A", CSI, layout.pos.row - cursor.row));
        }
        self.write(b"\r");
        if cursor.col > 0 {
            self.print(format_args!("{}{}C", CSI, cursor.col));
        }

        drawing.cursor = cursor;
        drawing.end = end;
        self.drawing = Some(drawing);

        Output::flush();
    }

    /// One row per line of `text`; `Layout::advance_lines` counts the same rows.
    #[cold]
    fn write_lines(&self, text: &[u8]) {
        let highlight = self.use_colors && text.len() <= 2048;
        for (row, line) in strings::split(text, b"\n").enumerate() {
            if row > 0 {
                self.write(b"\r\n");
                self.write(self.continuation_prompt());
            }
            if highlight && !line.is_empty() {
                // One line at a time: the highlighter drops the line break that ends a `//` comment.
                self.write_highlighted(line);
            } else {
                self.write(line);
            }
        }
    }

    /// Erases the ghost, writes `echo` after the line, and moves to the start of the row below it.
    fn leave_input(&mut self, echo: &[u8]) {
        // False once a line that ends exactly at the right edge has left the cursor on a fresh row.
        let mut on_input_row = true;
        if let Some(Drawing { cursor, end, .. }) = self.drawing {
            // Bracketed paste goes off with a write that happens anyway, before the newline.
            let paste_off = core::mem::take(&mut self.bracketed_paste);
            if !self.drawn_suggestion().is_empty() {
                // Nothing but the ghost follows the cursor.
                self.write(if paste_off {
                    BracketedPaste::CLEAR_BELOW_THEN_OFF.as_bytes()
                } else {
                    Cursor::CLEAR_BELOW.as_bytes()
                });
                on_input_row = cursor.col > 0;
            } else {
                if end.row > cursor.row {
                    self.print(format_args!("{}{}B", CSI, end.row - cursor.row));
                }
                self.write(if paste_off {
                    BracketedPaste::OFF_THEN_CR.as_bytes()
                } else {
                    b"\r"
                });
                if end.col > 0 {
                    self.print(format_args!("{}{}C", CSI, end.col));
                }
                on_input_row = end.col > 0;
            }
            if paste_off {
                tty::mark_dec_modes_reset(tty::dec::BRACKETED_PASTE);
            }
        }
        self.write(echo);
        if on_input_row || !echo.is_empty() {
            self.write(b"\n");
        }
        self.suggestion.clear();
        if let Some(drawing) = &mut self.drawing {
            drawing.erased();
        }
    }

    // ========================================================================
    // Inline Suggestions (ghost text)
    // ========================================================================

    /// Walks `a.b.c` via property gets, not the evaluator (so `_` is untouched).
    fn resolve_object_expr(&self, expr: &[u8]) -> JSValue {
        let Some(global) = self.global else {
            return JSValue::UNDEFINED;
        };
        if expr.is_empty() {
            return JSValue::UNDEFINED;
        }

        let mut current = global.to_js_value();
        for (index, part) in strings::split(expr, b".").enumerate() {
            // Top-level `this` evaluates to globalThis in the REPL, which is where the walk starts.
            if index == 0 && part == b"this" {
                continue;
            }
            if !identifier::is_identifier(part) || current.is_undefined_or_null() {
                return JSValue::UNDEFINED;
            }
            // SAFETY: `global` is a live opaque `JSGlobalObject` handle; `part` borrows
            // from `expr`, which outlives the call.
            current = unsafe { Bun__REPL__getProperty(global, current, part.as_ptr(), part.len()) };
        }
        current
    }

    fn update_suggestion(&mut self) {
        self.suggestion.clear();

        if self.drawing.is_none() || !self.use_colors {
            return;
        }
        if self.input_mode != InputMode::Normal {
            return;
        }

        let line: Vec<u8> = self.line_editor.get_line().to_vec();
        if self.line_editor.cursor != line.len() {
            return;
        }
        if line.is_empty() || line[0] == b'.' {
            return; // skip REPL dot-commands
        }

        let Some(ctx) = parse_completion_context(&line, self.line_editor.cursor) else {
            return;
        };
        if (ctx.prefix.is_empty() && ctx.object_expr.is_empty()) || ends_inside_string(&[&line]) {
            return;
        }

        let Some(global) = self.global else {
            return;
        };

        let mut target = JSValue::UNDEFINED;
        if !ctx.object_expr.is_empty() {
            target = self.resolve_object_expr(ctx.object_expr);
            if target.is_undefined_or_null() {
                return;
            }
        }

        // SAFETY: `global` is a live opaque `JSGlobalObject` handle; the prefix ptr/len
        // pair is valid for the duration of the call.
        let completions = unsafe {
            Bun__REPL__getCompletions(global, target, ctx.prefix.as_ptr(), ctx.prefix.len())
        };

        let mut best_len: usize = usize::MAX;

        if !completions.is_undefined_or_null() && completions.is_array() {
            let len: u32 = match completions.get_length(global) {
                Ok(n) => n as u32,
                Err(_) => {
                    global.clear_exception();
                    0
                }
            };
            for idx in 0..len {
                let item = match completions.get_index(global, idx) {
                    Ok(v) => v,
                    Err(_) => {
                        global.clear_exception();
                        continue;
                    }
                };
                if !item.is_string() {
                    continue;
                }
                let slice = match item.to_utf8(global) {
                    Ok(s) => s,
                    Err(_) => {
                        global.clear_exception();
                        continue;
                    }
                };
                let name = slice.slice();
                let Some(rest) = name.strip_prefix(ctx.prefix) else {
                    continue;
                };
                // Skips keys like `"foo-bar"` or `"0"`, which can't follow a `.`.
                if rest.is_empty() || !identifier::is_identifier(name) {
                    continue;
                }
                if name.len() < best_len {
                    best_len = name.len();
                    self.suggestion.clear();
                    self.suggestion.extend_from_slice(rest);
                    if ctx.prefix.is_empty() {
                        break;
                    }
                }
            }
        }

        if self.suggestion.is_empty() && ctx.object_expr.is_empty() && !ctx.prefix.is_empty() {
            for &kw in JS_KEYWORDS {
                if kw.len() > ctx.prefix.len() && kw.starts_with(ctx.prefix) && kw.len() < best_len
                {
                    best_len = kw.len();
                    self.suggestion.clear();
                    self.suggestion.extend_from_slice(&kw[ctx.prefix.len()..]);
                }
            }
        }
    }

    fn accept_suggestion(&mut self) -> bool {
        if self.suggestion.is_empty() {
            return false;
        }
        let sugg = core::mem::take(&mut self.suggestion);
        let ok = self.line_editor.insert_slice(&sugg).is_ok();
        self.suggestion = sugg;
        self.suggestion.clear();
        ok
    }

    fn write_highlighted(&self, text: &[u8]) {
        let writer = Output::writer();
        let highlighter = fmt::QuickAndDirtyJavaScriptSyntaxHighlighter {
            text,
            opts: fmt::HighlighterOptions {
                enable_colors: true,
                check_for_unhighlighted_write: false,
                redact_sensitive_information: false,
            },
        };
        if writer.write_fmt(format_args!("{}", highlighter)).is_err() {
            let _ = writer.write_all(text);
        }
    }

    // ========================================================================
    // Code Completion
    // ========================================================================

    // ========================================================================
    // JavaScript Evaluation
    // ========================================================================

    fn evaluate_and_print(&mut self, code: &[u8]) {
        let Some(global) = self.global else {
            return;
        };
        let Some(vm) = self.vm else {
            return;
        };

        // Transform the code using REPL mode (hoists declarations, wraps result in { value: expr })
        let Some(transformed_code) = self.transform_for_repl(code) else {
            // Transform failed, try evaluating raw code (for syntax errors, etc.)
            self.evaluate_raw(code);
            return;
        };

        // Evaluate the transformed code
        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: `global` is a live opaque `JSGlobalObject` handle; slice ptr/len pairs
        // are valid for the duration of the call; `exception` is a stack local.
        let result = unsafe {
            Bun__REPL__evaluate(
                global,
                transformed_code.as_ptr(),
                transformed_code.len(),
                b"[repl]".as_ptr(),
                b"[repl]".len(),
                &raw mut exception,
            )
        };

        // Check for exception
        if !exception.is_undefined() && !exception.is_null() {
            self.set_last_error(exception);
            self.print_js_error(exception);
            return;
        }

        // Handle async IIFE results - wait for promise to resolve
        let mut resolved_result = result;
        if let Some(promise) = result.as_promise() {
            // Mark as handled BEFORE waiting to prevent unhandled rejection output
            jsc::JSPromise::opaque_mut(promise).set_handled();

            // Temporarily re-enable signal delivery so Ctrl+C can interrupt
            // the blocking waitForPromise call
            self.enable_signals_during_wait();
            // Note: reshaped for borrowck — call disable_signals_during_wait() explicitly on each return path below

            // Wait for the promise to settle, or for a SIGINT.
            if Self::wait_for_promise_or_sigint(vm, promise) {
                self.print(format_args!("\n"));
                self.disable_signals_during_wait();
                return;
            }

            // SAFETY: `vm.jsc_vm` is the live JSC VM handle for this thread.
            let jsc_vm_ref = vm.jsc_vm();
            // Check promise status after waiting
            match jsc::JSPromise::opaque_mut(promise).status() {
                PromiseStatus::Fulfilled => {
                    resolved_result = jsc::JSPromise::opaque_mut(promise).result(jsc_vm_ref);
                }
                PromiseStatus::Rejected => {
                    let rejection = jsc::JSPromise::opaque_mut(promise).result(jsc_vm_ref);
                    self.set_last_error(rejection);
                    // Set _error on the global object
                    let global_this = global.to_js_value();
                    global_this.put(global, b"_error", rejection);
                    self.print_js_error(rejection);
                    self.disable_signals_during_wait();
                    return;
                }
                PromiseStatus::Pending => {
                    // Interrupted by signal or timed out
                    self.print(format_args!("\n"));
                    self.disable_signals_during_wait();
                    return;
                }
            }
            self.disable_signals_during_wait();
        }

        // Extract the value from the result wrapper { value: expr }
        // The REPL transform wraps the last expression in { value: expr }
        let mut actual_result = resolved_result;
        if resolved_result.is_object() {
            // Wrapper is REPL-built { __proto__: null, value: ... } so getOwn shouldn't throw,
            // but if it does, propagate as a REPL error.
            let maybe_value =
                match resolved_result.get_own(global, &bun_core::String::static_("value")) {
                    Ok(v) => v,
                    Err(err) => {
                        let exc = global.take_exception(err);
                        self.set_last_error(exc);
                        self.print_js_error(exc);
                        vm.as_mut().tick();
                        return;
                    }
                };
            if let Some(value) = maybe_value {
                actual_result = value;
            }
        }

        // Store and print result
        self.set_last_result(actual_result);

        // Set _ to the last result (only if not undefined)
        // Use the global object as JSValue and put the property on it
        if !actual_result.is_undefined() {
            let global_this = global.to_js_value();
            global_this.put(global, b"_", actual_result);
        }

        if actual_result.is_undefined() {
            if self.use_colors {
                self.print(format_args!("{}undefined{}\n", Color::DIM, Color::RESET));
            } else {
                self.print(format_args!("undefined\n"));
            }
        } else {
            self.print_formatted_value(actual_result);
        }

        // Tick the event loop to handle any pending work
        vm.as_mut().tick();
    }

    /// Evaluate a script from `bun repl -e/--eval` or `-p/--print` non-interactively.
    /// Uses the REPL transform pipeline (TypeScript/JSX, top-level await, object literal
    /// wrapping, declaration hoisting), drains the event loop, and optionally prints the
    /// result to stdout. Errors are written to stderr.
    /// Returns true if an error occurred (the caller should set exit_code=1 and
    /// skip onBeforeExit); false on success (caller preserves process.exitCode).
    pub(super) fn eval_script(&mut self, code: &[u8], print_result: bool) -> bool {
        let Some(global) = self.global else {
            return true;
        };
        let Some(vm) = self.vm else {
            return true;
        };

        let no_color = env_var::NO_COLOR.get().unwrap_or(false);
        self.use_colors = Output::enable_ansi_colors_stdout() && !no_color;
        let stderr_colors = Output::enable_ansi_colors_stderr() && !no_color;

        // Empty / whitespace-only script: nothing to do (matches `node -e ""`)
        if strings::trim(code, b" \t\n\r").is_empty() {
            if print_result {
                if self.use_colors {
                    self.print(format_args!("{}undefined{}\n", Color::DIM, Color::RESET));
                } else {
                    self.print(format_args!("undefined\n"));
                }
            }
            return false;
        }

        let Some(transformed_code) = self.transform_for_repl(code) else {
            // Transform failed — fall back to raw evaluation for the error message
            let mut exception: JSValue = JSValue::UNDEFINED;
            // SAFETY: `global` is a live opaque `JSGlobalObject` handle; slice ptr/len pairs
            // are valid for the duration of the call; `exception` is a stack local.
            unsafe {
                let _ = Bun__REPL__evaluate(
                    global,
                    code.as_ptr(),
                    code.len(),
                    b"[eval]".as_ptr(),
                    b"[eval]".len(),
                    &raw mut exception,
                );
            }
            if !exception.is_undefined() && !exception.is_null() {
                self.print_js_error_to(exception, Output::error_writer(), stderr_colors);
            }
            return true;
        };

        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: `global` is a live opaque `JSGlobalObject` handle; slice ptr/len pairs
        // are valid for the duration of the call; `exception` is a stack local.
        let result = unsafe {
            Bun__REPL__evaluate(
                global,
                transformed_code.as_ptr(),
                transformed_code.len(),
                b"[eval]".as_ptr(),
                b"[eval]".len(),
                &raw mut exception,
            )
        };

        if !exception.is_undefined() && !exception.is_null() {
            self.print_js_error_to(exception, Output::error_writer(), stderr_colors);
            return true;
        }

        // If the transform wrapped in an async IIFE (top-level await), wait for it
        let mut resolved_result = result;
        if let Some(promise) = result.as_promise() {
            // SAFETY: `promise` is a live JSC heap cell; `vm.jsc_vm` is the
            // owning JSC VM handle for this thread.
            jsc::JSPromise::opaque_mut(promise).set_handled();
            // Interrupted (SIGINT forbids execution) ⇒ handled just below.
            let _ = vm
                .as_mut()
                .wait_for_promise(jsc::AnyPromise::Normal(promise));
            let jsc_vm_ref = vm.jsc_vm();
            match jsc::JSPromise::opaque_mut(promise).status() {
                PromiseStatus::Fulfilled => {
                    resolved_result = jsc::JSPromise::opaque_mut(promise).result(jsc_vm_ref)
                }
                PromiseStatus::Rejected => {
                    let rejection = jsc::JSPromise::opaque_mut(promise).result(jsc_vm_ref);
                    self.print_js_error_to(rejection, Output::error_writer(), stderr_colors);
                    return true;
                }
                PromiseStatus::Pending => return true,
            }
        }

        // Unwrap the { value: expr } wrapper produced by transform_for_repl
        let mut actual_result = resolved_result;
        if resolved_result.is_object() {
            let maybe_value =
                match resolved_result.get_own(global, &bun_core::String::static_("value")) {
                    Ok(v) => v,
                    Err(err) => {
                        let exc = global.take_exception(err);
                        self.print_js_error_to(exc, Output::error_writer(), stderr_colors);
                        return true;
                    }
                };
            if let Some(value) = maybe_value {
                actual_result = value;
            }
        }
        // Protect across tick() in case of GC
        let _prot = actual_result.protected();

        // Drain the event loop (timers, I/O, etc.) before printing / exiting
        vm.as_mut().tick();
        while vm.is_event_loop_alive() {
            vm.as_mut().tick();
            vm.as_mut().auto_tick_active();
        }

        if print_result {
            if actual_result.is_undefined() {
                if self.use_colors {
                    self.print(format_args!("{}undefined{}\n", Color::DIM, Color::RESET));
                } else {
                    self.print(format_args!("undefined\n"));
                }
            } else {
                self.print_formatted_value(actual_result);
            }
        }

        false
    }

    /// Evaluate code without REPL transforms (fallback for errors)
    /// The C++ Bun__REPL__evaluate handles setting _ and _error
    fn evaluate_raw(&mut self, code: &[u8]) {
        let Some(global) = self.global else {
            return;
        };

        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: `global` is a live opaque `JSGlobalObject` handle; slice ptr/len pairs
        // are valid for the duration of the call; `exception` is a stack local.
        let result = unsafe {
            Bun__REPL__evaluate(
                global,
                code.as_ptr(),
                code.len(),
                b"[repl]".as_ptr(),
                b"[repl]".len(),
                &raw mut exception,
            )
        };

        if !exception.is_undefined() && !exception.is_null() {
            self.set_last_error(exception);
            self.print_js_error(exception);
            return;
        }

        self.set_last_result(result);

        if !result.is_undefined() {
            self.print_formatted_value(result);
        } else if self.use_colors {
            self.print(format_args!("{}undefined{}\n", Color::DIM, Color::RESET));
        } else {
            self.print(format_args!("undefined\n"));
        }

        if let Some(vm) = self.vm {
            vm.as_mut().tick();
        }
    }

    /// Evaluate code and copy the result to clipboard instead of printing it
    fn evaluate_and_copy(&mut self, code: &[u8]) {
        let Some(global) = self.global else {
            return;
        };
        let Some(vm) = self.vm else {
            return;
        };

        let Some(transformed_code) = self.transform_for_repl(code) else {
            self.evaluate_raw(code);
            return;
        };

        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: `global` is a live opaque `JSGlobalObject` handle; slice ptr/len pairs
        // are valid for the duration of the call; `exception` is a stack local.
        let result = unsafe {
            Bun__REPL__evaluate(
                global,
                transformed_code.as_ptr(),
                transformed_code.len(),
                b"[repl]".as_ptr(),
                b"[repl]".len(),
                &raw mut exception,
            )
        };

        if !exception.is_undefined() && !exception.is_null() {
            self.set_last_error(exception);
            self.print_js_error(exception);
            return;
        }

        let mut resolved_result = result;
        if let Some(promise) = result.as_promise() {
            // SAFETY: `promise` is a live JSC heap cell; `vm.jsc_vm` is the
            // owning JSC VM handle for this thread.
            jsc::JSPromise::opaque_mut(promise).set_handled();
            self.enable_signals_during_wait();
            // Wait for the promise to settle, or for a SIGINT.
            if Self::wait_for_promise_or_sigint(vm, promise) {
                self.print(format_args!("\n"));
                self.disable_signals_during_wait();
                return;
            }
            let jsc_vm_ref = vm.jsc_vm();
            match jsc::JSPromise::opaque_mut(promise).status() {
                PromiseStatus::Fulfilled => {
                    resolved_result = jsc::JSPromise::opaque_mut(promise).result(jsc_vm_ref)
                }
                PromiseStatus::Rejected => {
                    let rejection = jsc::JSPromise::opaque_mut(promise).result(jsc_vm_ref);
                    self.set_last_error(rejection);
                    self.print_js_error(rejection);
                    self.disable_signals_during_wait();
                    return;
                }
                PromiseStatus::Pending => {
                    self.disable_signals_during_wait();
                    return;
                }
            }
            self.disable_signals_during_wait();
        }

        let mut actual_result = resolved_result;
        if resolved_result.is_object() {
            let maybe_value =
                match resolved_result.get_own(global, &bun_core::String::static_("value")) {
                    Ok(v) => v,
                    Err(err) => {
                        let exc = global.take_exception(err);
                        self.set_last_error(exc);
                        self.print_js_error(exc);
                        vm.as_mut().tick();
                        return;
                    }
                };
            if let Some(value) = maybe_value {
                actual_result = value;
            }
        }

        self.set_last_result(actual_result);
        if !actual_result.is_undefined() {
            let global_this = global.to_js_value();
            global_this.put(global, b"_", actual_result);
        }

        if let Err(err) = self.copy_value_to_clipboard(actual_result) {
            let exc = global.take_exception(err);
            self.set_last_error(exc);
            self.print_js_error(exc);
        }
        vm.as_mut().tick();
    }

    /// Format a JS value as a string suitable for clipboard.
    /// Returns None on allocator OOM; propagates JS exceptions (e.g. throwing getters).
    fn value_to_clipboard_string(&self, value: JSValue) -> JsResult<Option<Box<[u8]>>> {
        let Some(global) = self.global else {
            return Ok(None);
        };

        if value.is_undefined() {
            return Ok(Some(Box::<[u8]>::from(&b"undefined"[..])));
        }
        if value.is_null() {
            return Ok(Some(Box::<[u8]>::from(&b"null"[..])));
        }

        // For strings, copy the raw string value (not quoted/JSON-ified)
        if value.is_string() {
            let slice = value.to_utf8(global)?;
            return Ok(Some(Box::<[u8]>::from(slice.slice())));
        }

        // For everything else, use Bun.inspect without colors
        let mut array: Vec<u8> = Vec::new();
        jsc::ConsoleObject::format2(
            jsc::ConsoleObject::MessageLevel::Log,
            global,
            core::slice::from_ref(&value),
            &mut array,
            jsc::ConsoleObject::FormatOptions {
                enable_colors: false,
                add_newline: false,
                flush: false,
                quote_strings: true,
                ordered_properties: false,
                max_depth: 4,
                ..Default::default()
            },
        )?;
        Ok(Some(array.into_boxed_slice()))
    }

    /// Copy a JS value to the system clipboard via OSC 52.
    /// Propagates JS exceptions from value formatting; swallows I/O errors.
    fn copy_value_to_clipboard(&self, value: JSValue) -> JsResult<()> {
        let Some(text) = self.value_to_clipboard_string(value)? else {
            self.print_error(format_args!("Failed to format value for clipboard\n"));
            return Ok(());
        };

        if self.copy_to_clipboard_osc52(&text).is_err() {
            self.print_error(format_args!("Failed to write to clipboard\n"));
            return Ok(());
        }
        if self.use_colors {
            self.print(format_args!(
                "{}Copied {} characters to clipboard{}\n",
                Color::DIM,
                text.len(),
                Color::RESET
            ));
        } else {
            self.print(format_args!(
                "Copied {} characters to clipboard\n",
                text.len()
            ));
        }
        Ok(())
    }

    /// Write text to clipboard using OSC 52 escape sequence.
    fn copy_to_clipboard_osc52(&self, text: &[u8]) -> Result<(), crate::Error> {
        let mut it = strings::ANSIIterator::init(text);
        let Some(first) = it.next() else {
            return Ok(());
        };

        if first.len() == text.len() {
            // No ANSI sequences - encode the original directly
            let encoded: Vec<u8> = bun_base64::encode_alloc(text);
            self.write(b"\x1b]52;c;");
            self.write(&encoded);
            self.write(b"\x07");
        } else {
            // Has ANSI sequences - collect clean slices then encode
            let mut clean: Vec<u8> = Vec::with_capacity(text.len());
            clean.extend_from_slice(first);
            while let Some(slice) = it.next() {
                clean.extend_from_slice(slice);
            }
            let encoded: Vec<u8> = bun_base64::encode_alloc(&clean);
            self.write(b"\x1b]52;c;");
            self.write(&encoded);
            self.write(b"\x07");
        }
        Ok(())
    }

    /// Transform code using the REPL parser (hoists declarations, wraps expressions)
    fn transform_for_repl(&self, code: &[u8]) -> Option<Box<[u8]>> {
        let vm = self.vm?;

        // Skip empty code
        if code.is_empty() || strings::trim(code, b" \t\n\r").is_empty() {
            return None;
        }

        // Check if code looks like an object literal that would be misinterpreted as a block
        // If code starts with { (after whitespace) and doesn't end with ;
        let is_object_literal = is_likely_object_literal(code);
        let processed_buf: Option<Vec<u8>>;
        let processed_code: &[u8] = if is_object_literal {
            let mut v = Vec::with_capacity(code.len() + 2);
            v.push(b'(');
            v.extend_from_slice(code);
            v.push(b')');
            processed_buf = Some(v);
            processed_buf.as_deref().unwrap()
        } else {
            processed_buf = None;
            let _ = &processed_buf;
            code
        };

        // Create arena for parsing
        let arena = bun_alloc::Arena::new();

        // Set up parser options with repl_mode enabled
        let mut opts = bun_js_parser::ParserOptions::init(
            vm.transpiler.options.jsx.clone(),
            bun_ast::Loader::Tsx,
        );
        opts.repl_mode = true;
        opts.features.dead_code_elimination = false; // REPL needs all code
        opts.features.top_level_await = true; // Enable top-level await in REPL
        // Keep `lower_using` at its default (true) here even though JavaScriptCore
        // supports `using` / `await using` natively. The REPL transform in
        // `js_parser/repl_transforms.rs` rewrites every top-level `s_local` into a
        // hoisted `var` + assignment for cross-input persistence, which would
        // silently discard disposal semantics if `using` declarations survived
        // until that pass. Lowering wraps the declaration in `try/finally` first,
        // which the REPL transform passes through intact.

        // Initialize macro context from transpiler (required for import processing).
        if vm.transpiler.macro_context.is_none() {
            vm.as_mut().transpiler.macro_context = Some(bun_js_parser::Macro::MacroContext::init(
                &mut vm.as_mut().transpiler,
            ));
        }
        opts.macro_context = vm.as_mut().transpiler.macro_context.as_mut();

        // Create log for errors
        let mut log = bun_ast::Log::init();

        // Create source
        let source = bun_ast::Source::init_path_string(b"[repl]", processed_code);

        // Parse with REPL transforms
        let parser = match bun_js_parser::Parser::init(
            opts,
            &mut log,
            &source,
            &vm.transpiler.options.define,
            &arena,
        ) {
            Ok(p) => p,
            Err(_) => return None,
        };

        let parse_result = match parser.parse() {
            Ok(r) => r,
            Err(_) => return None,
        };
        let bun_js_parser::Result::Ast(mut ast) = parse_result else {
            return None;
        };
        // Don't call ast.deinit() - the arena handles cleanup

        // Check for parse errors
        if log.errors > 0 {
            return None;
        }
        // Print the transformed AST back to JavaScript
        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut buffer_printer = bun_js_printer::BufferPrinter::init(buffer_writer);

        // Create symbol map from ast.symbols
        // Note: `Map::init_with_one_list` takes ownership of `ast.symbols`
        // — see Symbol.rs note on the dangling-slice hazard.
        let arena = *ast.symbols.allocator();
        let symbols_map = bun_ast::symbol::Map::init_with_one_list(
            core::mem::replace(&mut ast.symbols, bun_alloc::ArenaVec::new_in(arena))
                .into_iter()
                .collect(),
        );

        if bun_js_printer::print_ast::<
            _,
            /* ASCII_ONLY */ true,
            /* GENERATE_SOURCE_MAP */ false,
        >(
            &mut buffer_printer,
            arena,
            &ast,
            symbols_map,
            &source,
            bun_js_printer::Options {
                mangled_props: None,
                ..Default::default()
            },
        )
        .is_err()
        {
            return None;
        }

        // Get the written buffer
        let written = buffer_printer.ctx.get_written();
        Some(Box::<[u8]>::from(written))
    }

    fn print_js_error(&self, error_value: JSValue) {
        // Interactive REPL writes everything to stdout (single terminal stream).
        self.print_js_error_to(error_value, Output::writer(), self.use_colors);
    }

    fn print_js_error_to(
        &self,
        error_value: JSValue,
        writer: &mut bun_core::io::Writer,
        enable_colors: bool,
    ) {
        // Note: the `bun_core::io::Writer` vtable doesn't implement
        // `bun_io::Write`, so buffer through a `Vec<u8>` (which does) and
        // flush in one shot — REPL error output is tiny.
        let Some(global) = self.global else {
            return;
        };
        let mut buf: Vec<u8> = Vec::new();
        // Use .Error level for proper error formatting with Bun.inspect
        if jsc::ConsoleObject::format2(
            jsc::ConsoleObject::MessageLevel::Error,
            global,
            core::slice::from_ref(&error_value),
            &mut buf,
            jsc::ConsoleObject::FormatOptions {
                enable_colors,
                add_newline: true,
                flush: false,
                quote_strings: true,
                ordered_properties: false,
                max_depth: 4,
                ..Default::default()
            },
        )
        .is_err()
        {
            // Formatting the error itself threw — clear it to avoid recursion and show a fallback.
            global.clear_exception();
            let _ = writer.write_all(b"error: [failed to format error]\n");
            return;
        }
        let _ = writer.write_all(&buf);
    }

    /// Format and print a JS value using Bun's console formatter (same as console.log)
    fn print_formatted_value(&mut self, value: JSValue) {
        let Some(global) = self.global else {
            return;
        };
        let writer = Output::writer();
        // Note: see `print_js_error_to` — buffer because
        // `bun_core::io::Writer` doesn't implement `bun_io::Write`.
        let mut buf: Vec<u8> = Vec::new();
        if let Err(err) = jsc::ConsoleObject::format2(
            jsc::ConsoleObject::MessageLevel::Log,
            global,
            core::slice::from_ref(&value),
            &mut buf,
            jsc::ConsoleObject::FormatOptions {
                enable_colors: self.use_colors,
                add_newline: true,
                flush: false,
                quote_strings: true,
                ordered_properties: false,
                max_depth: 4,
                ..Default::default()
            },
        ) {
            // A getter on the value threw during inspection — show that error.
            let exc = global.take_exception(err);
            self.set_last_error(exc);
            self.print_js_error(exc);
            return;
        }
        let _ = writer.write_all(&buf);
    }

    // ========================================================================
    // Main Loop
    // ========================================================================

    pub(super) fn run_with_vm(
        &mut self,
        vm: Option<&'a VirtualMachine>,
    ) -> Result<(), crate::Error> {
        self.vm = vm;
        if let Some(v) = vm {
            self.global = Some(v.global());
        }

        self.setup_terminal();
        // Note: defer self.restoreTerminal() — handled in Drop + explicit call at end

        self.history.load()?;

        // Print welcome message
        self.print(format_args!("Welcome to Bun v{}\n", VERSION));
        self.print(format_args!(
            "Type {}.copy [code]{} to copy to clipboard. {}.help{} for more info.\n\n",
            Color::CYAN,
            Color::RESET,
            Color::CYAN,
            Color::RESET
        ));

        self.running = true;
        self.refresh_line();

        // Decided once, by `setup_terminal`: what the bytes of stdin are.
        if self.drawing.is_some() {
            self.read_keys()?;
        } else {
            self.read_text_lines()?;
        }

        self.restore_terminal();
        self.history.save();
        Ok(())
    }

    /// For stdin that is not a raw terminal: every byte is text, and a line ends at LF, CR LF or CR.
    fn read_text_lines(&mut self) -> Result<(), crate::Error> {
        // An LF right after a CR is the same line end, also when it comes with the next read.
        let mut after_cr = false;
        while self.running {
            if self.stdin_buf_start == self.stdin_buf_end {
                match self.fill_stdin_buf() {
                    Ok(1..) => {}
                    Ok(0) => {
                        let ctrl_d = stdin_is_line_mode_terminal();
                        // The last line of a file need not end in a line end.
                        if (ctrl_d || !Output::is_stdin_tty())
                            && !self.line_editor.buffer.is_empty()
                        {
                            self.submit_text_line()?;
                        }
                        // Only the Ctrl+D key finishes `.editor`: a writer that was cut off also ends a pipe.
                        if ctrl_d && self.running && self.input_mode == InputMode::Editor {
                            self.finish_editor();
                        }
                        break;
                    }
                    // What was read so far may be cut off anywhere: do not run it.
                    Err(_) => break,
                }
            }
            let first = self.stdin_buf[self.stdin_buf_start];
            if core::mem::take(&mut after_cr) && first == b'\n' {
                self.stdin_buf_start += 1;
                continue;
            }
            // No line of text ends `.editor`: there the bytes of Ctrl+D and Ctrl+C stay keys at the start of a line.
            if matches!(first, 0x03 | 0x04)
                && self.input_mode == InputMode::Editor
                && self.line_editor.buffer.is_empty()
            {
                self.stdin_buf_start += 1;
                if first == 0x04 {
                    self.finish_editor();
                } else {
                    self.handle_ctrl_c();
                }
                continue;
            }
            let unread = &self.stdin_buf[self.stdin_buf_start..self.stdin_buf_end];
            let Some(line_end) = strings::index_of_any(unread, b"\r\n") else {
                self.line_editor.insert_text(unread);
                self.stdin_buf_start = self.stdin_buf_end;
                continue;
            };
            after_cr = unread[line_end] == b'\r';
            self.line_editor.insert_text(&unread[..line_end]);
            self.stdin_buf_start += line_end + 1;
            self.submit_text_line()?;
        }
        if self.running {
            self.leave_input(b"");
        }
        Ok(())
    }

    /// Enters the line that `read_text_lines` collected.
    fn submit_text_line(&mut self) -> Result<(), crate::Error> {
        replace_invalid_utf8(&mut self.line_editor.buffer);
        self.handle_enter()
    }

    /// Ends `.editor` mode and runs what it collected.
    fn finish_editor(&mut self) {
        self.leave_input(b"");
        // Text that is on the line but was not entered belongs to the buffer too.
        if !self.line_editor.buffer.is_empty() {
            self.editor_buffer
                .extend_from_slice(&self.line_editor.buffer);
            self.editor_buffer.push(b'\n');
            self.line_editor.clear();
        }
        // Note: reshaped for borrowck — clone editor_buffer slice before evaluate
        if !self.editor_buffer.is_empty() {
            let code = core::mem::take(&mut self.editor_buffer);
            self.evaluate_and_print(&code);
            self.editor_buffer = code;
        }
        self.input_mode = InputMode::Normal;
        self.editor_buffer.clear();
        self.refresh_line();
    }

    /// For a terminal in raw mode: every byte is a key press or part of one.
    fn read_keys(&mut self) -> Result<(), crate::Error> {
        while self.running {
            let Some(key) = self.read_key() else {
                // EOF
                self.leave_input(b"");
                break;
            };

            // Reset double-Ctrl+C state on any other key
            if key != Key::CtrlC {
                self.ctrl_c_pressed = false;
            }

            match key {
                Key::Enter => self.handle_enter()?,
                Key::CtrlC => self.handle_ctrl_c(),
                Key::CtrlD => match self.input_mode {
                    InputMode::Editor => self.finish_editor(),
                    InputMode::Normal if self.line_editor.buffer.is_empty() => {
                        self.print(format_args!("\n"));
                        self.running = false;
                    }
                    _ => {
                        self.line_editor.delete_char();
                        self.update_suggestion();
                        self.refresh_line();
                    }
                },
                Key::CtrlL => {
                    self.write(Cursor::CLEAR_SCREEN.as_bytes());
                    self.write(Cursor::HOME.as_bytes());
                    if let Some(drawing) = &mut self.drawing {
                        drawing.erased();
                    }
                    self.refresh_line();
                }
                Key::CtrlA => {
                    self.line_editor.move_to_start();
                    self.suggestion.clear();
                    self.refresh_line();
                }
                Key::CtrlE => {
                    if !self.accept_suggestion() {
                        self.line_editor.move_to_end();
                    }
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::CtrlB | Key::ArrowLeft => {
                    self.line_editor.move_left();
                    self.suggestion.clear();
                    self.refresh_line();
                }
                Key::CtrlF | Key::ArrowRight => {
                    if self.line_editor.cursor != self.line_editor.buffer.len()
                        || !self.accept_suggestion()
                    {
                        self.line_editor.move_right();
                    }
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::AltB | Key::AltLeft => {
                    self.line_editor.move_word_left();
                    self.suggestion.clear();
                    self.refresh_line();
                }
                Key::AltF | Key::AltRight => {
                    self.line_editor.move_word_right();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::CtrlU => {
                    self.line_editor.delete_to_start();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::CtrlK => {
                    self.line_editor.delete_to_end();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::CtrlW | Key::AltBackspace => {
                    self.line_editor.backspace_word();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::AltD => {
                    self.line_editor.delete_word();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::CtrlT => {
                    self.line_editor.swap();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::Backspace => {
                    self.line_editor.backspace();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::Delete => {
                    self.line_editor.delete_char();
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::ArrowUp | Key::CtrlP => {
                    // Note: reshaped for borrowck — copy line before mutating history
                    let cur = self.line_editor.get_line().to_vec();
                    if let Some(prev_line) = self.history.prev(&cur) {
                        let prev_line = prev_line.to_vec();
                        let _ = self.line_editor.set(&prev_line);
                        self.suggestion.clear();
                        self.refresh_line();
                    }
                }
                Key::ArrowDown | Key::CtrlN => {
                    if let Some(next_line) = self.history.next() {
                        let _ = self.line_editor.set(next_line);
                        self.suggestion.clear();
                        self.refresh_line();
                    }
                }
                Key::Tab => self.handle_tab(),
                Key::Paste => self.handle_paste(),
                Key::Home => {
                    self.line_editor.move_to_start();
                    self.suggestion.clear();
                    self.refresh_line();
                }
                Key::End => {
                    if !self.accept_suggestion() {
                        self.line_editor.move_to_end();
                    }
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::Char(c) => {
                    let _ = self.line_editor.insert(c);
                    self.update_suggestion();
                    self.refresh_line();
                }
                Key::Text(bytes, len) => {
                    let _ = self.line_editor.insert_slice(&bytes[..len]);
                    self.update_suggestion();
                    self.refresh_line();
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Inserts a bracketed paste as text. Also with several lines it waits on the line for the Enter key.
    fn handle_paste(&mut self) {
        let mut body = core::mem::take(&mut self.paste);
        replace_invalid_utf8(&mut body);
        self.line_editor.insert_text(&strings::crlf_as_lf(&body));
        self.update_suggestion();
        self.refresh_line();
        body.clear();
        self.paste = body;
    }

    fn handle_enter(&mut self) -> Result<(), crate::Error> {
        self.leave_input(b"");

        // Note: reshaped for borrowck — copy line out so we can call &mut self methods
        let line: Vec<u8> = self.line_editor.get_line().to_vec();

        if self.input_mode == InputMode::Editor {
            self.editor_buffer.extend_from_slice(&line);
            self.editor_buffer.push(b'\n');
            self.line_editor.clear();
            self.refresh_line();
            return Ok(());
        }

        // The line end that ends a paste is not part of a command, and does not make an empty line an entry.
        let entered = strings::trim_right(&line, b"\n");

        // Check for REPL commands. A TAB ends the name too: in text, no Tab key completed the name and added a blank.
        let space_idx = strings::index_of_any(entered, b" \t\n");
        // A name that a line end follows is the first line of pasted code, not a command.
        if !entered.is_empty()
            && entered[0] == b'.'
            && space_idx.is_none_or(|idx| entered[idx] != b'\n')
        {
            let cmd_name = if let Some(idx) = space_idx {
                &entered[..idx]
            } else {
                entered
            };
            let args = if let Some(idx) = space_idx {
                &entered[idx + 1..]
            } else {
                &b""[..]
            };

            if let Some(cmd) = ReplCommand::find(cmd_name) {
                let result = (cmd.handler)(self, args);
                match result {
                    ReplResult::ExitRepl => {
                        self.running = false;
                        return Ok(());
                    }
                    ReplResult::SkipEval => {
                        self.line_editor.clear();
                        self.history.reset_position();
                        self.refresh_line();
                        return Ok(());
                    }
                }
            } else {
                self.print_error(format_args!(
                    "Unknown command: {}\n",
                    bun_core::fmt::escape_control_chars(cmd_name)
                ));
                self.print(format_args!(
                    "Type {}.help{} for available commands\n",
                    Color::CYAN,
                    Color::RESET
                ));
                self.line_editor.clear();
                self.refresh_line();
                return Ok(());
            }
        }

        // Handle empty line
        if entered.is_empty() && self.input_mode != InputMode::Multiline {
            self.line_editor.clear();
            self.refresh_line();
            return Ok(());
        }

        // Check for multi-line input
        let full_code: &[u8] = if self.input_mode == InputMode::Multiline {
            self.multiline_buffer.extend_from_slice(&line);
            self.multiline_buffer.push(b'\n');
            &self.multiline_buffer
        } else {
            &line
        };

        if is_incomplete_code(full_code) {
            if self.input_mode != InputMode::Multiline {
                self.input_mode = InputMode::Multiline;
                self.multiline_buffer.extend_from_slice(&line);
                self.multiline_buffer.push(b'\n');
            }
            self.line_editor.clear();
            self.refresh_line();
            return Ok(());
        }

        // Complete code - evaluate it
        let code_to_eval: Box<[u8]> = if self.input_mode == InputMode::Multiline {
            Box::<[u8]>::from(self.multiline_buffer.as_slice())
        } else {
            Box::<[u8]>::from(line.as_slice())
        };

        self.history.add(strings::trim(&code_to_eval, b"\n"))?;

        self.evaluate_and_print(&code_to_eval);

        // Reset state
        self.line_editor.clear();
        self.multiline_buffer.clear();
        self.input_mode = InputMode::Normal;
        self.history.reset_position();
        self.refresh_line();
        Ok(())
    }

    fn handle_ctrl_c(&mut self) {
        let cancels_line =
            self.input_mode == InputMode::Normal && !self.line_editor.buffer.is_empty();
        self.leave_input(if cancels_line { b"^C" } else { b"" });
        self.line_editor.clear();
        match self.input_mode {
            InputMode::Editor => {
                self.print(format_args!(
                    "{}// Editor mode cancelled{}\n",
                    Color::DIM,
                    Color::RESET
                ));
                self.input_mode = InputMode::Normal;
                self.editor_buffer.clear();
            }
            InputMode::Multiline => {
                self.input_mode = InputMode::Normal;
                self.multiline_buffer.clear();
            }
            InputMode::Normal if cancels_line => {}
            InputMode::Normal if self.ctrl_c_pressed => {
                // Second Ctrl+C on empty line - exit
                self.running = false;
                return;
            }
            InputMode::Normal => {
                self.ctrl_c_pressed = true;
                self.print(format_args!(
                    "{}(press Ctrl+C again to exit, or Ctrl+D){}\n",
                    Color::DIM,
                    Color::RESET
                ));
            }
        }
        self.history.reset_position();
        self.refresh_line();
    }

    /// Tab with nothing to complete indents instead.
    fn insert_tab_spaces(&mut self) {
        let _ = self.line_editor.insert_slice(b"  ");
        self.refresh_line();
    }

    fn handle_tab(&mut self) {
        if !self.suggestion.is_empty() && self.line_editor.cursor == self.line_editor.buffer.len() {
            self.accept_suggestion();
            self.update_suggestion();
            self.refresh_line();
            return;
        }

        // Note: reshaped for borrowck — copy line out
        let line: Vec<u8> = self.line_editor.get_line().to_vec();

        // Complete REPL commands
        if !line.is_empty() && line[0] == b'.' {
            let mut matches: Vec<&'static [u8]> = Vec::new();

            for cmd in &ReplCommand::ALL {
                if cmd.name.starts_with(&line[..]) {
                    matches.push(cmd.name);
                }
            }

            if matches.len() == 1 {
                let _ = self.line_editor.set(matches[0]);
                let _ = self.line_editor.insert(b' ');
                self.refresh_line();
            } else if matches.len() > 1 {
                self.leave_input(b"");
                for m in &matches {
                    self.print(format_args!(
                        "  {}{}{}\n",
                        Color::CYAN,
                        BStr::new(m),
                        Color::RESET
                    ));
                }
                self.refresh_line();
            }
            return;
        }

        // Property completion using JSC
        let Some(global) = self.global else {
            self.insert_tab_spaces();
            return;
        };

        let cursor = self.line_editor.cursor;
        // A template literal may have been opened on an earlier line of this input.
        let earlier_lines: &[u8] = match self.input_mode {
            InputMode::Normal => b"",
            InputMode::Multiline => &self.multiline_buffer,
            InputMode::Editor => &self.editor_buffer,
        };
        if ends_inside_string(&[earlier_lines, &line[..cursor]]) {
            self.insert_tab_spaces();
            return;
        }

        // Mid-identifier (`con|sole`): completing would duplicate the suffix.
        if cursor < line.len() && is_word_byte(line[cursor]) {
            self.refresh_line();
            return;
        }

        let Some(ctx) = parse_completion_context(&line, cursor) else {
            self.insert_tab_spaces();
            return;
        };
        let word_start = ctx.prefix_start;
        let prefix = ctx.prefix;

        let mut target = JSValue::UNDEFINED;
        if !ctx.object_expr.is_empty() {
            target = self.resolve_object_expr(ctx.object_expr);
            if target.is_undefined_or_null() {
                self.insert_tab_spaces();
                return;
            }
        }

        // SAFETY: `global` is a live opaque `JSGlobalObject` handle; `prefix` ptr/len
        // are valid for the duration of the call.
        let completions =
            unsafe { Bun__REPL__getCompletions(global, target, prefix.as_ptr(), prefix.len()) };

        if completions.is_undefined() || !completions.is_array() {
            self.insert_tab_spaces();
            return;
        }

        // Get array length
        let len = match completions.get_length(global) {
            Ok(n) => n,
            Err(_) => {
                global.clear_exception();
                0
            }
        };
        if len == 0 {
            self.insert_tab_spaces();
            return;
        }

        if len == 1 {
            // Single completion - insert it
            let item = match completions.get_index(global, 0) {
                Ok(v) => v,
                Err(_) => {
                    global.clear_exception();
                    JSValue::UNDEFINED
                }
            };
            if item.is_string() {
                let slice = match item.to_utf8(global) {
                    Ok(s) => s,
                    Err(_) => {
                        global.clear_exception();
                        return;
                    }
                };
                let completion = slice.slice();
                if identifier::is_identifier(completion) {
                    while self.line_editor.cursor > word_start {
                        self.line_editor.backspace();
                    }
                    let _ = self.line_editor.insert_slice(completion);
                }
                self.refresh_line();
            }
        } else if len <= 50 {
            // Multiple completions - show them
            self.leave_input(b"");
            let mut i: u32 = 0;
            while i < (len as u32) {
                let item = match completions.get_index(global, i) {
                    Ok(v) => v,
                    Err(_) => {
                        global.clear_exception();
                        JSValue::UNDEFINED
                    }
                };
                if item.is_string() {
                    match item.to_utf8(global) {
                        Ok(slice) => {
                            self.print(format_args!(
                                "  {}{}{}\n",
                                Color::CYAN,
                                BStr::new(slice.slice()),
                                Color::RESET
                            ));
                        }
                        Err(_) => {
                            global.clear_exception();
                            i += 1;
                            continue;
                        }
                    }
                }
                i += 1;
            }
            self.refresh_line();
        } else {
            self.leave_input(b"");
            self.print(format_args!(
                "{}{} completions{}\n",
                Color::DIM,
                len,
                Color::RESET
            ));
            self.refresh_line();
        }
    }
}

impl<'a> Drop for Repl<'a> {
    fn drop(&mut self) {
        self.restore_terminal();
        self.history.save();
        // line_editor, history, multiline_buffer, editor_buffer, last_result,
        // last_error dropped automatically (ProtectedJSValue unprotects).
    }
}

/// The REPL is waiting on a promise and wants SIGINT to cut the wait short (async-signal-safe: atomics only).
static SIGINT_ARMED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
/// A SIGINT arrived during such a wait: stop waiting (the signal itself interrupts the loop's poll). Not a
/// VM stop — the VM stays usable.
static SIGINT_DURING_WAIT: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn sigint_handler(_: c_int) {
    if SIGINT_ARMED.load(core::sync::atomic::Ordering::Acquire) {
        SIGINT_DURING_WAIT.store(true, core::sync::atomic::Ordering::Release);
    }
}

/// C0 and DEL. No key press puts one into the line.
#[inline]
fn is_control_byte(byte: u8) -> bool {
    byte < 0x20 || byte == 0x7f
}

/// The lines of `text` around `cursor` that fit on a terminal of `height` rows: a redraw cannot go back to a row that scrolled off the top.
fn visible_lines(
    text: &[u8],
    cursor: usize,
    first_prefix: usize,
    width: usize,
    height: usize,
) -> core::ops::Range<usize> {
    // Two rows stay free: one for ghost text that wraps, one for the cursor after a full last row.
    let budget = height.saturating_sub(2).max(1);
    let rows_of = |start: usize, end: usize| {
        let prefix = if start == 0 {
            first_prefix
        } else {
            CONTINUATION_COLUMNS
        };
        let cells = prefix + strings::visible::width::exclude_ansi_colors::utf8(&text[start..end]);
        cells.div_ceil(width).max(1)
    };
    let mut start = strings::last_index_of_char(&text[..cursor], b'\n').map_or(0, |lf| lf + 1);
    let mut end =
        strings::index_of_char_usize(&text[cursor..], b'\n').map_or(text.len(), |lf| cursor + lf);
    let mut rows = rows_of(start, end);
    // The lines below the cursor first, then the lines above it.
    while end < text.len() {
        let next = end + 1;
        let next_end =
            strings::index_of_char_usize(&text[next..], b'\n').map_or(text.len(), |lf| next + lf);
        rows += rows_of(next, next_end);
        if rows > budget {
            break;
        }
        end = next_end;
    }
    while start > 0 && rows <= budget {
        let previous_end = start - 1;
        let previous =
            strings::last_index_of_char(&text[..previous_end], b'\n').map_or(0, |lf| lf + 1);
        rows += rows_of(previous, previous_end);
        if rows > budget {
            break;
        }
        start = previous;
    }
    start..end
}

/// Appends part of the input line as the terminal gets it: TAB as blanks to the next tab stop, other control characters spelled out.
fn push_display_form(out: &mut Vec<u8>, text: &[u8], column: &mut usize) {
    const TAB_STOP: usize = 8;
    let width = strings::visible::width::exclude_ansi_colors::utf8;
    for (index, part) in strings::split(text, b"\t").enumerate() {
        if index > 0 {
            let blanks = TAB_STOP - *column % TAB_STOP;
            out.extend(core::iter::repeat_n(b' ', blanks));
            *column += blanks;
        }
        let start = out.len();
        let _ = write!(
            out,
            "{}",
            bun_core::fmt::escape_control_chars_multiline(part)
        );
        let shown = &out[start..];
        // `write_lines` starts each later line after the continuation prompt.
        *column = match strings::last_index_of_char(shown, b'\n') {
            Some(lf) => CONTINUATION_COLUMNS + width(&shown[lf + 1..]),
            None => *column + width(shown),
        };
    }
}

/// Replaces each malformed UTF-8 sequence with U+FFFD: the parser and the highlighter need UTF-8.
fn replace_invalid_utf8(bytes: &mut Vec<u8>) {
    if !strings::is_valid_utf8(bytes) {
        *bytes = bstr::ByteSlice::to_str_lossy(bytes.as_slice())
            .into_owned()
            .into_bytes();
    }
}

/// Waits a moment for more of stdin. False when none came.
fn stdin_has_more_soon() -> bool {
    #[cfg(unix)]
    {
        const WAIT_MS: c_int = 500;
        let mut fds = [sys::posix::PollFd {
            fd: 0,
            events: sys::posix::POLL_IN,
            revents: 0,
        }];
        sys::posix::poll(&mut fds, WAIT_MS).is_ok_and(|ready| ready > 0)
    }
    // The console keeps Ctrl+C a signal (ENABLE_PROCESSED_INPUT): no 0x03 byte gets here from the key.
    #[cfg(not(unix))]
    {
        true
    }
}

/// Only on a terminal in line mode is a read of no bytes the Ctrl+D key. In another mode it is also a read timeout, a hang-up or, on Windows, Ctrl+C.
fn stdin_is_line_mode_terminal() -> bool {
    #[cfg(unix)]
    {
        Output::is_stdin_tty()
            && sys::posix::tcgetattr(0).is_ok_and(|termios| termios.c_lflag & libc::ICANON != 0)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

// ============================================================================
// Inline Suggestions (ghost text)
// ============================================================================

/// Word bytes for the prefix/chain scan; non-ASCII is taken wholesale (a junk prefix matches nothing).
#[inline]
fn is_word_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

/// Fallback suggestions when no global matches the prefix.
const JS_KEYWORDS: &[&[u8]] = &[
    b"async",
    b"await",
    b"break",
    b"case",
    b"catch",
    b"class",
    b"const",
    b"continue",
    b"debugger",
    b"default",
    b"delete",
    b"else",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"function",
    b"import",
    b"instanceof",
    b"let",
    b"new",
    b"null",
    b"return",
    b"static",
    b"super",
    b"switch",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"typeof",
    b"undefined",
    b"var",
    b"void",
    b"while",
    b"yield",
];

/// Text ends inside string/template content, where completing is noise; `${…}` holes hold code.
fn ends_inside_string(parts: &[&[u8]]) -> bool {
    let mut quote = 0u8;
    // Unclosed-brace count of each `${` hole being scanned, innermost last.
    let mut holes: Vec<u32> = Vec::new();
    for part in parts {
        let mut i = 0;
        while i < part.len() {
            let c = part[i];
            i += 1;
            if quote != 0 {
                match c {
                    b'\\' => i += 1,
                    b'$' if quote == b'`' && part.get(i) == Some(&b'{') => {
                        i += 1;
                        holes.push(1);
                        quote = 0;
                    }
                    _ if c == quote => quote = 0,
                    _ => {}
                }
            } else {
                match c {
                    b'"' | b'\'' | b'`' => quote = c,
                    b'{' => {
                        if let Some(depth) = holes.last_mut() {
                            *depth += 1;
                        }
                    }
                    b'}' => {
                        if let Some(depth) = holes.last_mut() {
                            *depth -= 1;
                            if *depth == 0 {
                                holes.pop();
                                quote = b'`';
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    quote != 0
}

/// `console.lo|` → `object_expr = "console"`, `prefix = "lo"`; empty `object_expr` = globalThis.
struct CompletionContext<'a> {
    object_expr: &'a [u8],
    prefix: &'a [u8],
    prefix_start: usize,
}

/// `None` for e.g. `foo().th|`: a property name follows the `.`, so globals/keywords don't apply.
fn parse_completion_context(line: &[u8], cursor: usize) -> Option<CompletionContext<'_>> {
    let mut i = cursor;
    while i > 0 && is_word_byte(line[i - 1]) {
        i -= 1;
    }
    let prefix_start = i;
    let prefix = &line[prefix_start..cursor];

    // A `..` ending at `end` is the tail of a spread (`[...args`, `[...a.b`), not member access.
    let member_dot_ends_at =
        |end: usize| end >= 1 && line[end - 1] == b'.' && (end < 2 || line[end - 2] != b'.');

    if !member_dot_ends_at(i) {
        return Some(CompletionContext {
            object_expr: b"",
            prefix,
            prefix_start,
        });
    }
    i -= 1; // skip the `.`
    let chain_end = i;

    loop {
        let ident_end = i;
        while i > 0 && is_word_byte(line[i - 1]) {
            i -= 1;
        }
        if i == ident_end {
            return None;
        }
        if !member_dot_ends_at(i) {
            break;
        }
        i -= 1;
    }

    Some(CompletionContext {
        object_expr: &line[i..chain_end],
        prefix,
        prefix_start,
    })
}

fn is_incomplete_code(code: &[u8]) -> bool {
    let mut brace_count: i32 = 0;
    let mut bracket_count: i32 = 0;
    let mut paren_count: i32 = 0;
    let mut in_string: u8 = 0;
    let mut in_template = false;
    let mut escaped = false;

    for &ch in code {
        if escaped {
            escaped = false;
            continue;
        }

        if ch == b'\\' {
            escaped = true;
            continue;
        }

        // Handle strings
        if in_string == 0 && !in_template {
            if ch == b'"' || ch == b'\'' {
                in_string = ch;
                continue;
            }
            if ch == b'`' {
                in_template = true;
                continue;
            }
        } else if in_string != 0 && ch == in_string {
            in_string = 0;
            continue;
        } else if in_template && ch == b'`' {
            in_template = false;
            continue;
        }

        // Skip content inside strings
        if in_string != 0 || in_template {
            continue;
        }

        // Count brackets
        match ch {
            // No later line completes a control byte at the top level (a piped `ESC [ A`): run it now, so that it fails. Inside a bracket it can be in a comment or a regex literal.
            0x00..=0x08 | 0x0e..=0x1f | 0x7f
                if brace_count <= 0 && bracket_count <= 0 && paren_count <= 0 =>
            {
                return false;
            }
            b'{' => brace_count += 1,
            b'}' => brace_count -= 1,
            b'[' => bracket_count += 1,
            b']' => bracket_count -= 1,
            b'(' => paren_count += 1,
            b')' => paren_count -= 1,
            _ => {}
        }
    }

    // Incomplete if any unclosed delimiters or unclosed strings
    in_string != 0 || in_template || brace_count > 0 || bracket_count > 0 || paren_count > 0
}

use crate::api::js_transpiler::is_likely_object_literal;

const VERSION: &str = Environment::VERSION_STRING;
