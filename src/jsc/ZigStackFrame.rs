use core::fmt;

use bstr::BStr;

use bun_core::Output;
use bun_core::String as BunString;
use bun_paths::strings;

use crate::exception_list;
use crate::{ZigStackFrameCode, ZigStackFramePosition};

/// Represents a single frame in a stack trace
#[repr(C)]
pub struct ZigStackFrame {
    pub function_name: BunString,
    pub source_url: BunString,
    pub position: ZigStackFramePosition,
    pub code_type: ZigStackFrameCode,
    pub is_async: bool,

    /// Set once the source map remapper has handled the frame. Formatters dim the root path only then.
    pub remapped: bool,

    /// -1 means not set.
    pub jsc_stack_frame_index: i32,
}

impl ZigStackFrame {
    pub(crate) fn snapshot(&self) -> exception_list::StackFrame {
        exception_list::StackFrame {
            function_name: Box::from(self.function_name.to_utf8().slice()),
            file: self.source_url.to_string().into_bytes().into_boxed_slice(),
            position: self.position,
            code_type: self.code_type,
        }
    }

    pub const ZERO: ZigStackFrame = ZigStackFrame {
        function_name: BunString::EMPTY,
        code_type: ZigStackFrameCode::NONE,
        source_url: BunString::EMPTY,
        position: ZigStackFramePosition::INVALID,
        is_async: false,
        remapped: false,
        jsc_stack_frame_index: -1,
    };

    /// The frame's source as a report that lists files relative to `dir` (the JUnit
    /// reporter, the GitHub Actions annotation) prints it.
    ///
    /// Only an absolute path is made relative. A source URL that is not a path (a
    /// `data:` or `blob:` URL, `node:fs`, the name from a `//# sourceURL=` comment)
    /// is printed as-is, like [`SourceURLFormatter`] prints it. `relative` normalizes
    /// its operands in fixed path buffers, so a source URL that is too long to be a
    /// path is printed as-is too.
    ///
    /// The relative form lives in `relative`'s thread-local buffer until the next call.
    pub fn relative_source_url<'a>(dir: &[u8], source_url: &'a [u8]) -> &'a [u8] {
        if !bun_paths::is_absolute(source_url) || source_url.len() >= bun_paths::MAX_PATH_BYTES {
            return source_url;
        }
        bun_paths::resolve_path::relative(dir, source_url)
    }

    pub fn name_formatter(&self, enable_color: bool) -> NameFormatter<'_> {
        NameFormatter {
            function_name: &self.function_name,
            code_type: self.code_type,
            enable_color,
            is_async: self.is_async,
        }
    }

    pub(crate) fn source_url_formatter<'a>(
        &'a self,
        root_path: &'a [u8],
        enable_color: bool,
    ) -> SourceURLFormatter<'a> {
        SourceURLFormatter {
            source_url: &self.source_url,
            root_path,
            position: self.position,
            enable_color,
            remapped: self.remapped,
        }
    }
}

pub struct SourceURLFormatter<'a> {
    pub(crate) source_url: &'a BunString,
    pub(crate) position: ZigStackFramePosition,
    pub(crate) enable_color: bool,
    pub(crate) remapped: bool,
    pub(crate) root_path: &'a [u8],
}

