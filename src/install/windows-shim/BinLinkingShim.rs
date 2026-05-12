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
//!
//! ## `shim_standalone` feature
//!
//! This file is compiled by *two* crates: `bun_install` (the encoder/host —
//! feature unset) and `bun_shim_impl` (the standalone PE — feature set). The
//! standalone bin only needs `Flags`/`VersionFlag` for decoding, and must NOT
//! see `EMBEDDED_EXECUTABLE_DATA` (it would `include_bytes!` its own output).
//! Everything host-side is gated `#[cfg(not(feature = "shim_standalone"))]`.

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

// ──────────────────────────────────────────────────────────────────────────
// Host-side encoding / embedding. None of this is compiled into the
// standalone shim PE — the doc header says "The latter exe does not include
// this code", and including `EMBEDDED_EXECUTABLE_DATA` here would make the
// shim crate `include_bytes!` its own output. Gate via inner module +
// `pub use` so one `#[cfg]` covers the lot and visibility is preserved.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(not(feature = "shim_standalone"))]
pub use host::*;

#[cfg(not(feature = "shim_standalone"))]
mod host {
    use super::{Flags, VersionFlag};

    use core::mem::size_of;

    use bun_core::strings;
    use bun_simdutf_sys::simdutf;

    #[inline]
    fn eql_comptime(a: &[u8], b: &'static [u8]) -> bool {
        a == b
    }

    // `@embedFile("bun_shim_impl.exe")` — the shim PE is built as a separate
    // artifact by the Windows build before this crate is compiled, then embedded
    // here. It is only ever consumed from `#[cfg(windows)]` code paths
    // (`bin::Linker::create_windows_shim`), so on non-Windows hosts there is no
    // artifact to embed and the data is never read.
    #[cfg(windows)]
    pub const EMBEDDED_EXECUTABLE_DATA: &[u8] = include_bytes!("bun_shim_impl.exe");
    #[cfg(not(windows))]
    pub const EMBEDDED_EXECUTABLE_DATA: &[u8] = &[];

