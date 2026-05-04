// translate-c is unable to translate the unsuffixed windows functions
// like `SetCurrentDirectory` since they are defined with an odd macro
// that translate-c doesn't handle.
//
//     #define SetCurrentDirectory __MINGW_NAME_AW(SetCurrentDirectory)
//
// In these cases, it's better to just reference the underlying function
// directly: SetCurrentDirectoryW. To make the error better, a post
// processing step is applied to the translate-c file.

use std::io::Write as _;
use bstr::{BStr, ByteSlice};

// TODO(port): standalone build-time codegen binary — uses std::env / std::fs::{read,write}
// directly (PORTING.md bans std::fs for runtime code). The Zig original also calls std.fs
// directly (not bun.sys) since this never links into the runtime. Phase B: either keep as-is
// for build tooling, or swap to bun_sys::File::read_from / bun_sys::File::write_file.

static SYMBOL_REPLACEMENTS: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
    b"NTSTATUS" => b"@import(\"std\").os.windows.NTSTATUS",
    b"HANDLE"   => b"@import(\"std\").os.windows.HANDLE",
    b"PHANDLE"  => b"*HANDLE",
};

pub fn main() -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut args = std::env::args();
    assert(args.next().is_some()); // skip argv[0]

    let input: Vec<u8> = 'brk: {
        let in_path = args.next().unwrap_or_else(|| panic!("missing argument"));
        // Zig: openFile + readToEndAllocOptions(.., sentinel 0). Sentinel was only
        // needed for std.zig.Tokenizer; the inline scan below doesn't require it.
        break 'brk std::fs::read(&in_path)
            .map_err(|_| bun_core::err!("ReadFailed"))?;
    };
    let in_bytes: &[u8] = &input;

    let mut out: Vec<u8> = Vec::with_capacity(in_bytes.len());

    let mut i: usize = 0;
    while let Some(pub_i) = index_of_pos(in_bytes, i, b"pub const ") {
        // TODO(port): std.zig.Tokenizer replaced with an inline ASCII identifier scan.
        // translate-c emits plain `[A-Za-z_][A-Za-z0-9_]*` identifiers here; verify the
        // `@"…"` raw-identifier form never appears after `pub const ` in the input.
        let symbol_start = pub_i + b"pub const ".len();
        let symbol_end = symbol_start
            + in_bytes[symbol_start..]
                .iter()
                .position(|&b| !(b.is_ascii_alphanumeric() || b == b'_'))
                .unwrap_or(in_bytes.len() - symbol_start);
        assert(symbol_end > symbol_start); // Zig: assert(symbol_name_token.tag == .identifier)
        let symbol_name = &in_bytes[symbol_start..symbol_end];

        out.extend_from_slice(&in_bytes[i..symbol_end]);
        i = symbol_end;

        let mut end_of_line =
            index_of_scalar_pos(in_bytes, symbol_end, b'\n').unwrap_or(in_bytes.len());
        if in_bytes[end_of_line - 1] != b';' {
            // skip multiline decl
            out.extend_from_slice(&in_bytes[i..end_of_line]);
            i = end_of_line;
            continue;
        }
        end_of_line += 1; // include the \n

        if let Some(replace) = SYMBOL_REPLACEMENTS.get(symbol_name) {
            write!(&mut out, " = {};\n", BStr::new(replace)).expect("unreachable");
        } else if in_bytes[i..].starts_with(b" = __MINGW_NAME_AW(") {
            write!(
                &mut out,
                " = @compileError(\"Use '{}W' instead.\");\n",
                BStr::new(symbol_name),
            )
            .expect("unreachable");
        } else {
            out.extend_from_slice(&in_bytes[i..end_of_line]);
        }
        i = end_of_line;
    }
    out.extend_from_slice(&in_bytes[i..]);

    let out_path = args.next().unwrap_or_else(|| panic!("missing argument"));
    std::fs::write(&out_path, &out).map_err(|_| bun_core::err!("WriteFailed"))?;
    Ok(())
}

fn assert(cond: bool) {
    if !cond {
        panic!("unhandled");
    }
}

// Cold-path helpers mirroring std.mem.indexOfPos / indexOfScalarPos.
fn index_of_pos(haystack: &[u8], start: usize, needle: &[u8]) -> Option<usize> {
    haystack[start..].find(needle).map(|p| start + p)
}

fn index_of_scalar_pos(haystack: &[u8], start: usize, scalar: u8) -> Option<usize> {
    haystack[start..]
        .iter()
        .position(|&b| b == scalar)
        .map(|p| start + p)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/codegen/process_windows_translate_c.zig (73 lines)
//   confidence: medium
//   todos:      3
//   notes:      build-time binary; std.zig.Tokenizer inlined as ASCII ident scan; std::fs/env used deliberately
// ──────────────────────────────────────────────────────────────────────────
