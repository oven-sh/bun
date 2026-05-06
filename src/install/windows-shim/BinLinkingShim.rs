//! This struct is used by bun.exe to encode `.bunx` files, to be consumed
//! by the shim 'bun_shim_impl.exe'. The latter exe does not include this code.
//!
//! The format is as follows:
//!
//! [WSTR:bin_path][u16'"'][u16:0](shebang?)[flags:u16]
//!
//! if shebang:
//! [WSTR:program][u16:0][WSTR:args][u32:bin_path_byte_len][u32:arg_byte_len]
//! - args always ends with a trailing space
//!
//! See 'bun_shim_impl.zig' for more details on how this file is consumed.

use core::mem::size_of;

use bun_str::strings;
// TODO(port): move to <area>_sys / verify exact module path for simdutf bindings
use bun_simdutf as simdutf;

#[inline]
fn eql_comptime(a: &[u8], b: &'static [u8]) -> bool {
    a == b
}

/// Random numbers are chosen for validation purposes
/// These arbitrary numbers will probably not show up in the other fields.
/// This will reveal off-by-one mistakes.
// Zig: `enum(u13)` non-exhaustive (`_`). Rust has no `u13`, and the `_` makes it
// open-ended, so model as a transparent u16 newtype holding a 13-bit value.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct VersionFlag(u16);

impl VersionFlag {
    pub const CURRENT: VersionFlag = VersionFlag::V5;

    pub const V1: VersionFlag = VersionFlag(5474);
    /// Fix bug where paths were not joined correctly
    pub const V2: VersionFlag = VersionFlag(5475);
    /// Added an error message for when the process is not found
    pub const V3: VersionFlag = VersionFlag(5476);
    /// Added a flag to tell if the shebang is exactly "node" This is used in an
    /// automatic fallback path where if "node" is asked for, but not present,
    /// it will retry the spawn with "bun".
    pub const V4: VersionFlag = VersionFlag(5477);
    /// Fixed bugs where passing arguments did not always work.
    pub const V5: VersionFlag = VersionFlag(5478);

    /// std.math.maxInt(u13)
    const MAX: VersionFlag = VersionFlag((1u16 << 13) - 1);
}

// Zig: `packed struct(u16)` with mixed bool + u13 fields → `#[repr(transparent)]`
// newtype with manual shift accessors matching Zig field order (LSB first).
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Flags(u16);

impl Flags {
    #[inline]
    pub const fn new(
        is_node_or_bun: bool,
        is_node: bool,
        has_shebang: bool,
        version_tag: VersionFlag,
    ) -> Flags {
        Flags(
            (is_node_or_bun as u16)
                | ((is_node as u16) << 1)
                | ((has_shebang as u16) << 2)
                | (version_tag.0 << 3),
        )
    }

    #[inline]
    pub const fn bits(self) -> u16 {
        self.0
    }

    #[inline]
    pub const fn from_bits(b: u16) -> Flags {
        Flags(b)
    }

    // this is set if the shebang content is "node" or "bun"
    #[inline]
    pub const fn is_node_or_bun(self) -> bool {
        (self.0 & 0b001) != 0
    }
    // this is for validation that the shim is not corrupt and to detect offset memory reads
    #[inline]
    pub const fn is_node(self) -> bool {
        (self.0 & 0b010) != 0
    }
    // indicates if a shebang is present
    #[inline]
    pub const fn has_shebang(self) -> bool {
        (self.0 & 0b100) != 0
    }
    #[inline]
    pub const fn version_tag(self) -> VersionFlag {
        VersionFlag(self.0 >> 3)
    }

    #[inline]
    pub fn set_is_node(&mut self, v: bool) {
        self.0 = (self.0 & !0b010) | ((v as u16) << 1);
    }

    pub fn is_valid(self) -> bool {
        let mask: u16 = Flags::new(false, false, false, VersionFlag::MAX).bits();
        let compare_to: u16 = Flags::new(false, false, false, VersionFlag::CURRENT).bits();
        (self.0 & mask) == compare_to
    }
}

// TODO(port): @embedFile — verify the relative path resolves correctly under cargo
// (include_bytes! is relative to this source file, same as Zig @embedFile).
pub const EMBEDDED_EXECUTABLE_DATA: &[u8] = include_bytes!("bun_shim_impl.exe");

#[derive(Copy, Clone, Eq, PartialEq)]
enum ExtensionType {
    RunWithBun,
    RunWithCmd,
    RunWithPowershell,
}

