// rustc --edition 2024 -O -o robust robust.rs && ./robust : no panic on every prefix of a header, and on comment ranges that are no comments.
#[path = "comment_directives.rs"]
mod comment_directives;
#[path = "pragmas.rs"]
mod pragmas;
mod strings {
    pub(super) fn index_of(text: &[u8], s: &[u8]) -> Option<usize> {
        (0..text.len()).find(|&at| text.get(at..).is_some_and(|rest| rest.starts_with(s)))
    }
    pub(super) fn index_of_char_usize(text: &[u8], char: u8) -> Option<usize> {
        (0..text.len()).find(|&at| text.get(at) == Some(&char))
    }
}
mod syntax_errors {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct Message {
        pub code: u32,
        pub text: &'static [u8],
    }
    pub const INVALID_REFERENCE_DIRECTIVE_SYNTAX: Message = Message { code: 1084, text: b"" };
    pub const X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT: Message = Message { code: 1453, text: b"" };
}
fn main() {
    let text: &[u8] = b"#!x\n\xef\xbb\xbf/// <reference path=\"a\" types='b' lib=\"c\" resolution-mode=\"import\" preserve=\"true\" no-default-lib=\"true\"/>\r\n// @ts-check\n/// <reference types=\"t\" resolution-mode=\"x\"/>\n/// <reference />\n/** @jsx h\n * @jsxFrag F \xe2\x80\xa8 @jsxRuntime classic */\n/* @ts-ignore */ // @ts-expect-error\nlet x;";
    let (mut pragmas, mut diags, mut directives) = (0, 0, 0);
    for end in 0..=text.len() {
        for start in 0..=end.min(6) {
            let t = &text[start..end];
            let header = pragmas::Header::read(t, &mut |_, _, m| diags += (m.code > 0) as usize + m.text.len());
            pragmas += header.pragmas.len() + header.reference_directives.len() + header.check_js_directive.is_some() as usize;
            let _ = pragmas::get_leading_comment_ranges(t).len();
            // Every range of up to 40 bytes at every offset, and some that are no ranges of the text.
            let ranges = (0..t.len() as u32).flat_map(|s| [1, 2, 3, 17, 40].into_iter().map(move |l| (s, s + l)));
            directives += comment_directives::scan_comment_directives(t, ranges).len();
        }
    }
    let len = text.len() as u32;
    let odd = [(0, 0), (5, 2), (u32::MAX, u32::MAX), (u32::MAX - 1, u32::MAX), (3, u32::MAX), (len, len + 2), (len - 1, len + 1), (len - 1, len)];
    directives += comment_directives::scan_comment_directives(text, odd).len();
    directives += comment_directives::scan_comment_directives(b"", odd).len();
    directives += comment_directives::scan_comment_directives(b"/", odd).len();
    println!("no panic: pragmas={pragmas} diagnostics={diags} directives={directives}");
}
