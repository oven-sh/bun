//! Parses the `.bunx` file and builds the command line.

use core::io::BorrowedBuf;
use core::mem::MaybeUninit;

use crate::_bin_linking_shim::Flags;

pub(crate) const QUOTE: u16 = '"' as u16;
const SPACE: u16 = ' ' as u16;
const BACKSLASH: u16 = '\\' as u16;

/// `None` if `parts` do not fit in `buf`.
pub(crate) fn try_concat_into<'a>(
    buf: &'a mut [MaybeUninit<u16>],
    parts: &[&[u16]],
) -> Option<&'a mut [u16]> {
    let mut buf = BorrowedBuf::from(buf);
    for part in parts {
        let mut unfilled = buf.unfilled();
        if unfilled.capacity() < part.len() {
            return None;
        }
        unfilled.append(part);
    }
    Some(buf.into_filled_mut())
}

/// Has a leading space, like ' arg arg2', or is empty.
#[cfg(any(test, feature = "shim_standalone"))]
pub(crate) fn user_arguments(command_line: &[u16]) -> &[u16] {
    // https://stackoverflow.com/questions/7760545/escape-double-quotes-in-parameter
    let mut in_quote = false;
    let mut rest = command_line;
    loop {
        rest = match rest {
            // 'quote directly follows closer - acts as plain unwrapped text: "'
            [QUOTE, QUOTE, after @ ..] if in_quote => {
                in_quote = false;
                after
            }
            [QUOTE, after @ ..] => {
                in_quote = !in_quote;
                after
            }
            [SPACE, next, ..] if !in_quote && *next != SPACE => return rest,
            [_, after @ ..] => after,
            [] => return rest,
        };
    }
}

/// 'C:\project\node_modules\' for 'C:\project\node_modules\.bin\hello.exe'.
pub(crate) fn node_modules_path(shim_path: &[u16]) -> Option<&[u16]> {
    let (_backslash, bin_directory) = up_to_last_backslash(shim_path)?.split_last()?;
    up_to_last_backslash(bin_directory)
}

fn up_to_last_backslash(path: &[u16]) -> Option<&[u16]> {
    path.get(..=path.iter().rposition(|&unit| unit == BACKSLASH)?)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum InvalidShim {
    Validation,
    Bounds,
}

/// The contents of a `.bunx` file. `BinLinkingShim.rs` has the format.
pub(crate) struct Metadata<'a> {
    pub(crate) flags: Flags,
    /// The last unit is not checked.
    pub(crate) bin_path_and_quote: &'a [u16],
    /// Empty if there is no shebang.
    launcher: &'a [u16],
}

impl<'a> Metadata<'a> {
    pub(crate) fn parse(file: &'a [u16]) -> Result<Self, InvalidShim> {
        let (&flags, rest) = file.split_last().ok_or(InvalidShim::Validation)?;
        let flags = Flags::from_bits(flags);
        if !flags.is_valid() {
            return Err(InvalidShim::Validation);
        }

        let (rest, launcher) = if flags.has_shebang() {
            Self::split_launcher(rest).ok_or(InvalidShim::Bounds)?
        } else {
            (rest, &[][..])
        };
        let (_zero, bin_path_and_quote) = rest.split_last().ok_or(InvalidShim::Bounds)?;

        Ok(Self {
            flags,
            bin_path_and_quote,
            launcher,
        })
    }

    fn split_launcher(file: &[u16]) -> Option<(&[u16], &[u16])> {
        let (rest, &[bin_low, bin_high, args_low, args_high]) = file.split_last_chunk()?;
        let bin_path_len_bytes = usize::from(bin_high) << 16 | usize::from(bin_low);
        let args_len_bytes = usize::from(args_high) << 16 | usize::from(args_low);

        let (rest, launcher) = rest.split_at_checked(bin_path_len_bytes / 2 + b"\"\0".len())?;
        (bin_path_len_bytes.is_multiple_of(2)
            && !launcher.is_empty()
            && size_of_val(launcher) == args_len_bytes)
            .then_some((rest, launcher))
    }
}

/// Ends with a NUL.
pub(crate) struct CommandLine<'a>(&'a mut [u16]);