// Zig used `std.StaticStringMap` keyed by the UTF-16LE *byte* reinterpretation of
// each extension (via `wU8`). Here we match directly on the `&[u16]` extension
// using `bun_str::w!` literals — semantically identical, drops the byte cast.
// PERF(port): was comptime StaticStringMap (perfect hash) — profile in Phase B
fn bun_extensions_get(ext: &[u16]) -> Option<ExtensionType> {
    use ExtensionType::*;
    macro_rules! w {
        ($s:literal) => {
            bun_str::w!($s)
        };
    }
    match ext {
        e if e == w!(".js") => Some(RunWithBun),
        e if e == w!(".mjs") => Some(RunWithBun),
        e if e == w!(".cjs") => Some(RunWithBun),
        e if e == w!(".jsx") => Some(RunWithBun),
        e if e == w!(".ts") => Some(RunWithBun),
        e if e == w!(".cts") => Some(RunWithBun),
        e if e == w!(".mts") => Some(RunWithBun),
        e if e == w!(".tsx") => Some(RunWithBun),
        e if e == w!(".sh") => Some(RunWithBun),
        e if e == w!(".cmd") => Some(RunWithCmd),
        e if e == w!(".bat") => Some(RunWithCmd),
        e if e == w!(".ps1") => Some(RunWithPowershell),
        _ => None,
    }
}

#[derive(Copy, Clone)]
pub struct Shebang<'a> {
    // PORT NOTE: borrows into the caller's input buffer (see `parse` doc)
    pub launcher: &'a [u8],
    pub utf16_len: u32,
    pub is_node_or_bun: bool,
}

impl<'a> Shebang<'a> {
    pub fn init(launcher: &'a [u8], is_node_or_bun: bool) -> Result<Shebang<'a>, bun_core::Error> {
        // TODO(port): narrow error set (Zig inferred empty error set here)
        Ok(Shebang {
            launcher,
            // TODO(@paperclover): what if this is invalid utf8?
            utf16_len: u32::try_from(simdutf::length::utf16_from_utf8(launcher)).unwrap(),
            is_node_or_bun,
        })
    }

    /// std.fs.path.basename but utf16
    fn basename_w(path: &[u16]) -> &[u16] {
        if path.is_empty() {
            return &[];
        }

        let mut end_index: usize = path.len() - 1;
        loop {
            let byte = path[end_index];
            if byte == b'/' as u16 || byte == b'\\' as u16 {
                if end_index == 0 {
                    return &[];
                }
                end_index -= 1;
                continue;
            }
            if byte == b':' as u16 && end_index == 1 {
                return &[];
            }
            break;
        }

        let mut start_index: usize = end_index;
        end_index += 1;
        while path[start_index] != b'/' as u16
            && path[start_index] != b'\\' as u16
            && !(path[start_index] == b':' as u16 && start_index == 1)
        {
            if start_index == 0 {
                return &path[0..end_index];
            }
            start_index -= 1;
        }

        &path[start_index + 1..end_index]
    }

    /// std.fs.path.extension but utf16
    pub fn extension_w(path: &[u16]) -> &[u16] {
        let filename = Self::basename_w(path);
        let Some(index) = last_index_of_scalar_u16(filename, b'.' as u16) else {
            return &path[path.len()..];
        };
        if index == 0 {
            return &path[path.len()..];
        }
        &filename[index..]
    }

    pub fn parse_from_bin_path(bin_path: &[u16]) -> Option<Shebang<'static>> {
        if let Some(i) = bun_extensions_get(Self::extension_w(bin_path)) {
            return Some(match i {
                // `comptime Shebang.init(...) catch unreachable` → const-evaluated; the
                // values below are the simdutf utf16 lengths of pure-ASCII literals
                // (== byte length).
                ExtensionType::RunWithBun => Shebang {
                    launcher: b"bun run",
                    utf16_len: 7,
                    is_node_or_bun: true,
                },
                ExtensionType::RunWithCmd => Shebang {
                    launcher: b"cmd /c",
                    utf16_len: 6,
                    is_node_or_bun: false,
                },
                ExtensionType::RunWithPowershell => Shebang {
                    launcher: b"powershell -ExecutionPolicy Bypass -File",
                    utf16_len: 40,
                    is_node_or_bun: false,
                },
            });
        }
        None
    }

    /// `32766` is taken from `CreateProcessW` docs. One less to account for the null terminator
    /// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw#parameters
    pub const MAX_SHEBANG_INPUT_LENGTH: usize = 32766 + b"#!".len();

