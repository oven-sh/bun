#![allow(dead_code)]
use core::ptr::NonNull;
pub struct Log(u8);
pub struct Source(u8);
pub struct Arena(u8);
#[derive(Copy, Clone)] #[repr(transparent)] pub struct Loc { start: i32 }
#[derive(Copy, Clone)] pub struct Range { loc: Loc, len: i32 }
#[derive(Copy, Clone)] #[repr(C, packed(4))] pub struct StoreStr { ptr: NonNull<u8>, len: u32 }
#[derive(Copy, Clone)] pub struct Span { text: StoreStr, range: Range }
#[derive(Copy, Clone)] pub struct JSXPragma { a: Span, b: Span, c: Span, d: Span }
pub struct Comment { loc: Loc, text: StoreStr }
#[repr(u8)] #[derive(Copy, Clone)] pub enum T { A, B, C }
#[derive(Copy, Clone)] pub enum Fmt { Ascii, Utf16, NeedsDecode }
macro_rules! lexer { ($name:ident { $($extra:tt)* }) => {
pub struct $name<'a> {
    log: NonNull<Log>,
    source: &'a Source,
    contents: &'a [u8],
    current: usize,
    start: usize,
    end: usize,
    approximate_newline_count: usize,
    previous_backslash_quote_in_jsx: Range,
    token: T,
    has_newline_before: bool,
    has_pure_comment_before: bool,
    has_react_hooks_suppression_before: bool,
    has_react_hooks_block_suppression: bool,
    preserve_all_comments_before: bool,
    is_legacy_octal_literal: bool,
    is_log_disabled: bool,
    comments_to_preserve_before: Vec<Comment>,
    code_point: i32,
    identifier: &'a [u8],
    jsx_pragma: JSXPragma,
    source_mapping_url: Option<Span>,
    number: f64,
    rescan_close_brace_as_template_token: bool,
    prev_error_loc: Loc,
    prev_token_was_await_keyword: bool,
    fn_or_arrow_start_loc: Loc,
    regex_flags_start: Option<u16>,
    arena: &'a Arena,
    string_literal_raw_content: &'a [u8],
    string_literal_start: usize,
    string_literal_raw_format: Fmt,
    temp_buffer_u16: Vec<u16>,
    track_comments: bool,
    track_react_suppressions: bool,
    jsc_builtin_syntax: bool,
    all_comments: Vec<Range>,
    $($extra)*
}}}
lexer!(Lexer0 {});
lexer!(Lexer1 { lint: bool, });
lexer!(Lexer2 { lint: bool, x: bool, });
lexer!(Lexer3 { lint: bool, x: u16, });
lexer!(Lexer4 { lint: bool, x: u16, y: u16, });
lexer!(Lexer5 { lint: bool, x: u32, });
lexer!(Lexer6 { lint: bool, x: u32, y:bool, });
lexer!(Lexer7 { lint: bool, x: u32, y:u16, });
lexer!(Lexer8 { a:u8,b:u8,c:u8,d:u8,e:u8,f:u8,g:u8, });
fn main() {
    use core::mem::{size_of, align_of};
    println!("Span {} align {}", size_of::<Span>(), align_of::<Span>());
    println!("Option<Span> {}", size_of::<Option<Span>>());
    println!("Option<u16> {}", size_of::<Option<u16>>());
    println!("JSXPragma {}", size_of::<JSXPragma>());
    println!("Lexer0 (today) {}", size_of::<Lexer0>());
    println!("Lexer1 (+bool) {}", size_of::<Lexer1>());
    println!("Lexer2 (+2 bool) {}", size_of::<Lexer2>());
    println!("Lexer3 (+bool+u16) {}", size_of::<Lexer3>());
    println!("Lexer4 (+bool+2*u16) {}", size_of::<Lexer4>());
    println!("Lexer5 (+bool+u32) {}", size_of::<Lexer5>());
    println!("Lexer6 (+bool+u32+bool) {}", size_of::<Lexer6>());
    println!("Lexer7 (+bool+u32+u16) {}", size_of::<Lexer7>());
    println!("Lexer8 (+7 u8) {}", size_of::<Lexer8>());
}