    /// Guard against the placeholder/empty artifact slipping through: a 0-byte
    /// embed would silently make `bun install` write 0-byte `.exe` shims into
    /// `node_modules/.bin/` and break every package binary. This is a runtime
    /// guard (not `const _: () = assert!(..)`) so `cargo check` on Windows can
    /// type-check the install crate before the separate `bun_shim_impl` build step
    /// has produced the PE — but any actual *use* of the data still fails loudly.
    /// Call this from every site that writes `EMBEDDED_EXECUTABLE_DATA` to disk.
    ///
    /// PORT NOTE: this MUST be a process exit, not `panic!()`. The only caller
    /// (`bin::Linker::create_windows_shim`) runs on the parallel-install thread
    /// pool; the workspace is `panic = "unwind"`, so a `panic!()` here unwinds
    /// and kills the worker thread — the main install loop's pending-task counter
    /// never decrements and `bun install` hangs until the CI 180s timeout, then
    /// retries forever. Zig has no equivalent guard (build.zig provides the embed
    /// via `addAnonymousImport` so it can never be empty); until the Rust port
    /// wires the standalone-shim build step, fail the *process* fast instead.
    #[inline]
    #[track_caller]
    pub fn embedded_executable_data() -> &'static [u8] {
        if EMBEDDED_EXECUTABLE_DATA.is_empty() {
            bun_core::Output::pretty_errorln(format_args!(
                "<r><red>error<r>: bun_shim_impl.exe is empty — the Windows shim \
             PE must be built before this crate is compiled (the build is \
             missing the windows-shim step)",
            ));
            bun_core::Global::crash();
        }
        EMBEDDED_EXECUTABLE_DATA
    }

    #[derive(Copy, Clone, Eq, PartialEq)]
    enum ExtensionType {
        RunWithBun,
        RunWithCmd,
        RunWithPowershell,
    }

    // Zig used `std.StaticStringMap` keyed by the UTF-16LE *byte* reinterpretation of
    // each extension (via `wU8`). Here we match directly on the `&[u16]` extension
    // using `bun_core::w!` literals — semantically identical, drops the byte cast.
    // PERF(port): was comptime StaticStringMap (perfect hash) — profile in Phase B
    fn bun_extensions_get(ext: &[u16]) -> Option<ExtensionType> {
        use ExtensionType::*;
        macro_rules! w {
            ($s:literal) => {
                bun_core::w!($s)
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
        pub fn init(
            launcher: &'a [u8],
            is_node_or_bun: bool,
        ) -> Result<Shebang<'a>, bun_core::Error> {
            // TODO(port): narrow error set (Zig inferred empty error set here)
            Ok(Shebang {
                launcher,
                // TODO(@paperclover): what if this is invalid utf8?
                utf16_len: u32::try_from(simdutf::length::utf16::from::utf8(launcher))
                    .expect("int cast"),
                is_node_or_bun,
            })
        }

        /// std.fs.path.extension but utf16
        pub fn extension_w(path: &[u16]) -> &[u16] {
            let filename = strings::basename_windows(path);
            let Some(index) = filename.iter().rposition(|&c| c == b'.' as u16) else {
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
            let contents = &contents_maybe_overflow[0..contents_maybe_overflow
                .len()
                .min(Self::MAX_SHEBANG_INPUT_LENGTH)];

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
                let is_node_or_bun =
                    eql_comptime(program, b"bun") || eql_comptime(program, b"node");
                return Shebang::init(rest, is_node_or_bun).map(Some);
            }

            Shebang::init(line, false).map(Some)
        }

        pub fn encoded_length(&self) -> usize {
            (b" ".len() + self.utf16_len as usize) * size_of::<u16>() + size_of::<u32>() * 2
        }
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

            // Zig used `@alignCast` here. `bytemuck::cast_slice_mut` performs the same
            // runtime alignment + size-multiple check and panics on mismatch — no
            // `unsafe` needed. (The sole caller, `bin.rs`, passes a stack `[u8; 65536]`
            // whose Rust-guaranteed alignment is 1; it should be changed to a `[u16; N]`
            // buffer to make alignment a compile-time guarantee — tracked separately.)
            let mut wbuf: &mut [u16] = bytemuck::cast_slice_mut(buf);

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

                let encoded = strings::convert_utf8_to_utf16_in_buffer(
                    &mut wbuf[0..s.utf16_len as usize],
                    s.launcher,
                );
                debug_assert!(encoded.len() == s.utf16_len as usize);
                wbuf = &mut wbuf[s.utf16_len as usize..];

                wbuf[0] = b' ' as u16;
                wbuf = &mut wbuf[1..];

                // SAFETY: wbuf has at least 4 u16s (= 2 u32s) remaining per encoded_length();
                // Zig wrote via `*align(1) u32` — use unaligned writes.
                unsafe {
                    (wbuf.as_mut_ptr().cast::<u32>())
                        .write_unaligned(u32::try_from(self.bin_path.len() * 2).expect("int cast"));
                    (wbuf.as_mut_ptr().add(2).cast::<u32>()).write_unaligned((s.utf16_len) * 2 + 2); // include the spaces!
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
        // Zig read via `*align(1) const Flags`; bounds checked above so the trailing
        // 2-byte slice is in range. `pod_read_unaligned` is the safe equivalent of
        // `ptr.cast::<u16>().read_unaligned()` over a `&[u8]`.
        let flags = Flags::from_bits(bytemuck::pod_read_unaligned::<u16>(
            &input[input.len() - FLAGS_SIZE..],
        ));
        if !flags.is_valid() {
            return None;
        }

        let bin_path_u8: &[u8] = if flags.has_shebang() {
            'bin_path_u8: {
                // Bounds checked above; unaligned u32 read via safe `bytemuck`.
                let off = input.len() - FLAGS_SIZE - 2 * size_of::<u32>();
                let bin_path_byte_len =
                    bytemuck::pod_read_unaligned::<u32>(&input[off..off + size_of::<u32>()])
                        as usize;
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
            bin_path: bun_core::cast_slice::<u8, u16>(bin_path_u8),
            flags,
        })
    }
} // mod host

// ported from: src/install/windows-shim/BinLinkingShim.zig
