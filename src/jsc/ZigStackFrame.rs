use core::fmt;
use std::io::Write as _;

use bstr::BStr;

use bun_core::Output;
use bun_core::String as BunString;
use bun_paths::strings;
use bun_url::URL as ZigURL;

use crate::schema_api as api;
use crate::{ZigStackFrameCode, ZigStackFramePosition};

/// Represents a single frame in a stack trace
#[repr(C)]
pub struct ZigStackFrame {
    pub function_name: BunString,
    pub source_url: BunString,
    pub position: ZigStackFramePosition,
    pub code_type: ZigStackFrameCode,
    pub is_async: bool,

    /// This informs formatters whether to display as a blob URL or not
    pub remapped: bool,

    /// -1 means not set.
    pub jsc_stack_frame_index: i32,
}

impl ZigStackFrame {
    /// Explicit deref of owned strings.
    ///
    /// Intentionally NOT `Drop`: this `#[repr(C)]` extern struct lives both in
    /// C++-populated buffers (`ZigStackTrace.frames_ptr`) and in the Rust-owned
    /// `Holder.frames: [ZigStackFrame; 32]` array. `Holder::deinit()` calls
    /// `ZigException::deinit()` → `frame.deinit()` to release the strings, but
    /// the array elements are then later dropped by Rust when `Holder` itself
    /// drops. A `Drop` impl would deref the same `WTF::StringImpl` a second
    /// time (UAF). Explicit `deinit` only.
    pub(crate) fn deinit(&mut self) {
        self.function_name.deref();
        self.source_url.deref();
    }

    pub(crate) fn to_api(
        &self,
        root_path: &[u8],
        origin: Option<&ZigURL<'_>>,
    ) -> Result<api::StackFrame, bun_alloc::AllocError> {
        let mut frame: api::StackFrame = api::StackFrame::default();
        if !self.function_name.is_empty() {
            let slicer = self.function_name.to_utf8();
            // TODO: Memory leak? `frame.function_name` may have just been allocated by this
            // function, but it doesn't seem like we ever free it. Changing to `toUTF8Owned` would
            // make the ownership clearer, but would also make the memory leak worse without an
            // additional free.
            frame.function_name = Box::<[u8]>::from(slicer.slice());
        }

        if !self.source_url.is_empty() {
            let mut buf = Vec::<u8>::new();
            write!(
                &mut buf,
                "{}",
                self.source_url_formatter(root_path, origin, true, false)
            )
            .expect("Vec<u8> write is infallible");
            frame.file = buf.into_boxed_slice();
        }

        frame.position = self.position;
        // api::StackFrameScope is a #[repr(transparent)] u8 newtype with the same
        // discriminants as ZigStackFrameCode.
        frame.scope = api::StackFrameScope(self.code_type.0);

        Ok(frame)
    }

    pub(crate) const ZERO: ZigStackFrame = ZigStackFrame {
        function_name: BunString::EMPTY,
        code_type: ZigStackFrameCode::NONE,
        source_url: BunString::EMPTY,
        position: ZigStackFramePosition::INVALID,
        is_async: false,
        remapped: false,
        jsc_stack_frame_index: -1,
    };

    pub(crate) fn name_formatter(&self, enable_color: bool) -> NameFormatter {
        NameFormatter {
            function_name: self.function_name,
            code_type: self.code_type,
            enable_color,
            is_async: self.is_async,
        }
    }

    pub(crate) fn source_url_formatter<'a>(
        &self,
        root_path: &'a [u8],
        origin: Option<&'a ZigURL<'a>>,
        exclude_line_column: bool,
        enable_color: bool,
    ) -> SourceURLFormatter<'a> {
        SourceURLFormatter {
            source_url: self.source_url,
            exclude_line_column,
            origin,
            root_path,
            position: self.position,
            enable_color,
            remapped: self.remapped,
        }
    }
}

pub struct SourceURLFormatter<'a> {
    pub(crate) source_url: BunString,
    pub(crate) position: ZigStackFramePosition,
    pub(crate) enable_color: bool,
    pub(crate) origin: Option<&'a ZigURL<'a>>,
    pub(crate) exclude_line_column: bool,
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
        let mut source_slice: &[u8] = source_slice_.slice();
        // `defer source_slice_.deinit()` — handled by Drop on Utf8Slice.

        if !self.remapped {
            if let Some(origin) = self.origin {
                write!(f, "{}", BStr::new(origin.display_protocol()))?;
                f.write_str("://")?;
                write!(f, "{}", BStr::new(origin.display_hostname()))?;
                f.write_str(":")?;
                write!(f, "{}", BStr::new(origin.port))?;
                f.write_str("/blob:")?;

                if source_slice.starts_with(self.root_path) {
                    source_slice = &source_slice[self.root_path.len()..];
                }
            }
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

        if !self.exclude_line_column {
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
        }

        Ok(())
    }
}

pub struct NameFormatter {
    pub(crate) function_name: BunString,
    pub(crate) code_type: ZigStackFrameCode,
    pub(crate) enable_color: bool,
    pub(crate) is_async: bool,
}

impl fmt::Display for NameFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = &self.function_name;

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
