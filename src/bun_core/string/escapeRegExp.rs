use crate::strings;

const SPECIAL_CHARACTERS: &[u8] = b"|\\{}()[]^$+*?.-";

pub fn escape_reg_exp<W: std::io::Write>(
    input: &[u8],
    writer: &mut W,
) -> Result<(), std::io::Error> {
    let mut remain = input;

    while let Some(i) = strings::index_of_any(remain, SPECIAL_CHARACTERS) {
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

    while let Some(i) = strings::index_of_any(remain, SPECIAL_CHARACTERS) {
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

// The JS-facing wrappers (`jsEscapeRegExp` / `jsEscapeRegExpForPackageNameMatching`)
// live in the `*_jsc` crate as extension-trait methods.