impl<'a> fmt::Display for SourceURLFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // `Output::pretty_fmt!` expands to a `&'static str` literal (substituting `<r>`/`<cyan>`/
        // etc. for ANSI sequences at compile time), so it is usable as a `write!` format string.
        if self.enable_color {
            f.write_str(Output::pretty_fmt!("<r><cyan>", true))?;
        }

        let source_slice_ = self.source_url.to_utf8();
        let source_slice: &[u8] = source_slice_.slice();

        if !self.remapped {
            write!(f, "{}", BStr::new(source_slice))?;
        } else {
            if self.enable_color {
                let not_root = if cfg!(windows) {
                    self.root_path.len() > b"C:\\".len()
                } else {
                    self.root_path.len() > b"/".len()
                };
                if not_root && source_slice.starts_with(self.root_path) {
                    let root_path = strings::without_trailing_slash(self.root_path);
                    let relative_path = strings::without_leading_path_separator(
                        &source_slice[self.root_path.len()..],
                    );
                    f.write_str(Output::pretty_fmt!("<d>", true))?;
                    write!(f, "{}", BStr::new(root_path))?;
                    f.write_str(bun_paths::SEP_STR)?;
                    f.write_str(Output::pretty_fmt!("<r><cyan>", true))?;
                    write!(f, "{}", BStr::new(relative_path))?;
                } else {
                    write!(f, "{}", BStr::new(source_slice))?;
                }
            } else {
                write!(f, "{}", BStr::new(source_slice))?;
            }
        }

        if !source_slice.is_empty()
            && (self.position.line.is_valid() || self.position.column.is_valid())
        {
            if self.enable_color {
                f.write_str(Output::pretty_fmt!("<r><d>:", true))?;
            } else {
                f.write_str(":")?;
            }
        }

        if self.enable_color {
            f.write_str(Output::pretty_fmt!("<r>", true))?;
        }

        if self.position.line.is_valid() && self.position.column.is_valid() {
            if self.enable_color {
                write!(
                    f,
                    Output::pretty_fmt!("<yellow>{}<r><d>:<yellow>{}<r>", true),
                    self.position.line.one_based(),
                    self.position.column.one_based(),
                )?;
            } else {
                write!(
                    f,
                    "{}:{}",
                    self.position.line.one_based(),
                    self.position.column.one_based(),
                )?;
            }
        } else if self.position.line.is_valid() {
            if self.enable_color {
                write!(
                    f,
                    Output::pretty_fmt!("<yellow>{}<r>", true),
                    self.position.line.one_based(),
                )?;
            } else {
                write!(f, "{}", self.position.line.one_based())?;
            }
        }

        Ok(())
    }
}

pub struct NameFormatter<'a> {
    pub(crate) function_name: &'a BunString,
    pub(crate) code_type: ZigStackFrameCode,
    pub(crate) enable_color: bool,
    pub(crate) is_async: bool,
}

impl fmt::Display for NameFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = self.function_name;

        match self.code_type {
            ZigStackFrameCode::EVAL => {
                if self.enable_color {
                    f.write_str(concat!(
                        Output::pretty_fmt!("<r><d>", true),
                        "eval",
                        Output::pretty_fmt!("<r>", true),
                    ))?;
                } else {
                    f.write_str("eval")?;
                }
                if !name.is_empty() {
                    if self.enable_color {
                        write!(f, Output::pretty_fmt!(" <r><b><i>{}<r>", true), name)?;
                    } else {
                        write!(f, " {}", name)?;
                    }
                }
            }
            ZigStackFrameCode::FUNCTION => {
                if !name.is_empty() {
                    if self.enable_color {
                        if self.is_async {
                            write!(f, Output::pretty_fmt!("<r><b><i>async {}<r>", true), name,)?;
                        } else {
                            write!(f, Output::pretty_fmt!("<r><b><i>{}<r>", true), name)?;
                        }
                    } else {
                        if self.is_async {
                            write!(f, "async {}", name)?;
                        } else {
                            write!(f, "{}", name)?;
                        }
                    }
                } else {
                    if self.enable_color {
                        if self.is_async {
                            f.write_str(concat!(
                                Output::pretty_fmt!("<r><d>", true),
                                "async <anonymous>",
                                Output::pretty_fmt!("<r>", true),
                            ))?;
                        } else {
                            f.write_str(concat!(
                                Output::pretty_fmt!("<r><d>", true),
                                "<anonymous>",
                                Output::pretty_fmt!("<r>", true),
                            ))?;
                        }
                    } else {
                        if self.is_async {
                            f.write_str("async ")?;
                        }
                        f.write_str("<anonymous>")?;
                    }
                }
            }
            ZigStackFrameCode::GLOBAL => {}
            ZigStackFrameCode::WASM => {
                if !name.is_empty() {
                    write!(f, "{}", name)?;
                } else {
                    f.write_str("WASM")?;
                }
            }
            ZigStackFrameCode::CONSTRUCTOR => {
                write!(f, "new {}", name)?;
            }
            _ => {
                if !name.is_empty() {
                    write!(f, "{}", name)?;
                }
            }
        }

        Ok(())
    }
}
