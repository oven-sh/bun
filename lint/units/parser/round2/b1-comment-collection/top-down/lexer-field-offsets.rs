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
#[repr(u8)] #[derive(Copy, Clone)] pub enum T { V0, V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11, V12, V13, V14, V15, V16, V17, V18, V19, V20, V21, V22, V23, V24, V25, V26, V27, V28, V29, V30, V31, V32, V33, V34, V35, V36, V37, V38, V39, V40, V41, V42, V43, V44, V45, V46, V47, V48, V49, V50, V51, V52, V53, V54, V55, V56, V57, V58, V59, V60, V61, V62, V63, V64, V65, V66, V67, V68, V69, V70, V71, V72, V73, V74, V75, V76, V77, V78, V79, V80, V81, V82, V83, V84, V85, V86, V87, V88, V89, V90, V91, V92, V93, V94, V95, V96, V97, V98, V99, V100, V101, V102, V103, V104, V105, V106, V107, V108, V109, V110, V111 }
#[derive(Copy, Clone)] pub enum Fmt { Ascii, Utf16, NeedsDecode }

#[repr(u8)] #[derive(Copy, Clone)] pub enum Tc { Off, ForCharFreq, All }
macro_rules! lexer { ($name:ident, $tc:ty { $($extra:tt)* }) => {
pub struct $name<'a> {
    log: NonNull<Log>, source: &'a Source, contents: &'a [u8], current: usize, start: usize, end: usize,
    approximate_newline_count: usize, previous_backslash_quote_in_jsx: Range, token: T,
    has_newline_before: bool, has_pure_comment_before: bool, has_react_hooks_suppression_before: bool,
    has_react_hooks_block_suppression: bool, preserve_all_comments_before: bool, is_legacy_octal_literal: bool,
    is_log_disabled: bool, comments_to_preserve_before: Vec<Comment>, code_point: i32, identifier: &'a [u8],
    jsx_pragma: JSXPragma, source_mapping_url: Option<Span>, number: f64, rescan_close_brace_as_template_token: bool,
    prev_error_loc: Loc, prev_token_was_await_keyword: bool, fn_or_arrow_start_loc: Loc, regex_flags_start: Option<u16>,
    arena: &'a Arena, string_literal_raw_content: &'a [u8], string_literal_start: usize, string_literal_raw_format: Fmt,
    temp_buffer_u16: Vec<u16>, track_comments: $tc, track_react_suppressions: bool, jsc_builtin_syntax: bool,
    all_comments: Vec<Range>,
    $($extra)*
}}}
lexer!(Today, bool {});
lexer!(Enum, Tc {});
lexer!(PlusBool, bool { track_every_comment: bool, });
lexer!(PlusU8, bool { track_every_comment: u8, });
macro_rules! offs { ($t:ident) => {{ let mut v: Vec<(usize, &str)> = vec![ (offset_of!($t, log), "log"), (offset_of!($t, source), "source"), (offset_of!($t, contents), "contents"), (offset_of!($t, current), "current"), (offset_of!($t, start), "start"), (offset_of!($t, end), "end"), (offset_of!($t, approximate_newline_count), "approximate_newline_count"), (offset_of!($t, previous_backslash_quote_in_jsx), "previous_backslash_quote_in_jsx"), (offset_of!($t, token), "token"), (offset_of!($t, has_newline_before), "has_newline_before"), (offset_of!($t, has_pure_comment_before), "has_pure_comment_before"), (offset_of!($t, has_react_hooks_suppression_before), "has_react_hooks_suppression_before"), (offset_of!($t, has_react_hooks_block_suppression), "has_react_hooks_block_suppression"), (offset_of!($t, preserve_all_comments_before), "preserve_all_comments_before"), (offset_of!($t, is_legacy_octal_literal), "is_legacy_octal_literal"), (offset_of!($t, is_log_disabled), "is_log_disabled"), (offset_of!($t, comments_to_preserve_before), "comments_to_preserve_before"), (offset_of!($t, code_point), "code_point"), (offset_of!($t, identifier), "identifier"), (offset_of!($t, jsx_pragma), "jsx_pragma"), (offset_of!($t, source_mapping_url), "source_mapping_url"), (offset_of!($t, number), "number"), (offset_of!($t, rescan_close_brace_as_template_token), "rescan_close_brace_as_template_token"), (offset_of!($t, prev_error_loc), "prev_error_loc"), (offset_of!($t, prev_token_was_await_keyword), "prev_token_was_await_keyword"), (offset_of!($t, fn_or_arrow_start_loc), "fn_or_arrow_start_loc"), (offset_of!($t, regex_flags_start), "regex_flags_start"), (offset_of!($t, arena), "arena"), (offset_of!($t, string_literal_raw_content), "string_literal_raw_content"), (offset_of!($t, string_literal_start), "string_literal_start"), (offset_of!($t, string_literal_raw_format), "string_literal_raw_format"), (offset_of!($t, temp_buffer_u16), "temp_buffer_u16"), (offset_of!($t, track_comments), "track_comments"), (offset_of!($t, track_react_suppressions), "track_react_suppressions"), (offset_of!($t, jsc_builtin_syntax), "jsc_builtin_syntax"), (offset_of!($t, all_comments), "all_comments") ]; v.sort(); v }} }
fn main() {
    use core::mem::{size_of, offset_of};
    let a = offs!(Today); let b = offs!(Enum); let mut c = offs!(PlusBool);
    c.push((offset_of!(PlusBool, track_every_comment), "track_every_comment")); c.sort();
    println!("sizes: today {} enum {} plus-bool {}", size_of::<Today>(), size_of::<Enum>(), size_of::<PlusBool>());
    let get = |v: &Vec<(usize,&str)>, n: &str| v.iter().find(|x| x.1 == n).map(|x| x.0).unwrap();
    let mut moved_enum = vec![]; let mut moved_bool = vec![];
    for (off, name) in &a {
        if get(&b, name) != *off { moved_enum.push(format!("{name} {:#x}->{:#x}", off, get(&b, name))); }
        if get(&c, name) != *off { moved_bool.push(format!("{name} {:#x}->{:#x}", off, get(&c, name))); }
    }
    println!("fields that move with the enum: {:?}", moved_enum);
    println!("fields that move with a bool declared last: {:?}", moved_bool);
    let mut d = offs!(PlusU8); d.push((offset_of!(PlusU8, track_every_comment), "track_every_comment")); d.sort();
    let mut moved_u8 = vec![];
    for (off, name) in &a { if get(&d, name) != *off { moved_u8.push(format!("{name} {:#x}->{:#x}", off, get(&d, name))); } }
    println!("fields that move with a u8 declared last: {:?}; the u8 is at {:#x}; size {}", moved_u8, offset_of!(PlusU8, track_every_comment), size_of::<PlusU8>());
    println!("today track_comments at {:#x}; plus-bool: new field at {:#x}", get(&a, "track_comments"), offset_of!(PlusBool, track_every_comment));
    let bytes: Vec<String> = a.iter().filter(|x| x.0 >= 0x138).map(|x| format!("{:#x}:{}", x.0, x.1)).collect();
    println!("today, from 0x138: {}", bytes.join(" "));
}