impl<'a> CommandLine<'a> {
    /// 'node "C:\project\node_modules\my-cli\src\app.js" --flags'. `None` if it does not fit in `buf`.
    pub(crate) fn new(
        buf: &'a mut [MaybeUninit<u16>],
        metadata: &Metadata<'_>,
        bin_path_base: &[u16],
        arguments: &[u16],
    ) -> Option<Self> {
        let parts = [
            metadata.launcher,
            &[QUOTE],
            bin_path_base,
            metadata.bin_path_and_quote,
            arguments,
            &[0],
        ];
        try_concat_into(buf, &parts).map(Self)
    }

    pub(crate) fn as_mut_ptr(&mut self) -> *mut u16 {
        self.0.as_mut_ptr()
    }

    /// Without the NUL.
    pub(crate) fn as_slice(&self) -> &[u16] {
        self.0.split_last().map_or(&[], |(_nul, units)| units)
    }

    /// Up to the first space.
    pub(crate) fn program(&self) -> &[u16] {
        let mut words = self.as_slice().split(|&unit| unit == SPACE);
        words.next().unwrap_or_default()
    }

    /// 'node ...' becomes 'nbun ...', and then starts one unit later. `false` if it is too short.
    pub(crate) fn replace_node_with_bun(&mut self) -> bool {
        let [_, b, u, n, _, ..] = self.0 else {
            return false;
        };
        [*b, *u, *n] = b"bun".map(u16::from);
        self.0.split_off_first_mut();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: u16 = 5478 << 3;
    const NODE_OR_BUN: u16 = 0b001;
    const SHEBANG: u16 = 0b100;

    fn w(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn s(units: &[u16]) -> String {
        String::from_utf16(units).unwrap()
    }

    fn with_shebang(bin_path: &str, launcher: &str, lengths: [u32; 2]) -> Vec<u16> {
        let mut file = w(&format!("{bin_path}\"\0{launcher}"));
        file.extend(lengths.iter().flat_map(|&n| [n as u16, (n >> 16) as u16]));
        file.push(VALID | SHEBANG | NODE_OR_BUN);
        file
    }

    fn command_line<'a>(buf: &'a mut [MaybeUninit<u16>], file: &[u16]) -> Option<CommandLine<'a>> {
        let metadata = Metadata::parse(file).unwrap();
        CommandLine::new(buf, &metadata, &w(r"C:\m\"), &w(" -x"))
    }

    #[test]
    fn user_arguments_start_at_the_last_space_after_the_program() {
        for (command_line, arguments) in [
            ("", ""),
            ("a.exe", ""),
            ("a.exe ", ""),
            ("a.exe    ", ""),
            ("a.exe b", " b"),
            ("a.exe   b  c ", " b  c "),
            (r#""a b.exe""#, ""),
            (r#""a b.exe" c"#, " c"),
            (r#""a b.exe c"#, ""),
            (r#""a"" b"#, " b"),
            (r#""a""" b"#, ""),
            (r#""" b"#, " b"),
            (r#"a.exe "b c""#, r#" "b c""#),
            (" a", " a"),
        ] {
            assert_eq!(
                s(user_arguments(&w(command_line))),
                arguments,
                "{command_line}"
            );
        }
    }

    #[test]
    fn node_modules_path_is_the_parent_of_the_directory_of_the_shim() {
        for (shim_path, expected) in [
            (r"C:\p\node_modules\.bin\a.exe", Some(r"C:\p\node_modules\")),
            (r"C:\bin\a.exe", Some(r"C:\")),
            (r"\\host\share\a.exe", Some(r"\\host\")),
            (r"C:\a.exe", None),
            ("a.exe", None),
            ("", None),
        ] {
            let actual = node_modules_path(&w(shim_path)).map(s);
            assert_eq!(actual.as_deref(), expected, "{shim_path}");
        }
    }

    #[test]
    fn parse_without_a_shebang() {
        let file = [&w("a\\b.exe\"\0")[..], &[VALID]].concat();
        let metadata = Metadata::parse(&file).unwrap();
        assert_eq!(s(metadata.bin_path_and_quote), "a\\b.exe\"");
        assert_eq!(s(metadata.launcher), "");
        assert_eq!(metadata.flags.version_tag().bits(), 2739);
    }

    #[test]
    fn parse_with_a_shebang() {
        let mut file = with_shebang("a.js", "node ", [8, 10]);
        let mut flags = Flags::from_bits(file.pop().unwrap());
        flags.set_is_node(true);
        file.push(flags.bits());

        let metadata = Metadata::parse(&file).unwrap();
        assert_eq!(s(metadata.bin_path_and_quote), "a.js\"");
        assert_eq!(s(metadata.launcher), "node ");
        let flags = metadata.flags;
        assert!(flags.is_node() && flags.is_node_or_bun() && !flags.is_absolute_target());
    }

    #[test]
    fn parse_reads_the_high_half_of_both_lengths() {
        let mut file = vec![0; 0x8003 + 0x8002];
        file.extend([2, 1, 4, 1, VALID | SHEBANG]);
        let metadata = Metadata::parse(&file).unwrap();
        assert_eq!(metadata.bin_path_and_quote.len(), 0x8002);
        assert_eq!(metadata.launcher.len(), 0x8002);
    }

    #[test]
    fn parse_rejects_another_version() {
        for file in [&[][..], &[0], &[QUOTE, 0, VALID + 0x10], &[VALID, 0]] {
            assert_eq!(Metadata::parse(file).err(), Some(InvalidShim::Validation));
        }
    }

    #[test]
    fn parse_rejects_lengths_that_do_not_match_the_file() {
        for lengths in [
            [8, 8],
            [8, 12],
            [6, 10],
            [10, 10],
            [9, 10],
            [8, 11],
            [9, 9],
            [7, 11],
            [18, 0],
            [u32::MAX - 1, 20],
            [20, u32::MAX - 1],
            [0x10008, 10],
            [8, 0x1000a],
        ] {
            let file = with_shebang("a.js", "node ", lengths);
            let error = Metadata::parse(&file).err();
            assert_eq!(error, Some(InvalidShim::Bounds), "{lengths:?}");
        }
    }

    #[test]
    fn parse_rejects_a_file_that_is_too_short_for_its_flags() {
        assert_eq!(Metadata::parse(&[VALID]).err(), Some(InvalidShim::Bounds));
        for len in 0..7 {
            let file = [&vec![0; len][..], &[VALID | SHEBANG]].concat();
            let error = Metadata::parse(&file).err();
            assert_eq!(error, Some(InvalidShim::Bounds), "{len}");
        }
    }

    #[test]
    fn command_line_needs_room_for_the_nul() {
        let file = with_shebang("a.js", "node ", [8, 10]);
        let expected = r#"node "C:\m\a.js" -x"#;
        let mut buf = vec![MaybeUninit::uninit(); expected.len() + 1];

        let fits = command_line(&mut buf, &file).unwrap();
        assert_eq!(s(fits.0), format!("{expected}\0"));
        assert_eq!(s(fits.as_slice()), expected);
        assert!(command_line(&mut buf[1..], &file).is_none());
    }

    #[test]
    fn program_ends_at_a_space_or_at_the_nul() {
        let mut buf = [MaybeUninit::uninit(); 64];
        let file = with_shebang("a.py", "python3 -u ", [8, 22]);
        assert_eq!(
            s(command_line(&mut buf, &file).unwrap().program()),
            "python3"
        );

        let file = with_shebang("a.py", "python3", [8, 14]);
        let metadata = Metadata::parse(&file).unwrap();
        let no_space = CommandLine::new(&mut buf, &metadata, &[], &[]).unwrap();
        assert_eq!(s(no_space.program()), r#"python3"a.py""#);
    }

    #[test]
    fn replace_node_with_bun_keeps_the_nul() {
        let mut buf = [MaybeUninit::uninit(); 64];
        let file = with_shebang("a.js", "node ", [8, 10]);
        let mut node = command_line(&mut buf, &file).unwrap();
        let start = node.as_mut_ptr();
        assert!(node.replace_node_with_bun());
        assert_eq!(s(node.0), "bun \"C:\\m\\a.js\" -x\0");
        assert_eq!(node.as_mut_ptr(), start.wrapping_add(1));

        let file = with_shebang("", "n", [0, 2]);
        let metadata = Metadata::parse(&file).unwrap();
        let mut short = CommandLine::new(&mut buf, &metadata, &[], &[]).unwrap();
        assert!(!short.replace_node_with_bun());
        assert_eq!(s(short.0), "n\"\"\0");
    }
}
