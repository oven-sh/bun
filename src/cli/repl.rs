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

use core::ffi::c_int;
use core::fmt::Arguments;
use std::io::Write as _;

use bstr::BStr;

use bun_core::{env_var, fmt, Environment, Output};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_paths::{self as path, PathBuffer};
use bun_str::strings;
use bun_sys::{self as sys, Fd};

// ============================================================================
// C++ Bindings
// ============================================================================

// TODO(port): move to cli_sys / jsc_sys
unsafe extern "C" {
    fn Bun__REPL__evaluate(
        globalObject: *mut JSGlobalObject,
        sourcePtr: *const u8,
        sourceLen: usize,
        filenamePtr: *const u8,
        filenameLen: usize,
        exception: *mut JSValue,
    ) -> JSValue;

    fn Bun__REPL__getCompletions(
        globalObject: *mut JSGlobalObject,
        targetValue: JSValue,
        prefixPtr: *const u8,
        prefixLen: usize,
    ) -> JSValue;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_SIZE: usize = 1000;
const MAX_LINE_LENGTH: usize = 16384;
const HISTORY_FILENAME: &[u8] = b".bun_repl_history";
const TAB_WIDTH: usize = 2;

// ANSI escape codes
const ESC: &str = "\x1b";
const CSI: &str = concat!("\x1b", "[");

// Colors
struct Color;
impl Color {
    const RESET: &'static str = concat!("\x1b", "[", "0m");
    const BOLD: &'static str = concat!("\x1b", "[", "1m");
    const DIM: &'static str = concat!("\x1b", "[", "2m");
    const RED: &'static str = concat!("\x1b", "[", "31m");
    const GREEN: &'static str = concat!("\x1b", "[", "32m");
    const YELLOW: &'static str = concat!("\x1b", "[", "33m");
    const BLUE: &'static str = concat!("\x1b", "[", "34m");
    const MAGENTA: &'static str = concat!("\x1b", "[", "35m");
    const CYAN: &'static str = concat!("\x1b", "[", "36m");
    const WHITE: &'static str = concat!("\x1b", "[", "37m");
}

// Cursor control
struct Cursor;
impl Cursor {
    const HIDE: &'static str = concat!("\x1b", "[", "?25l");
    const SHOW: &'static str = concat!("\x1b", "[", "?25h");
    const SAVE: &'static str = concat!("\x1b", "7");
    const RESTORE: &'static str = concat!("\x1b", "8");
    const HOME: &'static str = concat!("\x1b", "[", "H");
    const CLEAR_LINE: &'static str = concat!("\x1b", "[", "2K");
    const CLEAR_TO_END: &'static str = concat!("\x1b", "[", "0K");
    const CLEAR_TO_START: &'static str = concat!("\x1b", "[", "1K");
    const CLEAR_SCREEN: &'static str = concat!("\x1b", "[", "2J");
    const CLEAR_SCROLLBACK: &'static str = concat!("\x1b", "[", "3J");
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

    // Regular printable character
    Char(u8),

    // Unknown/unhandled
    Unknown,
}

impl Key {
    pub fn from_byte(byte: u8) -> Key {
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
    pub fn init() -> History {
        History {
            entries: Vec::new(),
            position: 0,
            temp_line: None,
            file_path: None,
            modified: false,
        }
    }

    pub fn load(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let Some(home_path) = env_var::HOME.get() else { return Ok(()); };
        if home_path.is_empty() {
            return Ok(());
        }

        let mut path_buf = PathBuffer::uninit();
        let path = path::join_z_buf(&mut path_buf, &[home_path, HISTORY_FILENAME], path::Platform::Auto);
        self.file_path = Some(Box::<[u8]>::from(path.as_bytes()));

        let content: Box<[u8]> = match sys::File::read_from(Fd::cwd(), path) {
            sys::Result::Ok(bytes) => bytes,
            sys::Result::Err(_) => return Ok(()),
        };

        for line in content.split(|&b| b == b'\n') {
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

    pub fn save(&mut self) {
        if !self.modified {
            return;
        }
        let Some(path) = self.file_path.as_deref() else { return; };

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

        let file = match sys::open_a(path, sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC, 0o644) {
            sys::Result::Ok(fd) => sys::File { handle: fd },
            sys::Result::Err(_) => return,
        };
        let _close = scopeguard::guard((), |_| file.close());
        match file.write_all(&content) {
            sys::Result::Ok(()) => {}
            sys::Result::Err(_) => return,
        }

        self.modified = false;
    }

    pub fn add(&mut self, line: &[u8]) -> Result<(), bun_alloc::AllocError> {
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

    pub fn prev(&mut self, current_line: &[u8]) -> Option<&[u8]> {
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

    pub fn next(&mut self) -> Option<&[u8]> {
        if self.position < self.entries.len() {
            self.position += 1;
        }

        if self.position == self.entries.len() {
            // Keep ownership in History; reset_position() frees temp_line.
            // Caller copies the data via set(), so borrowed reference is safe.
            return self.temp_line.as_deref();
        }

        if self.position < self.entries.len() {
            return Some(&self.entries[self.position]);
        }

        None
    }

    pub fn reset_position(&mut self) {
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
}

impl LineEditor {
    pub fn init() -> LineEditor {
        LineEditor { buffer: Vec::new(), cursor: 0 }
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
        self.cursor = 0;
    }

    pub fn set(&mut self, text: &[u8]) -> Result<(), bun_alloc::AllocError> {
        self.buffer.clear();
        self.buffer.extend_from_slice(text);
        self.cursor = text.len();
        Ok(())
    }

    pub fn insert(&mut self, ch: u8) -> Result<(), bun_alloc::AllocError> {
        if self.cursor == self.buffer.len() {
            self.buffer.push(ch);
        } else {
            self.buffer.insert(self.cursor, ch);
        }
        self.cursor += 1;
        Ok(())
    }

    pub fn insert_slice(&mut self, slice: &[u8]) -> Result<(), bun_alloc::AllocError> {
        if self.cursor == self.buffer.len() {
            self.buffer.extend_from_slice(slice);
        } else {
            // TODO(port): Vec has no insert_slice; splice is equivalent
            self.buffer.splice(self.cursor..self.cursor, slice.iter().copied());
        }
        self.cursor += slice.len();
        Ok(())
    }

    pub fn delete_char(&mut self) {
        if self.cursor < self.buffer.len() {
            self.buffer.remove(self.cursor);
        }
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
            self.buffer.remove(self.cursor);
        }
    }

    pub fn delete_word(&mut self) {
        // Delete word forward
        while self.cursor < self.buffer.len() && self.buffer[self.cursor].is_ascii_whitespace() {
            self.buffer.remove(self.cursor);
        }
        while self.cursor < self.buffer.len() && !self.buffer[self.cursor].is_ascii_whitespace() {
            self.buffer.remove(self.cursor);
        }
    }

    pub fn backspace_word(&mut self) {
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

    pub fn delete_to_end(&mut self) {
        self.buffer.truncate(self.cursor);
    }

    pub fn delete_to_start(&mut self) {
        if self.cursor > 0 {
            self.buffer.copy_within(self.cursor.., 0);
            let new_len = self.buffer.len() - self.cursor;
            self.buffer.truncate(new_len);
            self.cursor = 0;
        }
    }

    pub fn move_left(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
        }
    }

    pub fn move_right(&mut self) {
        if self.cursor < self.buffer.len() {
            self.cursor += 1;
        }
    }

    pub fn move_word_left(&mut self) {
        while self.cursor > 0 && self.buffer[self.cursor - 1].is_ascii_whitespace() {
            self.cursor -= 1;
        }
        while self.cursor > 0 && !self.buffer[self.cursor - 1].is_ascii_whitespace() {
            self.cursor -= 1;
        }
    }

    pub fn move_word_right(&mut self) {
        while self.cursor < self.buffer.len() && !self.buffer[self.cursor].is_ascii_whitespace() {
            self.cursor += 1;
        }
        while self.cursor < self.buffer.len() && self.buffer[self.cursor].is_ascii_whitespace() {
            self.cursor += 1;
        }
    }

    pub fn move_to_start(&mut self) {
        self.cursor = 0;
    }

    pub fn move_to_end(&mut self) {
        self.cursor = self.buffer.len();
    }

    pub fn swap(&mut self) {
        if self.cursor > 0 && self.cursor < self.buffer.len() {
            self.buffer.swap(self.cursor - 1, self.cursor);
            self.cursor += 1;
        } else if self.cursor > 1 && self.cursor == self.buffer.len() {
            self.buffer.swap(self.cursor - 2, self.cursor - 1);
        }
    }

    pub fn get_line(&self) -> &[u8] {
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
    pub const ALL: [ReplCommand; 9] = [
        ReplCommand { name: b".help", help: "Print this help message", handler: cmd_help },
        ReplCommand { name: b".exit", help: "Exit the REPL", handler: cmd_exit },
        ReplCommand { name: b".clear", help: "Clear the screen", handler: cmd_clear },
        ReplCommand { name: b".copy", help: "Copy result to clipboard (.copy [expr])", handler: cmd_copy },
        ReplCommand { name: b".load", help: "Load a file into the REPL session", handler: cmd_load },
        ReplCommand { name: b".save", help: "Save REPL history to a file", handler: cmd_save },
        ReplCommand { name: b".editor", help: "Enter multi-line editor mode", handler: cmd_editor },
        ReplCommand { name: b".break", help: "Cancel current input", handler: cmd_break },
        ReplCommand { name: b".history", help: "Show command history", handler: cmd_history },
    ];

    pub fn find(name: &[u8]) -> Option<&'static ReplCommand> {
        for cmd in &Self::ALL {
            if strings::eql_long(cmd.name, name, true)
                || (name.len() > 1 && cmd.name.starts_with(name))
            {
                return Some(cmd);
            }
        }
        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplResult {
    ContinueRepl,
    ExitRepl,
    SkipEval,
}

fn cmd_help(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.print(format_args!("\n{}REPL Commands:{}\n", Color::BOLD, Color::RESET));
    for cmd in &ReplCommand::ALL {
        repl.print(format_args!("  {}{:<12}{} {}\n", Color::CYAN, BStr::new(cmd.name), Color::RESET, cmd.help));
    }
    repl.print(format_args!("\n{}Keybindings:{}\n", Color::BOLD, Color::RESET));
    repl.print(format_args!("  {}Ctrl+A{}       Move to start of line\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+E{}       Move to end of line\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+B/F{}     Move backward/forward one character\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Alt+B/F{}      Move backward/forward one word\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+U{}       Delete to start of line\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+K{}       Delete to end of line\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+W{}       Delete word backward\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+D{}       Delete character / Exit if line empty\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+L{}       Clear screen\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Ctrl+T{}       Swap characters\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Up/Down{}      Navigate history\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}Tab{}          Auto-complete\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("\n{}Special Variables:{}\n", Color::BOLD, Color::RESET));
    repl.print(format_args!("  {}_{}            Last expression result\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("  {}_error{}       Last error\n", Color::CYAN, Color::RESET));
    repl.print(format_args!("\n"));
    ReplResult::SkipEval
}

fn cmd_copy(repl: &mut Repl, args: &[u8]) -> ReplResult {
    let code = strings::trim(args, b" \t");

    if code.is_empty() {
        // .copy with no args - copy _ (last result) to clipboard
        if let Err(err) = repl.copy_value_to_clipboard(repl.last_result) {
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

fn cmd_load(repl: &mut Repl, args: &[u8]) -> ReplResult {
    let filename = strings::trim(args, b" \t");
    if filename.is_empty() {
        repl.print_error(format_args!("Usage: .load <filename>\n"));
        return ReplResult::SkipEval;
    }

    let mut path_buf = PathBuffer::uninit();
    let path_z = path::z(filename, &mut path_buf);
    let content: Box<[u8]> = match sys::File::read_from(Fd::cwd(), path_z) {
        sys::Result::Ok(bytes) => bytes,
        sys::Result::Err(err) => {
            repl.print_error(format_args!("{}\n", err));
            return ReplResult::SkipEval;
        }
    };

    repl.print(format_args!("{}Loading {}...{}\n", Color::DIM, BStr::new(filename), Color::RESET));
    repl.evaluate_and_print(&content);
    ReplResult::SkipEval
}

fn cmd_save(repl: &mut Repl, args: &[u8]) -> ReplResult {
    let filename = strings::trim(args, b" \t");
    if filename.is_empty() {
        repl.print_error(format_args!("Usage: .save <filename>\n"));
        return ReplResult::SkipEval;
    }

    // Build content
    let mut content: Vec<u8> = Vec::new();
    for entry in &repl.history.entries {
        content.extend_from_slice(entry);
        content.push(b'\n');
    }

    let file = match sys::open_a(filename, sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC, 0o644) {
        sys::Result::Ok(fd) => sys::File { handle: fd },
        sys::Result::Err(err) => {
            repl.print_error(format_args!("{}\n", err));
            return ReplResult::SkipEval;
        }
    };
    let _close = scopeguard::guard((), |_| file.close());
    match file.write_all(&content) {
        sys::Result::Ok(()) => {}
        sys::Result::Err(err) => {
            repl.print_error(format_args!("{}\n", err));
            return ReplResult::SkipEval;
        }
    }

    repl.print(format_args!("{}Session saved to {}{}\n", Color::GREEN, BStr::new(filename), Color::RESET));
    ReplResult::SkipEval
}

fn cmd_editor(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.print(format_args!("{}// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel){}\n", Color::DIM, Color::RESET));
    repl.editor_mode = true;
    repl.editor_buffer.clear();
    ReplResult::SkipEval
}

fn cmd_break(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.line_editor.clear();
    repl.multiline_buffer.clear();
    repl.in_multiline = false;
    ReplResult::SkipEval
}

fn cmd_history(repl: &mut Repl, _: &[u8]) -> ReplResult {
    repl.print(format_args!("\n{}Command History:{}\n", Color::BOLD, Color::RESET));
    let start = if repl.history.entries.len() > 20 {
        repl.history.entries.len() - 20
    } else {
        0
    };
    for (i, entry) in repl.history.entries[start..].iter().enumerate() {
        let i = i + start;
        repl.print(format_args!("  {}{:>4}{}  {}\n", Color::DIM, i + 1, Color::RESET, BStr::new(entry)));
    }
    repl.print(format_args!("\n"));
    ReplResult::SkipEval
}

// ============================================================================
// Main REPL Struct
// ============================================================================

pub struct Repl<'a> {
    line_editor: LineEditor,
    history: History,
    multiline_buffer: Vec<u8>,
    editor_buffer: Vec<u8>,

    // State
    in_multiline: bool,
    editor_mode: bool,
    running: bool,
    is_tty: bool,
    use_colors: bool,
    terminal_width: u16,
    terminal_height: u16,
    ctrl_c_pressed: bool,

    // Buffered stdin
    stdin_buf: [u8; 256],
    stdin_buf_start: usize,
    stdin_buf_end: usize,

    // JavaScript VM (JSC_BORROW per LIFETIMES.tsv)
    vm: Option<&'a VirtualMachine>,
    global: Option<&'a JSGlobalObject>,

    // Special REPL variables
    // PORT NOTE: bare JSValue fields are safe here because Repl is stack-allocated
    // and values are explicitly protect()/unprotect()'d.
    last_result: JSValue,
    last_error: JSValue,

    // Windows: saved console mode for restoration
    #[cfg(windows)]
    original_windows_mode: Option<bun_sys::windows::DWORD>,
}

impl<'a> Repl<'a> {
    pub fn init() -> Repl<'a> {
        Repl {
            line_editor: LineEditor::init(),
            history: History::init(),
            multiline_buffer: Vec::new(),
            editor_buffer: Vec::new(),
            in_multiline: false,
            editor_mode: false,
            running: false,
            is_tty: false,
            use_colors: false,
            terminal_width: 80,
            terminal_height: 24,
            ctrl_c_pressed: false,
            stdin_buf: [0u8; 256],
            stdin_buf_start: 0,
            stdin_buf_end: 0,
            vm: None,
            global: None,
            last_result: JSValue::UNDEFINED,
            last_error: JSValue::UNDEFINED,
            #[cfg(windows)]
            original_windows_mode: None,
        }
    }

    fn set_last_result(&mut self, value: JSValue) {
        if !self.last_result.is_undefined() {
            self.last_result.unprotect();
        }
        self.last_result = value;
        if !value.is_undefined() {
            value.protect();
        }
    }

    fn set_last_error(&mut self, value: JSValue) {
        if !self.last_error.is_undefined() {
            self.last_error.unprotect();
        }
        self.last_error = value;
        if !value.is_undefined() {
            value.protect();
        }
    }

    // ========================================================================
    // Terminal I/O
    // ========================================================================

    fn setup_terminal(&mut self) {
        self.is_tty = Output::is_stdout_tty() && Output::is_stdin_tty();

        if !self.is_tty {
            self.use_colors = false;
            return;
        }

        // Check for NO_COLOR
        self.use_colors = !env_var::NO_COLOR.get();

        // Get terminal size
        if Output::terminal_size().col > 0 {
            self.terminal_width = Output::terminal_size().col;
            self.terminal_height = Output::terminal_size().row;
        }

        // Enable raw mode
        #[cfg(unix)]
        {
            let _ = bun_sys::tty::set_mode(0, bun_sys::tty::Mode::Raw);
        }
        #[cfg(windows)]
        {
            self.original_windows_mode = bun_sys::windows::update_stdio_mode_flags(
                bun_sys::windows::StdioKind::StdIn,
                bun_sys::windows::ModeFlags {
                    set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                        | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                    unset: bun_sys::windows::ENABLE_LINE_INPUT | bun_sys::windows::ENABLE_ECHO_INPUT,
                },
            )
            .ok();
        }
    }

    fn restore_terminal(&mut self) {
        #[cfg(unix)]
        {
            let _ = bun_sys::tty::set_mode(0, bun_sys::tty::Mode::Normal);
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
        if let Some(vm) = self.vm {
            // SAFETY: single-threaded; cleared in disable_signals_during_wait
            unsafe {
                SIGINT_VM = Some(vm.jsc_vm);
            }
        }

        #[cfg(unix)]
        {
            // Switch to normal terminal mode (has ISIG) so Ctrl+C generates SIGINT
            let _ = bun_sys::tty::set_mode(0, bun_sys::tty::Mode::Normal);

            // Install SIGINT handler
            // TODO(port): wrap std.posix.Sigaction in bun_sys
            let act = bun_sys::posix::Sigaction {
                handler: bun_sys::posix::SigHandler::Handler(sigint_handler),
                mask: bun_sys::posix::sigemptyset(),
                flags: 0,
            };
            // SAFETY: act is valid for the duration of the call
            unsafe {
                bun_sys::posix::sigaction(bun_sys::posix::SIG::INT, &act, core::ptr::null_mut());
            }
        }
        // On Windows, ENABLE_PROCESSED_INPUT is already set so Ctrl+C works
    }

    /// Restore raw terminal mode after promise wait
    fn disable_signals_during_wait(&mut self) {
        // SAFETY: single-threaded
        unsafe {
            SIGINT_VM = None;
        }

        #[cfg(unix)]
        {
            // Back to raw mode
            let _ = bun_sys::tty::set_mode(0, bun_sys::tty::Mode::Raw);

            // Restore default SIGINT handling
            let act = bun_sys::posix::Sigaction {
                handler: bun_sys::posix::SigHandler::Default,
                mask: bun_sys::posix::sigemptyset(),
                flags: 0,
            };
            // SAFETY: act is valid for the duration of the call
            unsafe {
                bun_sys::posix::sigaction(bun_sys::posix::SIG::INT, &act, core::ptr::null_mut());
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

    fn read_byte(&mut self) -> Option<u8> {
        if self.stdin_buf_start < self.stdin_buf_end {
            let b = self.stdin_buf[self.stdin_buf_start];
            self.stdin_buf_start += 1;
            return Some(b);
        }
        // Refill buffer
        let stdin = sys::File { handle: Fd::stdin() };
        let n = match stdin.read(&mut self.stdin_buf) {
            sys::Result::Ok(n) => n,
            sys::Result::Err(_) => return None,
        };
        if n == 0 {
            return None;
        }
        self.stdin_buf_start = 1;
        self.stdin_buf_end = n;
        Some(self.stdin_buf[0])
    }

    fn read_key(&mut self) -> Option<Key> {
        let byte = self.read_byte()?;

        // Handle escape sequences
        if byte == 27 {
            // ESC
            let Some(second) = self.read_byte() else { return Some(Key::Escape); };

            if second == b'[' {
                // CSI
                let Some(third) = self.read_byte() else { return Some(Key::Escape); };

                return Some(match third {
                    b'A' => Key::ArrowUp,
                    b'B' => Key::ArrowDown,
                    b'C' => Key::ArrowRight,
                    b'D' => Key::ArrowLeft,
                    b'H' => Key::Home,
                    b'F' => Key::End,
                    b'1'..=b'6' => 'blk: {
                        let Some(fourth) = self.read_byte() else { break 'blk Key::Unknown; };
                        if fourth == b'~' {
                            break 'blk match third {
                                b'1' => Key::Home,
                                b'2' => Key::Unknown, // insert
                                b'3' => Key::Delete,
                                b'4' => Key::End,
                                b'5' => Key::PageUp,
                                b'6' => Key::PageDown,
                                _ => Key::Unknown,
                            };
                        } else if fourth == b';' {
                            let Some(modifier) = self.read_byte() else { break 'blk Key::Unknown; };
                            let Some(dir) = self.read_byte() else { break 'blk Key::Unknown; };
                            if modifier == b'5' || modifier == b'3' {
                                break 'blk match dir {
                                    b'C' => Key::AltRight,
                                    b'D' => Key::AltLeft,
                                    _ => Key::Unknown,
                                };
                            }
                            break 'blk Key::Unknown;
                        }
                        Key::Unknown
                    }
                    _ => Key::Unknown,
                });
            } else if second == b'O' {
                // SS3
                let Some(third) = self.read_byte() else { return Some(Key::Escape); };
                return Some(match third {
                    b'H' => Key::Home,
                    b'F' => Key::End,
                    _ => Key::Unknown,
                });
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

        Some(Key::from_byte(byte))
    }

    // ========================================================================
    // Prompt and Display
    // ========================================================================

    fn get_prompt(&self) -> &'static [u8] {
        if self.in_multiline || self.editor_mode {
            if self.use_colors {
                return concat!("\x1b[2m", "... ", "\x1b[0m").as_bytes();
            } else {
                return b"... ";
            }
        }

        if self.use_colors {
            concat!("\x1b[2m", "\u{276f}", "\x1b[0m", " ").as_bytes()
        } else {
            b"> "
        }
    }

    fn get_prompt_length(&self) -> usize {
        if self.in_multiline || self.editor_mode {
            return 4; // "... "
        }
        2 // "> " or "\u{276f} "
    }

    fn refresh_line(&self) {
        // Flush any buffered output (e.g., from console.log in JS) before drawing prompt
        Output::flush();

        let prompt = self.get_prompt();
        let prompt_len = self.get_prompt_length();
        let line = self.line_editor.get_line();

        // Move to beginning of line
        self.write(b"\r");
        self.write(Cursor::CLEAR_LINE.as_bytes());

        // Write prompt
        self.write(prompt);

        // Write line with syntax highlighting
        if self.use_colors && !line.is_empty() && line.len() <= 2048 {
            self.write_highlighted(line);
        } else {
            self.write(line);
        }

        // Position cursor
        let cursor_pos = prompt_len + self.line_editor.cursor;
        if cursor_pos < self.terminal_width as usize {
            self.write(b"\r");
            if cursor_pos > 0 {
                let mut buf = [0u8; 16];
                let mut w: &mut [u8] = &mut buf;
                if write!(w, "{}{}C", CSI, cursor_pos).is_ok() {
                    let written = 16 - w.len();
                    self.write(&buf[..written]);
                }
            }
        }

        Output::flush();
    }

    fn write_highlighted(&self, text: &[u8]) {
        let writer = Output::writer();
        let highlighter = fmt::QuickAndDirtyJavaScriptSyntaxHighlighter {
            text,
            opts: fmt::HighlighterOpts {
                enable_colors: true,
                check_for_unhighlighted_write: false,
            },
        };
        if highlighter.format(writer).is_err() {
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
        let Some(global) = self.global else { return; };
        let Some(vm) = self.vm else { return; };

        // Transform the code using REPL mode (hoists declarations, wraps result in { value: expr })
        let Some(transformed_code) = self.transform_for_repl(code) else {
            // Transform failed, try evaluating raw code (for syntax errors, etc.)
            self.evaluate_raw(code);
            return;
        };

        // Evaluate the transformed code
        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: global is a valid JSGlobalObject; pointers/lengths are valid for the call
        let result = unsafe {
            Bun__REPL__evaluate(
                global as *const _ as *mut _,
                transformed_code.as_ptr(),
                transformed_code.len(),
                b"[repl]".as_ptr(),
                b"[repl]".len(),
                &mut exception,
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
            promise.set_handled();

            // Temporarily re-enable signal delivery so Ctrl+C can interrupt
            // the blocking waitForPromise call
            self.enable_signals_during_wait();
            // PORT NOTE: reshaped for borrowck — call disable_signals_during_wait() explicitly on each return path below

            // Wait for the promise to settle
            vm.wait_for_promise(jsc::AnyPromise::Normal(promise));

            // If execution was forbidden by SIGINT, clear it and report
            if vm.jsc_vm.execution_forbidden() {
                vm.jsc_vm.set_execution_forbidden(false);
                global.clear_termination_exception();
                self.print(format_args!("\n"));
                self.disable_signals_during_wait();
                return;
            }

            // Check promise status after waiting
            match promise.status() {
                jsc::PromiseStatus::Fulfilled => {
                    resolved_result = promise.result(vm.jsc_vm);
                }
                jsc::PromiseStatus::Rejected => {
                    let rejection = promise.result(vm.jsc_vm);
                    self.set_last_error(rejection);
                    // Set _error on the global object
                    let global_this = global.to_js_value();
                    global_this.put(global, "_error", rejection);
                    self.print_js_error(rejection);
                    self.disable_signals_during_wait();
                    return;
                }
                jsc::PromiseStatus::Pending => {
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
            let maybe_value = match resolved_result.get_own(global, "value") {
                Ok(v) => v,
                Err(err) => {
                    let exc = global.take_exception(err);
                    self.set_last_error(exc);
                    self.print_js_error(exc);
                    vm.tick();
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
            global_this.put(global, "_", actual_result);
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
        vm.tick();
    }

    /// Evaluate a script from `bun repl -e/--eval` or `-p/--print` non-interactively.
    /// Uses the REPL transform pipeline (TypeScript/JSX, top-level await, object literal
    /// wrapping, declaration hoisting), drains the event loop, and optionally prints the
    /// result to stdout. Errors are written to stderr.
    /// Returns true if an error occurred (the caller should set exit_code=1 and
    /// skip onBeforeExit); false on success (caller preserves process.exitCode).
    pub fn eval_script(&mut self, code: &[u8], print_result: bool) -> bool {
        let Some(global) = self.global else { return true; };
        let Some(vm) = self.vm else { return true; };

        let no_color = env_var::NO_COLOR.get();
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
            // SAFETY: global is valid; pointers/lengths are valid for the call
            unsafe {
                let _ = Bun__REPL__evaluate(
                    global as *const _ as *mut _,
                    code.as_ptr(),
                    code.len(),
                    b"[eval]".as_ptr(),
                    b"[eval]".len(),
                    &mut exception,
                );
            }
            if !exception.is_undefined() && !exception.is_null() {
                self.print_js_error_to(exception, Output::error_writer(), stderr_colors);
            }
            return true;
        };

        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: global is valid; pointers/lengths are valid for the call
        let result = unsafe {
            Bun__REPL__evaluate(
                global as *const _ as *mut _,
                transformed_code.as_ptr(),
                transformed_code.len(),
                b"[eval]".as_ptr(),
                b"[eval]".len(),
                &mut exception,
            )
        };

        if !exception.is_undefined() && !exception.is_null() {
            self.print_js_error_to(exception, Output::error_writer(), stderr_colors);
            return true;
        }

        // If the transform wrapped in an async IIFE (top-level await), wait for it
        let mut resolved_result = result;
        if let Some(promise) = result.as_promise() {
            promise.set_handled();
            vm.wait_for_promise(jsc::AnyPromise::Normal(promise));
            match promise.status() {
                jsc::PromiseStatus::Fulfilled => resolved_result = promise.result(vm.jsc_vm),
                jsc::PromiseStatus::Rejected => {
                    let rejection = promise.result(vm.jsc_vm);
                    self.print_js_error_to(rejection, Output::error_writer(), stderr_colors);
                    return true;
                }
                jsc::PromiseStatus::Pending => return true,
            }
        }

        // Unwrap the { value: expr } wrapper produced by transform_for_repl
        let mut actual_result = resolved_result;
        if resolved_result.is_object() {
            let maybe_value = match resolved_result.get_own(global, "value") {
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
        if !actual_result.is_undefined() {
            actual_result.protect();
        }
        let _unprotect = scopeguard::guard(actual_result, |v| {
            if !v.is_undefined() {
                v.unprotect();
            }
        });

        // Drain the event loop (timers, I/O, etc.) before printing / exiting
        vm.tick();
        while vm.is_event_loop_alive() {
            vm.tick();
            vm.event_loop().auto_tick_active();
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
        let Some(global) = self.global else { return; };

        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: global is valid; pointers/lengths are valid for the call
        let result = unsafe {
            Bun__REPL__evaluate(
                global as *const _ as *mut _,
                code.as_ptr(),
                code.len(),
                b"[repl]".as_ptr(),
                b"[repl]".len(),
                &mut exception,
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
            vm.tick();
        }
    }

    /// Evaluate code and copy the result to clipboard instead of printing it
    fn evaluate_and_copy(&mut self, code: &[u8]) {
        let Some(global) = self.global else { return; };
        let Some(vm) = self.vm else { return; };

        let Some(transformed_code) = self.transform_for_repl(code) else {
            self.evaluate_raw(code);
            return;
        };

        let mut exception: JSValue = JSValue::UNDEFINED;
        // SAFETY: global is valid; pointers/lengths are valid for the call
        let result = unsafe {
            Bun__REPL__evaluate(
                global as *const _ as *mut _,
                transformed_code.as_ptr(),
                transformed_code.len(),
                b"[repl]".as_ptr(),
                b"[repl]".len(),
                &mut exception,
            )
        };

        if !exception.is_undefined() && !exception.is_null() {
            self.set_last_error(exception);
            self.print_js_error(exception);
            return;
        }

        let mut resolved_result = result;
        if let Some(promise) = result.as_promise() {
            promise.set_handled();
            self.enable_signals_during_wait();
            // PORT NOTE: reshaped for borrowck — disable_signals_during_wait called on each path
            vm.wait_for_promise(jsc::AnyPromise::Normal(promise));
            if vm.jsc_vm.execution_forbidden() {
                vm.jsc_vm.set_execution_forbidden(false);
                global.clear_termination_exception();
                self.print(format_args!("\n"));
                self.disable_signals_during_wait();
                return;
            }
            match promise.status() {
                jsc::PromiseStatus::Fulfilled => resolved_result = promise.result(vm.jsc_vm),
                jsc::PromiseStatus::Rejected => {
                    let rejection = promise.result(vm.jsc_vm);
                    self.set_last_error(rejection);
                    self.print_js_error(rejection);
                    self.disable_signals_during_wait();
                    return;
                }
                jsc::PromiseStatus::Pending => {
                    self.disable_signals_during_wait();
                    return;
                }
            }
            self.disable_signals_during_wait();
        }

        let mut actual_result = resolved_result;
        if resolved_result.is_object() {
            let maybe_value = match resolved_result.get_own(global, "value") {
                Ok(v) => v,
                Err(err) => {
                    let exc = global.take_exception(err);
                    self.set_last_error(exc);
                    self.print_js_error(exc);
                    vm.tick();
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
            global_this.put(global, "_", actual_result);
        }

        if let Err(err) = self.copy_value_to_clipboard(actual_result) {
            let exc = global.take_exception(err);
            self.set_last_error(exc);
            self.print_js_error(exc);
        }
        vm.tick();
    }

    /// Format a JS value as a string suitable for clipboard.
    /// Returns None on allocator OOM; propagates JS exceptions (e.g. throwing getters).
    fn value_to_clipboard_string(&self, value: JSValue) -> JsResult<Option<Box<[u8]>>> {
        let Some(global) = self.global else { return Ok(None); };

        if value.is_undefined() {
            return Ok(Some(Box::<[u8]>::from(&b"undefined"[..])));
        }
        if value.is_null() {
            return Ok(Some(Box::<[u8]>::from(&b"null"[..])));
        }

        // For strings, copy the raw string value (not quoted/JSON-ified)
        if value.is_string() {
            let slice = value.to_slice(global)?;
            return Ok(Some(Box::<[u8]>::from(slice.slice())));
        }

        // For everything else, use Bun.inspect without colors
        let mut array: Vec<u8> = Vec::new();
        jsc::ConsoleObject::format2(
            jsc::ConsoleLevel::Log,
            global,
            &[value],
            1,
            &mut array,
            jsc::ConsoleFormatOptions {
                enable_colors: false,
                add_newline: false,
                flush: false,
                quote_strings: true,
                ordered_properties: false,
                max_depth: 4,
            },
        )?;
        // TODO(port): array.writer.flush() — Vec<u8> writer needs no flush
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
            self.print(format_args!("{}Copied {} characters to clipboard{}\n", Color::DIM, text.len(), Color::RESET));
        } else {
            self.print(format_args!("Copied {} characters to clipboard\n", text.len()));
        }
        Ok(())
    }

    /// Write text to clipboard using OSC 52 escape sequence.
    fn copy_to_clipboard_osc52(&self, text: &[u8]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut it = strings::ANSIIterator::init(text);
        let Some(first) = it.next() else { return Ok(()); };

        if first.len() == text.len() {
            // No ANSI sequences - encode the original directly
            let encoded = bun_base64::encode_alloc(text)?;
            self.write(b"\x1b]52;c;");
            self.write(encoded.slice());
            self.write(b"\x07");
        } else {
            // Has ANSI sequences - collect clean slices then encode
            let mut clean: Vec<u8> = Vec::with_capacity(text.len());
            // PERF(port): was assume_capacity
            clean.extend_from_slice(first);
            while let Some(slice) = it.next() {
                // PERF(port): was assume_capacity
                clean.extend_from_slice(slice);
            }
            let encoded = bun_base64::encode_alloc(&clean)?;
            self.write(b"\x1b]52;c;");
            self.write(encoded.slice());
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
        // PERF(port): was MimallocArena bulk-free — using bumpalo per AST-crate convention
        let arena = bun_alloc::Arena::new();

        // Set up parser options with repl_mode enabled
        let mut opts = bun_js_parser::Parser::Options::init(&vm.transpiler.options.jsx, bun_js_parser::Loader::Tsx);
        opts.repl_mode = true;
        opts.features.dead_code_elimination = false; // REPL needs all code
        opts.features.top_level_await = true; // Enable top-level await in REPL
        // Keep `lower_using` at its default (true) here even though JavaScriptCore
        // supports `using` / `await using` natively. The REPL transform in
        // `ast/repl_transforms.zig` rewrites every top-level `s_local` into a
        // hoisted `var` + assignment for cross-input persistence, which would
        // silently discard disposal semantics if `using` declarations survived
        // until that pass. Lowering wraps the declaration in `try/finally` first,
        // which the REPL transform passes through intact.

        // Initialize macro context from transpiler (required for import processing)
        if vm.transpiler.macro_context.is_none() {
            // TODO(port): vm is &VirtualMachine (immutable borrow); Zig mutates here. Phase B: interior mutability or &mut.
            vm.transpiler.macro_context = Some(bun_js_parser::ast::Macro::MacroContext::init(&vm.transpiler));
        }
        opts.macro_context = vm.transpiler.macro_context.as_ref();

        // Create log for errors
        let mut log = bun_logger::Log::init();

        // Create source
        let source = bun_logger::Source::init_path_string(b"[repl]", processed_code);

        // Parse with REPL transforms
        let mut parser = match bun_js_parser::Parser::init(
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
        let bun_js_parser::ParseResult::Ast(ast) = parse_result else { return None; };
        // Don't call ast.deinit() - the arena handles cleanup

        // Check for parse errors
        if log.errors > 0 {
            return None;
        }
        // Print the transformed AST back to JavaScript
        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut buffer_printer = bun_js_printer::BufferPrinter::init(buffer_writer);

        // Create symbol map from ast.symbols
        let symbols_nested = bun_js_parser::ast::Symbol::NestedList::from_borrowed_slice_dangerous(&[ast.symbols]);
        let symbols_map = bun_js_parser::ast::Symbol::Map::init_list(symbols_nested);

        if bun_js_printer::print_ast(
            &mut buffer_printer,
            ast,
            symbols_map,
            &source,
            true, // ascii_only
            bun_js_printer::Options { mangled_props: None },
            false, // generate_source_map
        )
        .is_err()
        {
            return None;
        }

        // Get the written buffer
        let written = buffer_printer.ctx.get_written();
        Some(Box::<[u8]>::from(written))
    }

    fn set_repl_variables(&self) {
        // For now, we rely on the C++ evaluation to handle this
        // The C++ code sets _ and _error after each evaluation
        let _ = self;
    }

    fn print_js_error(&self, error_value: JSValue) {
        // Interactive REPL writes everything to stdout (single terminal stream).
        self.print_js_error_to(error_value, Output::writer(), self.use_colors);
    }

    fn print_js_error_to(&self, error_value: JSValue, writer: &mut dyn bun_io::Write, enable_colors: bool) {
        // TODO(port): writer type — Zig uses *std.Io.Writer; using trait object placeholder
        let Some(global) = self.global else { return; };
        // Use .Error level for proper error formatting with Bun.inspect
        if jsc::ConsoleObject::format2(
            jsc::ConsoleLevel::Error,
            global,
            &[error_value],
            1,
            writer,
            jsc::ConsoleFormatOptions {
                enable_colors,
                add_newline: true,
                flush: false,
                quote_strings: true,
                ordered_properties: false,
                max_depth: 4,
            },
        )
        .is_err()
        {
            // Formatting the error itself threw — clear it to avoid recursion and show a fallback.
            global.clear_exception();
            let _ = writer.write_all(b"error: [failed to format error]\n");
        }
    }

    /// Format and print a JS value using Bun's console formatter (same as console.log)
    fn print_formatted_value(&mut self, value: JSValue) {
        let Some(global) = self.global else { return; };
        let writer = Output::writer();
        if let Err(err) = jsc::ConsoleObject::format2(
            jsc::ConsoleLevel::Log,
            global,
            &[value],
            1,
            writer,
            jsc::ConsoleFormatOptions {
                enable_colors: self.use_colors,
                add_newline: true,
                flush: false,
                quote_strings: true,
                ordered_properties: false,
                max_depth: 4,
            },
        ) {
            // A getter on the value threw during inspection — show that error.
            let exc = global.take_exception(err);
            self.set_last_error(exc);
            self.print_js_error(exc);
        }
    }

    // ========================================================================
    // Main Loop
    // ========================================================================

    pub fn run(&mut self) -> Result<(), bun_core::Error> {
        self.run_with_vm(None)
    }

    pub fn run_with_vm(&mut self, vm: Option<&'a VirtualMachine>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.vm = vm;
        if let Some(v) = vm {
            self.global = Some(v.global);
        }

        self.setup_terminal();
        // PORT NOTE: defer self.restoreTerminal() — handled in Drop + explicit call at end

        self.history.load()?;

        // Print welcome message
        self.print(format_args!("Welcome to Bun v{}\n", VERSION));
        self.print(format_args!(
            "Type {}.copy [code]{} to copy to clipboard. {}.help{} for more info.\n\n",
            Color::CYAN, Color::RESET, Color::CYAN, Color::RESET
        ));

        self.running = true;
        self.refresh_line();

        while self.running {
            let Some(key) = self.read_key() else {
                // EOF
                self.print(format_args!("\n"));
                break;
            };

            // Reset double-Ctrl+C state on any other key
            if key != Key::CtrlC {
                self.ctrl_c_pressed = false;
            }

            match key {
                Key::Enter => self.handle_enter()?,
                Key::CtrlC => self.handle_ctrl_c(),
                Key::CtrlD => {
                    if self.editor_mode {
                        // Finish editor mode
                        self.print(format_args!("\n"));
                        // PORT NOTE: reshaped for borrowck — clone editor_buffer slice before evaluate
                        if !self.editor_buffer.is_empty() {
                            let code = core::mem::take(&mut self.editor_buffer);
                            self.evaluate_and_print(&code);
                            self.editor_buffer = code;
                        }
                        self.editor_mode = false;
                        self.editor_buffer.clear();
                        self.refresh_line();
                    } else if self.line_editor.buffer.is_empty() && !self.in_multiline {
                        self.print(format_args!("\n"));
                        self.running = false;
                    } else {
                        self.line_editor.delete_char();
                        self.refresh_line();
                    }
                }
                Key::CtrlL => {
                    self.write(Cursor::CLEAR_SCREEN.as_bytes());
                    self.write(Cursor::HOME.as_bytes());
                    self.refresh_line();
                }
                Key::CtrlA => {
                    self.line_editor.move_to_start();
                    self.refresh_line();
                }
                Key::CtrlE => {
                    self.line_editor.move_to_end();
                    self.refresh_line();
                }
                Key::CtrlB | Key::ArrowLeft => {
                    self.line_editor.move_left();
                    self.refresh_line();
                }
                Key::CtrlF | Key::ArrowRight => {
                    self.line_editor.move_right();
                    self.refresh_line();
                }
                Key::AltB | Key::AltLeft => {
                    self.line_editor.move_word_left();
                    self.refresh_line();
                }
                Key::AltF | Key::AltRight => {
                    self.line_editor.move_word_right();
                    self.refresh_line();
                }
                Key::CtrlU => {
                    self.line_editor.delete_to_start();
                    self.refresh_line();
                }
                Key::CtrlK => {
                    self.line_editor.delete_to_end();
                    self.refresh_line();
                }
                Key::CtrlW | Key::AltBackspace => {
                    self.line_editor.backspace_word();
                    self.refresh_line();
                }
                Key::AltD => {
                    self.line_editor.delete_word();
                    self.refresh_line();
                }
                Key::CtrlT => {
                    self.line_editor.swap();
                    self.refresh_line();
                }
                Key::Backspace => {
                    self.line_editor.backspace();
                    self.refresh_line();
                }
                Key::Delete => {
                    self.line_editor.delete_char();
                    self.refresh_line();
                }
                Key::ArrowUp | Key::CtrlP => {
                    // PORT NOTE: reshaped for borrowck — copy line before mutating history
                    let cur = self.line_editor.get_line().to_vec();
                    if let Some(prev_line) = self.history.prev(&cur) {
                        let prev_line = prev_line.to_vec();
                        let _ = self.line_editor.set(&prev_line);
                        self.refresh_line();
                    }
                }
                Key::ArrowDown | Key::CtrlN => {
                    if let Some(next_line) = self.history.next() {
                        let next_line = next_line.to_vec();
                        let _ = self.line_editor.set(&next_line);
                    } else {
                        self.line_editor.clear();
                    }
                    self.refresh_line();
                }
                Key::Tab => self.handle_tab(),
                Key::Home => {
                    self.line_editor.move_to_start();
                    self.refresh_line();
                }
                Key::End => {
                    self.line_editor.move_to_end();
                    self.refresh_line();
                }
                Key::Char(c) => {
                    let _ = self.line_editor.insert(c);
                    self.refresh_line();
                }
                _ => {}
            }
        }

        self.restore_terminal();
        self.history.save();
        Ok(())
    }

    fn handle_enter(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.print(format_args!("\n"));

        // PORT NOTE: reshaped for borrowck — copy line out so we can call &mut self methods
        let line: Vec<u8> = self.line_editor.get_line().to_vec();

        if self.editor_mode {
            if strings::trim(&line, b" \t").is_empty() {
                self.editor_buffer.extend_from_slice(b"\n");
            } else {
                self.editor_buffer.extend_from_slice(&line);
                self.editor_buffer.push(b'\n');
            }
            self.line_editor.clear();
            self.refresh_line();
            return Ok(());
        }

        // Check for REPL commands
        if !line.is_empty() && line[0] == b'.' {
            let space_idx = strings::index_of_char(&line, b' ');
            let cmd_name = if let Some(idx) = space_idx { &line[..idx as usize] } else { &line[..] };
            let args = if let Some(idx) = space_idx { &line[idx as usize + 1..] } else { &b""[..] };

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
                    ReplResult::ContinueRepl => {}
                }
            } else {
                self.print_error(format_args!("Unknown command: {}\n", BStr::new(cmd_name)));
                self.print(format_args!("Type {}.help{} for available commands\n", Color::CYAN, Color::RESET));
                self.line_editor.clear();
                self.refresh_line();
                return Ok(());
            }
        }

        // Handle empty line
        if line.is_empty() && !self.in_multiline {
            self.refresh_line();
            return Ok(());
        }

        // Check for multi-line input
        let full_code: &[u8] = if self.in_multiline {
            self.multiline_buffer.extend_from_slice(&line);
            self.multiline_buffer.push(b'\n');
            &self.multiline_buffer
        } else {
            &line
        };

        if is_incomplete_code(full_code) {
            if !self.in_multiline {
                self.in_multiline = true;
                self.multiline_buffer.extend_from_slice(&line);
                self.multiline_buffer.push(b'\n');
            }
            self.line_editor.clear();
            self.refresh_line();
            return Ok(());
        }

        // Complete code - evaluate it
        let code_to_eval: Box<[u8]> = if self.in_multiline {
            Box::<[u8]>::from(self.multiline_buffer.as_slice())
        } else {
            Box::<[u8]>::from(line.as_slice())
        };

        self.history.add(strings::trim(&code_to_eval, b"\n"))?;

        self.evaluate_and_print(&code_to_eval);

        // Reset state
        self.line_editor.clear();
        self.multiline_buffer.clear();
        self.in_multiline = false;
        self.history.reset_position();
        self.refresh_line();
        Ok(())
    }

    fn handle_ctrl_c(&mut self) {
        if self.editor_mode {
            self.print(format_args!("\n{}// Editor mode cancelled{}\n", Color::DIM, Color::RESET));
            self.editor_mode = false;
            self.editor_buffer.clear();
        } else if self.in_multiline {
            self.print(format_args!("\n"));
            self.in_multiline = false;
            self.multiline_buffer.clear();
        } else if !self.line_editor.buffer.is_empty() {
            self.print(format_args!("^C\n"));
            self.line_editor.clear();
        } else if self.ctrl_c_pressed {
            // Second Ctrl+C on empty line - exit
            self.print(format_args!("\n"));
            self.running = false;
            return;
        } else {
            self.ctrl_c_pressed = true;
            self.print(format_args!("\n{}(press Ctrl+C again to exit, or Ctrl+D){}\n", Color::DIM, Color::RESET));
        }
        self.history.reset_position();
        self.refresh_line();
    }

    fn handle_tab(&mut self) {
        // PORT NOTE: reshaped for borrowck — copy line out
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
                self.print(format_args!("\n"));
                for m in &matches {
                    self.print(format_args!("  {}{}{}\n", Color::CYAN, BStr::new(m), Color::RESET));
                }
                self.refresh_line();
            }
            return;
        }

        // Property completion using JSC
        let Some(global) = self.global else {
            // No VM, just insert spaces
            let _ = self.line_editor.insert(b' ');
            let _ = self.line_editor.insert(b' ');
            self.refresh_line();
            return;
        };

        // Find the word being completed
        let mut word_start: usize = line.len();
        while word_start > 0 {
            let c = line[word_start - 1];
            if !c.is_ascii_alphanumeric() && c != b'_' && c != b'$' {
                break;
            }
            word_start -= 1;
        }

        let prefix = &line[word_start..];

        // Get completions from global object
        // SAFETY: global is valid; prefix pointer/len are valid for the call
        let completions = unsafe {
            Bun__REPL__getCompletions(
                global as *const _ as *mut _,
                JSValue::UNDEFINED,
                prefix.as_ptr(),
                prefix.len(),
            )
        };

        if completions.is_undefined() || !completions.is_array() {
            let _ = self.line_editor.insert(b' ');
            let _ = self.line_editor.insert(b' ');
            self.refresh_line();
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
            let _ = self.line_editor.insert(b' ');
            let _ = self.line_editor.insert(b' ');
            self.refresh_line();
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
                let slice = match item.to_slice(global) {
                    Ok(s) => s,
                    Err(_) => {
                        global.clear_exception();
                        return;
                    }
                };
                let completion = slice.slice();
                // Replace the prefix with the completion
                while self.line_editor.cursor > word_start {
                    self.line_editor.backspace();
                }
                let _ = self.line_editor.insert_slice(completion);
                self.refresh_line();
            }
        } else if len <= 50 {
            // Multiple completions - show them
            self.print(format_args!("\n"));
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
                    match item.to_slice(global) {
                        Ok(slice) => {
                            self.print(format_args!("  {}{}{}\n", Color::CYAN, BStr::new(slice.slice()), Color::RESET));
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
            self.print(format_args!("\n{}{} completions{}\n", Color::DIM, len, Color::RESET));
            self.refresh_line();
        }
    }
}

impl<'a> Drop for Repl<'a> {
    fn drop(&mut self) {
        self.restore_terminal();
        self.history.save();
        // line_editor, history, multiline_buffer, editor_buffer dropped automatically
        if !self.last_result.is_undefined() {
            self.last_result.unprotect();
        }
        if !self.last_error.is_undefined() {
            self.last_error.unprotect();
        }
    }
}

/// Global pointer for signal handler to access the VM
static mut SIGINT_VM: Option<*mut jsc::VM> = None;

extern "C" fn sigint_handler(_: c_int) {
    // SAFETY: written/read on the JS thread; signal handler runs while main thread blocked in wait
    unsafe {
        if let Some(vm) = SIGINT_VM {
            (*vm).set_execution_forbidden(true);
        }
    }
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

/// Check if code looks like an object literal that would be misinterpreted as a block
fn is_likely_object_literal(code: &[u8]) -> bool {
    // Skip leading whitespace
    let mut start: usize = 0;
    while start < code.len()
        && (code[start] == b' ' || code[start] == b'\t' || code[start] == b'\n' || code[start] == b'\r')
    {
        start += 1;
    }

    // Check if starts with {
    if start >= code.len() || code[start] != b'{' {
        return false;
    }

    // Skip trailing whitespace
    let mut end: usize = code.len();
    while end > 0
        && (code[end - 1] == b' ' || code[end - 1] == b'\t' || code[end - 1] == b'\n' || code[end - 1] == b'\r')
    {
        end -= 1;
    }

    // Check if ends with semicolon - if so, it's likely a block statement
    if end > 0 && code[end - 1] == b';' {
        return false;
    }

    true
}

// ============================================================================
// Public Entry Point (for CLI integration)
// ============================================================================

pub fn exec(ctx: bun_cli::Command::Context) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let _ = ctx;
    let mut repl = Repl::init();
    repl.run()
}

const VERSION: &str = Environment::VERSION_STRING;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/repl.zig (2058 lines)
//   confidence: medium
//   todos:      11
//   notes:      defer self.disableSignalsDuringWait() reshaped to explicit calls (borrowck); transform_for_repl mutates vm.transpiler through & borrow; sigaction/tty wrappers assumed in bun_sys
// ──────────────────────────────────────────────────────────────────────────