    /// Given the start of a file, parse the shebang
    /// Output contains slices that point into the input buffer
    ///
    /// Since a command line cannot be longer than 32766 characters,
    /// this function does not accept inputs longer than `MAX_SHEBANG_INPUT_LENGTH`
    pub fn parse(
        contents_maybe_overflow: &'a [u8],
        bin_path: &[u16],
    ) -> Result<Option<Shebang<'a>>, bun_core::Error> {
        let contents = &contents_maybe_overflow
            [0..contents_maybe_overflow.len().min(Self::MAX_SHEBANG_INPUT_LENGTH)];

        if contents.len() < 3 {
            return Ok(Self::parse_from_bin_path(bin_path));
        }

        if contents[0] != b'#' || contents[1] != b'!' {
            return Ok(Self::parse_from_bin_path(bin_path));
        }

        let line: &[u8] = 'line: {
            let Some(mut line_i) = strings::index_of_char_usize(contents, b'\n') else {
                return Ok(Self::parse_from_bin_path(bin_path));
            };
            debug_assert!(line_i >= 1);
            if contents[line_i - 1] == b'\r' {
                line_i -= 1;
            }
            break 'line &contents[2..line_i];
        };

        // std.mem.tokenizeScalar(u8, line, ' ') — manual port preserving `.rest()` semantics.
        // PORT NOTE: reshaped — Rust split() iterator has no `.rest()`.
        let mut idx: usize = 0;
        // skip leading delimiters, then take token
        while idx < line.len() && line[idx] == b' ' {
            idx += 1;
        }
        let first_start = idx;
        while idx < line.len() && line[idx] != b' ' {
            idx += 1;
        }
        let first = &line[first_start..idx];
        if first.is_empty() {
            return Ok(Self::parse_from_bin_path(bin_path));
        }

        if eql_comptime(first, b"/usr/bin/env") || eql_comptime(first, b"/bin/env") {
            // tokenizer.rest(): skip delimiters after `first`, return remainder
            while idx < line.len() && line[idx] == b' ' {
                idx += 1;
            }
            let rest = &line[idx..];
            // tokenizer.next(): program token
            let prog_start = idx;
            while idx < line.len() && line[idx] != b' ' {
                idx += 1;
            }
            let program = &line[prog_start..idx];
            if program.is_empty() {
                return Ok(Self::parse_from_bin_path(bin_path));
            }
            let is_node_or_bun = eql_comptime(program, b"bun") || eql_comptime(program, b"node");
            return Shebang::init(rest, is_node_or_bun).map(Some);
        }

        Shebang::init(line, false).map(Some)
    }

    pub fn encoded_length(&self) -> usize {
        (b" ".len() + self.utf16_len as usize) * size_of::<u16>() + size_of::<u32>() * 2
    }
}

#[inline]
fn last_index_of_scalar_u16(slice: &[u16], value: u16) -> Option<usize> {
    slice.iter().rposition(|&c| c == value)
}

pub struct BinLinkingShim<'a> {
    /// Relative to node_modules. Do not include slash
    pub bin_path: &'a [u16],
    /// Information found within the target file's shebang
    pub shebang: Option<Shebang<'a>>,
}

impl<'a> BinLinkingShim<'a> {
    pub fn encoded_length(&self) -> usize {
        let l = ((self.bin_path.len() + b"\" ".len()) * size_of::<u16>())
            + size_of::<u16>() // @sizeOf(Flags)
            + if let Some(s) = &self.shebang {
                s.encoded_length()
            } else {
                0
            };
        debug_assert!(l % 2 == 0);
        l
    }

