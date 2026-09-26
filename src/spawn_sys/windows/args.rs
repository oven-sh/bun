//! The child's command line.

/// Appends `s` (WTF-8) as UTF-16. An unpaired surrogate is kept; an invalid
/// byte becomes U+FFFD.
pub fn push_wtf8(out: &mut Vec<u16>, s: &[u8]) {
    let start = out.len();
    // Every UTF-16 unit consumes at least one input byte.
    out.resize(start + s.len(), 0);
    let written = bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut out[start..], s).len();
    out.truncate(start + written);
}

/// Appends `arg` quoted so that `CommandLineToArgvW` and the MSVCRT/UCRT
/// `argv` parser give it back unchanged: quotes only around an empty argument
/// or one containing a space, a tab or `"`; `"` becomes `\"`; a run of `n`
/// backslashes is doubled only where a `"` follows it (the embedded one or the
/// closing one).
pub fn quote_arg(out: &mut Vec<u16>, arg: &[u16]) {
    const QUOTE: u16 = b'"' as u16;
    const BACKSLASH: u16 = b'\\' as u16;

    let needs_quotes = arg.is_empty()
        || arg
            .iter()
            .any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == QUOTE);
    if !needs_quotes {
        out.extend_from_slice(arg);
        return;
    }

    out.push(QUOTE);
    let mut backslashes = 0usize;
    for &c in arg {
        if c == BACKSLASH {
            backslashes += 1;
        } else {
            if c == QUOTE {
                out.extend(core::iter::repeat_n(BACKSLASH, backslashes + 1));
            }
            backslashes = 0;
        }
        out.push(c);
    }
    out.extend(core::iter::repeat_n(BACKSLASH, backslashes));
    out.push(QUOTE);
}

/// The NUL-terminated command line for `args` (WTF-8), joined with single
/// spaces. `verbatim` copies every argument as is.
pub fn make_command_line<'a>(args: impl Iterator<Item = &'a [u8]>, verbatim: bool) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    let mut scratch: Vec<u16> = Vec::new();
    for (i, arg) in args.enumerate() {
        if i != 0 {
            out.push(b' ' as u16);
        }
        if verbatim {
            push_wtf8(&mut out, arg);
        } else {
            scratch.clear();
            push_wtf8(&mut scratch, arg);
            quote_arg(&mut out, &scratch);
        }
    }
    out.push(0);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn quoted(s: &str) -> String {
        let mut out = Vec::new();
        quote_arg(&mut out, &w(s));
        String::from_utf16(&out).unwrap()
    }

    #[test]
    fn quoting_matches_the_msvcrt_rules() {
        assert_eq!(quoted(""), r#""""#);
        assert_eq!(quoted("plain"), "plain");
        assert_eq!(quoted("hello world"), r#""hello world""#);
        assert_eq!(quoted("tab\there"), "\"tab\there\"");
        assert_eq!(quoted(r#"hello"world"#), r#""hello\"world""#);
        assert_eq!(quoted(r#"hello""world"#), r#""hello\"\"world""#);
        assert_eq!(quoted(r"hello\world"), r"hello\world");
        assert_eq!(quoted(r"hello\\world"), r"hello\\world");
        assert_eq!(quoted(r#"hello\"world"#), r#""hello\\\"world""#);
        assert_eq!(quoted(r#"hello\\"world"#), r#""hello\\\\\"world""#);
        assert_eq!(quoted(r"hello world\"), r#""hello world\\""#);
        assert_eq!(quoted(r"a\b c"), r#""a\b c""#);
        assert_eq!(quoted("new\nline"), "new\nline");
    }

    #[test]
    fn command_line_joins_with_one_space_and_terminates() {
        let args: [&[u8]; 4] = [b"C:\\Program Files\\x.exe", b"", b"a b", b"c"];
        let line = make_command_line(args.iter().copied(), false);
        assert_eq!(line.last(), Some(&0));
        assert_eq!(
            String::from_utf16(&line[..line.len() - 1]).unwrap(),
            r#""C:\Program Files\x.exe" "" "a b" c"#
        );
    }

    #[test]
    fn verbatim_copies_arguments_untouched() {
        let args: [&[u8]; 3] = [b"cmd.exe", b"/c", br#""echo "a b"""#];
        let line = make_command_line(args.iter().copied(), true);
        assert_eq!(
            String::from_utf16(&line[..line.len() - 1]).unwrap(),
            r#"cmd.exe /c "echo "a b"""#
        );
    }

    #[test]
    fn lone_surrogates_survive() {
        // U+D800 as WTF-8.
        let mut out = Vec::new();
        push_wtf8(&mut out, &[b'a', 0xED, 0xA0, 0x80, b'b']);
        assert_eq!(out, [b'a' as u16, 0xD800, b'b' as u16]);
    }
}
