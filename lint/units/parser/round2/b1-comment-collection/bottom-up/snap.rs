#![allow(dead_code)]
use core::ptr::NonNull;
#[derive(Copy, Clone)] #[repr(transparent)] pub struct Loc { start: i32 }
#[derive(Copy, Clone)] pub struct Range { loc: Loc, len: i32 }
#[derive(Copy, Clone)] #[repr(C, packed(4))] pub struct StoreStr { ptr: NonNull<u8>, len: u32 }
#[derive(Copy, Clone)] pub struct Span { text: StoreStr, range: Range }
#[derive(Copy, Clone)] pub struct JSXPragma { a: Span, b: Span, c: Span, d: Span }
#[repr(u8)] #[derive(Copy, Clone)] pub enum T { A, B, C }
#[derive(Copy, Clone)] pub enum Fmt { Ascii, Utf16, NeedsDecode }
#[derive(Copy, Clone, PartialEq, Eq)] #[repr(u8)] pub enum TrackComments { Off, ForCharFreq, All }
macro_rules! snap { ($name:ident, $track:ty) => {
#[derive(Clone, Copy)]
pub struct $name<'a> {
    current: usize, start: usize, end: usize, approximate_newline_count: usize,
    previous_backslash_quote_in_jsx: Range, token: T,
    has_newline_before: bool, has_pure_comment_before: bool, has_react_hooks_suppression_before: bool,
    has_react_hooks_block_suppression: bool, preserve_all_comments_before: bool, is_legacy_octal_literal: bool,
    is_log_disabled: bool, code_point: i32, identifier: &'a [u8], jsx_pragma: JSXPragma,
    source_mapping_url: Option<Span>, number: f64, rescan_close_brace_as_template_token: bool,
    prev_error_loc: Loc, prev_token_was_await_keyword: bool, fn_or_arrow_start_loc: Loc,
    regex_flags_start: Option<u16>, string_literal_raw_content: &'a [u8], string_literal_start: usize,
    string_literal_raw_format: Fmt, track_comments: $track, track_react_suppressions: bool,
    all_comments_len: usize, comments_to_preserve_before_len: usize,
}}}
snap!(SnapBool, bool);
snap!(SnapEnum, TrackComments);
#[derive(Clone, Copy, PartialEq, Eq, Debug)] #[repr(u8)] pub enum CommentKind { Line, Block, JSDoc }
#[derive(Clone, Copy, PartialEq, Eq, Debug)] pub struct Comment { pub start: u32, pub end: u32, pub kind: CommentKind }
fn main() {
    use core::mem::{size_of, align_of};
    println!("LexerSnapshot(bool) {} LexerSnapshot(enum) {}", size_of::<SnapBool>(), size_of::<SnapEnum>());
    println!("TrackComments {} Comment {} align {} Option<Comment> {}", size_of::<TrackComments>(), size_of::<Comment>(), align_of::<Comment>(), size_of::<Option<Comment>>());
}