    /// The buffer must be exactly the correct length given by encoded_length
    pub fn encode_into(&self, buf: &mut [u8]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        debug_assert!(buf.len() == self.encoded_length());
        debug_assert!(self.bin_path[0] != b'/' as u16);

        // SAFETY: caller guarantees buf.len() == encoded_length() which is always
        // a multiple of 2; Zig used @alignCast here (callers pass 2-aligned buffers).
        let mut wbuf: &mut [u16] = unsafe {
            core::slice::from_raw_parts_mut(buf.as_mut_ptr().cast::<u16>(), buf.len() / 2)
        };

        wbuf[0..self.bin_path.len()].copy_from_slice(self.bin_path);
        wbuf = &mut wbuf[self.bin_path.len()..];

        wbuf[0] = b'"' as u16;
        wbuf[1] = 0;
        wbuf = &mut wbuf[2..];

        let is_node_or_bun = if let Some(s) = &self.shebang {
            s.is_node_or_bun
        } else {
            false
        };
        let mut flags = Flags::new(
            is_node_or_bun,
            /* is_node */ false,
            /* has_shebang */ self.shebang.is_some(),
            VersionFlag::CURRENT,
        );

        if let Some(s) = &self.shebang {
            let is_node = strings::has_prefix(s.launcher, b"node")
                && (s.launcher.len() == 4 || s.launcher[4] == b' ');
            flags.set_is_node(is_node);
            if is_node {
                debug_assert!(flags.is_node_or_bun());
            }

            let encoded =
                strings::convert_utf8_to_utf16_in_buffer(&mut wbuf[0..s.utf16_len as usize], s.launcher);
            debug_assert!(encoded.len() == s.utf16_len as usize);
            wbuf = &mut wbuf[s.utf16_len as usize..];

            wbuf[0] = b' ' as u16;
            wbuf = &mut wbuf[1..];

            // SAFETY: wbuf has at least 4 u16s (= 2 u32s) remaining per encoded_length();
            // Zig wrote via `*align(1) u32` — use unaligned writes.
            unsafe {
                (wbuf.as_mut_ptr().cast::<u32>())
                    .write_unaligned(u32::try_from(self.bin_path.len() * 2).unwrap());
                (wbuf.as_mut_ptr().add(2).cast::<u32>())
                    .write_unaligned((s.utf16_len) * 2 + 2); // include the spaces!
            }
            wbuf = &mut wbuf[(size_of::<u32>() * 2) / size_of::<u16>()..];
        }

        // SAFETY: Flags is #[repr(transparent)] over u16; one u16 slot remains.
        unsafe {
            (wbuf.as_mut_ptr().cast::<u16>()).write_unaligned(flags.bits());
        }
        wbuf = &mut wbuf[size_of::<u16>() / size_of::<u16>()..];

        if cfg!(debug_assertions) {
            if wbuf.len() != 0 {
                panic!("wbuf.len != 0, got {}", wbuf.len());
            }
        }

        Ok(())
    }
}

pub struct Decoded<'a> {
    pub bin_path: &'a [u16],
    pub flags: Flags,
}

pub fn loose_decode(input: &[u8]) -> Option<Decoded<'_>> {
    const FLAGS_SIZE: usize = size_of::<u16>(); // @sizeOf(Flags)
    if input.len() < FLAGS_SIZE + 2 * size_of::<u32>() + 8 {
        return None;
    }
    // SAFETY: bounds checked above; Zig read via `*align(1) const Flags`.
    let flags = Flags::from_bits(unsafe {
        input
            .as_ptr()
            .add(input.len() - FLAGS_SIZE)
            .cast::<u16>()
            .read_unaligned()
    });
    if !flags.is_valid() {
        return None;
    }

    let bin_path_u8: &[u8] = if flags.has_shebang() {
        'bin_path_u8: {
            // SAFETY: bounds checked above; unaligned u32 read.
            let bin_path_byte_len = unsafe {
                input
                    .as_ptr()
                    .add(input.len() - FLAGS_SIZE - 2 * size_of::<u32>())
                    .cast::<u32>()
                    .read_unaligned()
            } as usize;
            if bin_path_byte_len % 2 != 0 {
                return None;
            }
            if bin_path_byte_len > (input.len() - 8) {
                return None;
            }
            break 'bin_path_u8 &input[0..bin_path_byte_len];
        }
    } else {
        // path slice is 0..flags-2
        &input[0..input.len() - FLAGS_SIZE]
    };

    if bin_path_u8.len() % 2 != 0 {
        return None;
    }

    Some(Decoded {
        bin_path: reinterpret_slice_u16(bin_path_u8),
        flags,
    })
}

#[inline]
fn reinterpret_slice_u16(bytes: &[u8]) -> &[u16] {
    debug_assert!(bytes.len() % 2 == 0);
    // SAFETY: mirrors `bun.reinterpretSlice(u16, ...)` — caller-guaranteed alignment
    // and even length. TODO(port): replace with bun_core::reinterpret_slice if it exists.
    unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast::<u16>(), bytes.len() / 2) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/windows-shim/BinLinkingShim.zig (311 lines)
//   confidence: medium
//   todos:      5
//   notes:      packed struct(u16) Flags hand-bitpacked; StaticStringMap → match on &[u16]; tokenizeScalar `.rest()` reshaped inline; verify simdutf/reinterpret_slice paths in Phase B
// ──────────────────────────────────────────────────────────────────────────
