use crate::string::strings;

const SPECIAL_CHARACTERS: &[u8] = b"|\\{}()[]^$+*?.-";

// TODO(port): writer trait — Zig uses `*std.Io.Writer` (byte writer). Mapping to
// `&mut impl std::io::Write` per PORTING.md; Phase B may swap to the concrete
// crate-local byte-writer trait once `bun_io` is wired.
pub fn escape_reg_exp<W: std::io::Write>(
    input: &[u8],
    writer: &mut W,
) -> Result<(), std::io::Error> {
    let mut remain = input;

    while let Some(i) = strings::index_of_any(remain, SPECIAL_CHARACTERS).map(|i| i as usize) {
        writer.write_all(&remain[0..i])?;
        match remain[i] {
            c @ (b'|' | b'\\' | b'{' | b'}' | b'(' | b')' | b'[' | b']' | b'^' | b'$' | b'+'
            | b'*' | b'?' | b'.') => writer.write_all(&[b'\\', c])?,
            b'-' => writer.write_all(b"\\x2d")?,
            c => {
                if cfg!(debug_assertions) {
                    unreachable!();
                }
                writer.write_all(&[c])?;
            }
        }
        remain = &remain[i + 1..];
    }

    writer.write_all(remain)
}

/// '*' becomes '.*' instead of '\\*'
pub fn escape_reg_exp_for_package_name_matching<W: std::io::Write>(
    input: &[u8],
    writer: &mut W,
) -> Result<(), std::io::Error> {
    let mut remain = input;

    while let Some(i) = strings::index_of_any(remain, SPECIAL_CHARACTERS).map(|i| i as usize) {
        writer.write_all(&remain[0..i])?;
        match remain[i] {
            c @ (b'|' | b'\\' | b'{' | b'}' | b'(' | b')' | b'[' | b']' | b'^' | b'$' | b'+'
            | b'?' | b'.') => writer.write_all(&[b'\\', c])?,
            b'*' => writer.write_all(b".*")?,
            b'-' => writer.write_all(b"\\x2d")?,
            c => {
                if cfg!(debug_assertions) {
                    unreachable!();
                }
                writer.write_all(&[c])?;
            }
        }
        remain = &remain[i + 1..];
    }

    writer.write_all(remain)
}

// PORT NOTE: the Zig file re-exported `jsEscapeRegExp` / `jsEscapeRegExpForPackageNameMatching`
// from `../jsc/bun_string_jsc.zig`. Per PORTING.md these `*_jsc` alias lines are deleted —
// the JS-facing wrappers live in the `*_jsc` crate as extension-trait methods.

// ported from: src/string/escapeRegExp.zig
