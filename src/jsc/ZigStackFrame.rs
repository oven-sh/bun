use core::fmt;
use std::io::Write as _;

use bstr::BStr;

use bun_core::Output;
use bun_str::{strings, String as BunString};
use bun_url::URL as ZigURL;
use bun_schema::api;

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

impl Drop for ZigStackFrame {
    fn drop(&mut self) {
        // TODO(port): verify bun_str::String does not also deref on its own Drop (would double-deref).
        // This is a #[repr(C)] FFI type; C++ may construct/destroy it — confirm ownership in Phase B.
        self.function_name.deref();
        self.source_url.deref();
    }
}

impl ZigStackFrame {
    pub fn to_api(
        &self,
        root_path: &[u8],
        origin: Option<&ZigURL>,
    ) -> Result<api::StackFrame, bun_alloc::AllocError> {
        // Zig was `!api.StackFrame` with alloc-only `try` sites; allocator param dropped.
        // SAFETY: all-zero is a valid api::StackFrame (Zig used `comptime std.mem.zeroes`).
        // TODO(port): verify api::StackFrame is #[repr(C)] POD with no NonNull/NonZero fields.
        let mut frame: api::StackFrame = unsafe { core::mem::zeroed::<api::StackFrame>() };
        if !self.function_name.is_empty() {
            let slicer = self.function_name.to_utf8();
            // TODO(port): Zig did `(try slicer.cloneIfBorrowed(allocator)).slice()`.
            // TODO: Memory leak? `frame.function_name` may have just been allocated by this
            // function, but it doesn't seem like we ever free it. Changing to `toUTF8Owned` would
            // make the ownership clearer, but would also make the memory leak worse without an
            // additional free.
            frame.function_name = Box::<[u8]>::from(slicer.as_bytes());
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
        // SAFETY: api::StackFrameScope is #[repr(u8)] with the same discriminants as ZigStackFrameCode.
        // TODO(port): verify repr/discriminant match between ZigStackFrameCode and api::StackFrameScope.
        frame.scope = unsafe {
            core::mem::transmute::<u8, api::StackFrameScope>(self.code_type as u8)
        };

        Ok(frame)
    }

    pub const ZERO: ZigStackFrame = ZigStackFrame {
        function_name: BunString::EMPTY,
        code_type: ZigStackFrameCode::None,
        source_url: BunString::EMPTY,
        position: ZigStackFramePosition::INVALID,
        is_async: false,
        remapped: false,
        jsc_stack_frame_index: -1,
    };

    pub fn name_formatter(&self, enable_color: bool) -> NameFormatter {
        // PERF(port): was comptime monomorphization (`comptime enable_color: bool`) — but the
        // formatter stores it as a runtime field anyway, so no monomorphization was happening.
        NameFormatter {
            function_name: self.function_name,
            code_type: self.code_type,
            enable_color,
            is_async: self.is_async,
        }
    }

    pub fn source_url_formatter<'a>(
        &self,
        root_path: &'a [u8],
        origin: Option<&'a ZigURL>,
        exclude_line_column: bool,
        enable_color: bool,
    ) -> SourceURLFormatter<'a> {
        // PERF(port): was comptime monomorphization (`comptime enable_color: bool`) — stored as
        // runtime field.
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
    pub source_url: BunString,
    pub position: ZigStackFramePosition,
    pub enable_color: bool,
    pub origin: Option<&'a ZigURL>,
    pub exclude_line_column: bool,
    pub remapped: bool,
    pub root_path: &'a [u8],
}

impl<'a> fmt::Display for SourceURLFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // TODO(port): `Output::pretty_fmt!` is assumed to be a macro that expands to a `&'static str`
        // literal (substituting `<r>`/`<cyan>`/etc. for ANSI sequences at compile time), so it can
        // be used as a `write!` format string. Phase B must provide this in `bun_core`.
        if self.enable_color {
            f.write_str(Output::pretty_fmt!("<r><cyan>", true))?;
        }

        let source_slice_ = self.source_url.to_utf8();
        let mut source_slice: &[u8] = source_slice_.as_bytes();
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
            if self.position.line.is_valid() || self.position.column.is_valid() {
                f.write_str(Output::pretty_fmt!("<r>", true))?;
            } else {
                f.write_str(Output::pretty_fmt!("<r>", true))?;
            }
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
    pub function_name: BunString,
    pub code_type: ZigStackFrameCode,
    pub enable_color: bool,
    pub is_async: bool,
}

impl fmt::Display for NameFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = &self.function_name;

        match self.code_type {
            ZigStackFrameCode::Eval => {
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
            ZigStackFrameCode::Function => {
                if !name.is_empty() {
                    if self.enable_color {
                        if self.is_async {
                            write!(
                                f,
                                Output::pretty_fmt!("<r><b><i>async {}<r>", true),
                                name,
                            )?;
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
            ZigStackFrameCode::Global => {}
            ZigStackFrameCode::Wasm => {
                if !name.is_empty() {
                    write!(f, "{}", name)?;
                } else {
                    f.write_str("WASM")?;
                }
            }
            ZigStackFrameCode::Constructor => {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ZigStackFrame.zig (252 lines)
//   confidence: medium
//   todos:      5
//   notes:      Output::pretty_fmt! must be a macro expanding to &'static str literal (used as write! format string); verify bun_str::String Drop semantics vs explicit .deref() in #[repr(C)] FFI struct.
// ──────────────────────────────────────────────────────────────────────────
