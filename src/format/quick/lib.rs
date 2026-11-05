//! The quick way for JavaScript and TypeScript: a lexer, a parser, comment attachment, printers and a layout that share one
//! context and allocate nothing per token, node or command.
//!
//! [`format`] either prints the file or answers [`Refused`], which is always a valid answer: whoever calls it then takes the long
//! way, which prints the file or says what is wrong with it. So nothing in here reports an error, and whatever is not certain (a
//! syntax error, syntax that is not known here, a stack that is full) is refused. What is printed is, byte for byte, what the long way prints.
//!
//! How the code is written:
//!
//! - All state is in [`Quick`], which lives from file to file: one part per module (`self.lexer.tok`), and three large buffers, the
//!   texts `self.t` (text.rs), the tree `self.n` (arena.rs) and the document `self.d` (doc.rs).
//! - A position, a node, a list, a text and a command are numbers (`i32`): offsets into these buffers. 0 and -1 stand for "none".
//! - Arrays are read with `at()` and written with `put()` ([`Words`]), which have an answer for every index. Nothing can panic.
//!   A write that falls beyond the end of its buffer, and a read beyond the end of a buffer of numbers, is a mistake of whoever was to
//!   make room: it is noted, and the file is refused.
//! - A function that can stop the work returns [`R`]; why it stopped is `Quick::why`. `REDO` means: a short cut was taken on a wrong
//!   guess, and the file is formatted again without short cuts.
//! - Whoever calls itself, directly or not, asks `self.stack()?` first.

#![allow(
    clippy::needless_late_init,
    clippy::if_same_then_else,
    reason = "each branch says for itself what holds in it"
)]

mod arena;
mod ast;
mod comments;
mod doc;
mod es5_id_table;
mod fast;
mod guest;
mod holes;
mod id_table;
mod js;
mod jsx_guess;
mod lang;
mod lexer;
mod mode;
mod options;
mod printer;
mod root;
mod scan;
mod stands;
mod text;
#[path = "../ir/width_tables.rs"]
#[expect(dead_code, reason = "one of the tables is for another flavor")]
mod width_tables;
mod words;
mod print {
    pub(crate) mod array;
    pub(crate) mod arrow;
    pub(crate) mod assignment;
    pub(crate) mod binaryish;
    pub(crate) mod call;
    pub(crate) mod class;
    pub(crate) mod comments;
    pub(crate) mod core;
    pub(crate) mod embed;
    pub(crate) mod flow;
    pub(crate) mod function;
    pub(crate) mod jest_each;
    pub(crate) mod jsx;
    pub(crate) mod literals;
    pub(crate) mod member;
    pub(crate) mod module;
    pub(crate) mod object;
    pub(crate) mod parens;
    pub(crate) mod statements;
    pub(crate) mod statics;
    pub(crate) mod template;
    pub(crate) mod ternary;
    pub(crate) mod types;
    pub(crate) mod util;
}
mod parse {
    pub(crate) mod core;
    pub(crate) mod flow;
    pub(crate) mod typescript;
}

pub use guest::{Answer, Detached, GroupId, Guest, Guests, Open, Sink};
pub use root::{
    Dialect, EndOfLine, Language, Options, QuoteProps, Refused, TrailingComma, format, stands,
};
use std::cell::Cell;

/// The work has stopped; `Quick::why` says why.
pub(crate) struct Stop;
pub(crate) type R<T> = Result<T, Stop>;

pub(crate) mod why {
    pub(crate) const NONE: i32 = 0;
    pub(crate) const SYNTAX: i32 = 1;
    pub(crate) const REDO: i32 = 2;
    pub(crate) const BUG: i32 = 4;
    pub(crate) const TOO_LARGE: i32 = 5;
    pub(crate) const STACK: i32 = 6;
    /// Something rare that is left to the long way.
    pub(crate) const RARE: i32 = 7;
    /// There is code in another language in the file.
    pub(crate) const GUEST: i32 = 8;
    /// Something was written or read beyond the end of a buffer.
    pub(crate) const LOST: i32 = 9;
}

/// What is left to the long way: `Quick::which_rare` has the number, for those who count.
pub(crate) mod rare {
    /// None of the following.
    pub(crate) const OTHER: i32 = 0;
    /// What the long way prints in another way if it breaks: an object type in the return type, for which it goes back and lays out the
    /// parameters as it will the next time; a union as the key of an indexer of Flow, which it does not indent.
    pub(crate) const BROKEN: i32 = 1;
    /// White space other than blanks, tabs and line breaks between tokens or in a comment, a control character anywhere,
    /// U+2028 or U+2029 anywhere, a "\r" without a "\n", bytes that are not UTF-8.
    pub(crate) const ODD_BYTES: i32 = 2;
    /// A `;` that is a statement or a member of its own, or that starts a line and is not the guard of what follows it (`;[a].b()`).
    pub(crate) const SEMICOLON: i32 = 3;
    /// A `,` that starts a line: an empty line behind it is looked for behind the item by one way and behind the comma by the other.
    pub(crate) const COMMA: i32 = 4;
    /// A cell of the table of `test.each` that takes several lines: the long way prints such a cell on one line where it can.
    pub(crate) const EACH_TABLE: i32 = 5;
    /// An empty line between two elements of a tuple type: the long way keeps it, and the type broken.
    pub(crate) const TUPLE: i32 = 6;
    /// A statement that starts with the name `let`: it gets parentheses, and a `;` in front of them where there are no semicolons.
    pub(crate) const LET: i32 = 7;
    /// A decorator and `export` on one line.
    pub(crate) const DECORATOR: i32 = 8;
    /// TypeScript: `a < b > c`. The long way ends no line with what looks like type arguments.
    pub(crate) const LESS_GREATER: i32 = 9;
    /// A chain of calls in the default value of a parameter of a function that is hugged: it is indented otherwise.
    pub(crate) const HUGGED_CHAIN: i32 = 10;
    /// `<T>` before something that breaks whatever its width.
    pub(crate) const ASSERTION: i32 = 11;
    /// A comment in a place where the long way is not known to print it alike: see is_comment_taken().
    pub(crate) const COMMENT: i32 = 12;
}

thread_local! {
    /// Something was written beyond the end of a buffer, or read beyond the end of a buffer of numbers, since forget_losses().
    static LOST: Cell<bool> = const { Cell::new(false) };
}

/// The writers trust that somebody has made room. Where that is not so, what they write is lost, and nothing of this run can be trusted.
#[cold]
#[inline(never)]
fn lose() {
    LOST.set(true);
}

pub(crate) fn has_lost_something() -> bool {
    LOST.get()
}

pub(crate) fn forget_losses() {
    LOST.set(false);
}

/// Reads and writes that have an answer for every index: a read beyond the end gives 0, a write there does nothing but to note that it is lost.
/// In a table (a slice) and in a buffer of bytes a read beyond the end is part of the plan: zeros stand around every text.
pub(crate) trait Words {
    type Item;
    fn at(&self, i: i32) -> i32;
    fn put(&mut self, i: i32, v: i32);
    fn fill_range(&mut self, v: i32, start: i32, end: i32);
    fn move_within(&mut self, to: i32, start: i32, end: i32);
    fn set_all(&mut self, from: &[Self::Item], at: i32);
    fn sub(&self, start: i32, end: i32) -> &[Self::Item];
}

fn clamp(i: i32, len: usize) -> usize {
    (i.max(0) as usize).min(len)
}

macro_rules! words {
    ($t:ty, $beyond:expr) => {
        impl Words for [$t] {
            type Item = $t;
            #[inline(always)]
            fn at(&self, i: i32) -> i32 {
                match self.get(i as u32 as usize) {
                    Some(&v) => v as i32,
                    None => 0,
                }
            }
            #[inline(always)]
            fn put(&mut self, i: i32, v: i32) {
                match self.get_mut(i as u32 as usize) {
                    Some(slot) => *slot = v as $t,
                    None => lose(),
                }
            }
            /// `end`: i32::MAX for "to the end".
            fn fill_range(&mut self, v: i32, start: i32, end: i32) {
                if start < 0 || (end != i32::MAX && end as i64 > self.len() as i64) {
                    lose();
                }
                let (start, end) = (clamp(start, self.len()), clamp(end, self.len()));
                if let Some(range) = self.get_mut(start..end) {
                    range.fill(v as $t);
                }
            }
            fn move_within(&mut self, to: i32, start: i32, end: i32) {
                let len = self.len();
                if to < 0
                    || start < 0
                    || end as i64 > len as i64
                    || (start < end && (to as i64 + (end - start) as i64) > len as i64)
                {
                    lose();
                }
                let (to, start, end) = (clamp(to, len), clamp(start, len), clamp(end, len));
                if start < end {
                    let count = (end - start).min(len - to);
                    self.copy_within(start..start + count, to);
                }
            }
            fn set_all(&mut self, from: &[$t], at: i32) {
                if at < 0 || at as usize + from.len() > self.len() {
                    lose();
                }
                let at = clamp(at, self.len());
                if let Some(target) = self.get_mut(at..) {
                    let count = target.len().min(from.len());
                    if let (Some(target), Some(from)) = (target.get_mut(..count), from.get(..count))
                    {
                        target.copy_from_slice(from);
                    }
                }
            }
            fn sub(&self, start: i32, end: i32) -> &[$t] {
                let (start, end) = (clamp(start, self.len()), clamp(end, self.len()));
                self.get(start..end).unwrap_or(&[])
            }
        }
        impl Words for Vec<$t> {
            type Item = $t;
            #[inline(always)]
            fn at(&self, i: i32) -> i32 {
                match self.get(i as u32 as usize) {
                    Some(&v) => v as i32,
                    None => $beyond,
                }
            }
            #[inline(always)]
            fn put(&mut self, i: i32, v: i32) {
                self.as_mut_slice().put(i, v)
            }
            fn fill_range(&mut self, v: i32, start: i32, end: i32) {
                self.as_mut_slice().fill_range(v, start, end)
            }
            fn move_within(&mut self, to: i32, start: i32, end: i32) {
                self.as_mut_slice().move_within(to, start, end)
            }
            fn set_all(&mut self, from: &[$t], at: i32) {
                self.as_mut_slice().set_all(from, at)
            }
            fn sub(&self, start: i32, end: i32) -> &[$t] {
                self.as_slice().sub(start, end)
            }
        }
    };
}
words!(u8, 0);
words!(u16, {
    lose();
    0
});
words!(i32, {
    lose();
    0
});

/// Several numbers that stand side by side, with one look at the bounds.
pub(crate) trait Numbers {
    fn several<const COUNT: usize>(&self, i: i32) -> [i32; COUNT];
    fn put_several<const COUNT: usize>(&mut self, i: i32, numbers: [i32; COUNT]);
}

impl Numbers for Vec<i32> {
    #[inline(always)]
    fn several<const COUNT: usize>(&self, i: i32) -> [i32; COUNT] {
        match self
            .get(i as u32 as usize..)
            .and_then(|s| s.first_chunk::<COUNT>())
        {
            Some(numbers) => *numbers,
            None => {
                lose();
                [0; COUNT]
            }
        }
    }
    #[inline(always)]
    fn put_several<const COUNT: usize>(&mut self, i: i32, numbers: [i32; COUNT]) {
        match self
            .get_mut(i as u32 as usize..)
            .and_then(|s| s.first_chunk_mut::<COUNT>())
        {
            Some(slots) => *slots = numbers,
            None => lose(),
        }
    }
}

/// Reads and writes of more than one byte, in little-endian order.
pub(crate) trait Bytes {
    fn i32_at(&self, p: i32) -> i32;
    fn u64_at(&self, p: i32) -> u64;
    fn u128_at(&self, p: i32) -> u128;
    fn put_u16(&mut self, p: i32, v: i32);
    fn put_u64(&mut self, p: i32, v: u64);
    fn put_u128(&mut self, p: i32, v: u128);
    fn index_of(&self, byte: i32, from: i32) -> i32;
    /// The last place at or before `from`.
    fn last_index_of(&self, byte: i32, from: i32) -> i32;
}

impl Bytes for [u8] {
    #[inline(always)]
    fn i32_at(&self, p: i32) -> i32 {
        match self
            .get(p as u32 as usize..)
            .and_then(|s| s.first_chunk::<4>())
        {
            Some(b) => i32::from_le_bytes(*b),
            None => 0,
        }
    }
    #[inline(always)]
    fn u64_at(&self, p: i32) -> u64 {
        match self
            .get(p as u32 as usize..)
            .and_then(|s| s.first_chunk::<8>())
        {
            Some(b) => u64::from_le_bytes(*b),
            None => 0,
        }
    }
    #[inline(always)]
    fn u128_at(&self, p: i32) -> u128 {
        match self
            .get(p as u32 as usize..)
            .and_then(|s| s.first_chunk::<16>())
        {
            Some(b) => u128::from_le_bytes(*b),
            None => 0,
        }
    }
    #[inline(always)]
    fn put_u128(&mut self, p: i32, v: u128) {
        match self
            .get_mut(p as u32 as usize..)
            .and_then(|s| s.first_chunk_mut::<16>())
        {
            Some(b) => *b = v.to_le_bytes(),
            None => lose(),
        }
    }
    #[inline(always)]
    fn put_u16(&mut self, p: i32, v: i32) {
        match self
            .get_mut(p as u32 as usize..)
            .and_then(|s| s.first_chunk_mut::<2>())
        {
            Some(b) => *b = (v as u16).to_le_bytes(),
            None => lose(),
        }
    }
    #[inline(always)]
    fn put_u64(&mut self, p: i32, v: u64) {
        match self
            .get_mut(p as u32 as usize..)
            .and_then(|s| s.first_chunk_mut::<8>())
        {
            Some(b) => *b = v.to_le_bytes(),
            None => lose(),
        }
    }
    fn index_of(&self, byte: i32, from: i32) -> i32 {
        let from = clamp(from, self.len());
        match self
            .get(from..)
            .and_then(|s| bun_core::strings::index_of_char_usize(s, byte as u8))
        {
            Some(i) => (from + i) as i32,
            None => -1,
        }
    }
    fn last_index_of(&self, byte: i32, from: i32) -> i32 {
        if from < 0 {
            return -1;
        }
        let end = clamp(from.saturating_add(1), self.len());
        match self
            .get(..end)
            .and_then(|s| bun_core::strings::last_index_of_char(s, byte as u8))
        {
            Some(i) => i as i32,
            None => -1,
        }
    }
}
impl Bytes for Vec<u8> {
    #[inline(always)]
    fn i32_at(&self, p: i32) -> i32 {
        self.as_slice().i32_at(p)
    }
    #[inline(always)]
    fn u64_at(&self, p: i32) -> u64 {
        self.as_slice().u64_at(p)
    }
    #[inline(always)]
    fn u128_at(&self, p: i32) -> u128 {
        self.as_slice().u128_at(p)
    }
    #[inline(always)]
    fn put_u128(&mut self, p: i32, v: u128) {
        self.as_mut_slice().put_u128(p, v)
    }
    #[inline(always)]
    fn put_u16(&mut self, p: i32, v: i32) {
        self.as_mut_slice().put_u16(p, v)
    }
    #[inline(always)]
    fn put_u64(&mut self, p: i32, v: u64) {
        self.as_mut_slice().put_u64(p, v)
    }
    fn index_of(&self, byte: i32, from: i32) -> i32 {
        self.as_slice().index_of(byte, from)
    }
    fn last_index_of(&self, byte: i32, from: i32) -> i32 {
        self.as_slice().last_index_of(byte, from)
    }
}

const ONES: u64 = 0x0101_0101_0101_0101;
const TOP_BITS: u64 = 0x8080_8080_8080_8080;

/// Eight bytes at a time: the top bit of the first byte of `v` that is `byte` is set, none below it; what is set above it says nothing.
#[inline(always)]
pub(crate) fn where_byte_is(v: u64, byte: u8) -> u64 {
    let x = v ^ ONES.wrapping_mul(byte as u64);
    x.wrapping_sub(ONES) & !x & TOP_BITS
}

/// The same for the first byte that is not printable ASCII: below a blank, 127, or beyond.
#[inline(always)]
pub(crate) fn where_not_printable(v: u64) -> u64 {
    (v | v.wrapping_sub(ONES.wrapping_mul(32)) | v.wrapping_add(ONES)) & TOP_BITS
}

/// The same for the first byte that is no letter of ASCII, no digit, no `_` and no `$`.
/// (x + (0x80 - low)) & !(x + (0x7f - high)) has the top bit set for low <= x <= high, for x below 0x80, without carries.
#[inline(always)]
pub(crate) fn where_name_ends(v: u64) -> u64 {
    let x = v & !TOP_BITS;
    let lower = x | ONES.wrapping_mul(0x20);
    let is_part = (lower.wrapping_add(ONES.wrapping_mul(0x1f))
        & !lower.wrapping_add(ONES.wrapping_mul(0x05)))
        | (x.wrapping_add(ONES.wrapping_mul(0x50)) & !x.wrapping_add(ONES.wrapping_mul(0x46)))
        | !(x ^ ONES.wrapping_mul(b'_' as u64)).wrapping_add(ONES.wrapping_mul(0x7f))
        | !(x ^ ONES.wrapping_mul(b'$' as u64)).wrapping_add(ONES.wrapping_mul(0x7f));
    !(is_part & !v) & TOP_BITS
}

/// How many bytes stand before the first one that is marked.
#[inline(always)]
pub(crate) fn bytes_before(marks: u64) -> i32 {
    (marks.trailing_zeros() >> 3) as i32
}

pub(crate) fn zeros<T: Default + Clone>(length: i32) -> Vec<T> {
    vec![T::default(); length.max(0) as usize]
}

/// A quotient without its fraction; 0 for a divisor of 0.
pub(crate) fn div(a: i32, b: i32) -> i32 {
    if b == 0 { 0 } else { a.wrapping_div(b) }
}

/// The remainder; 0 for a divisor of 0.
pub(crate) fn rem(a: i32, b: i32) -> i32 {
    if b == 0 { 0 } else { a.wrapping_rem(b) }
}

static FIXED_TEXTS: [u8; 1836] = *b"\x00                                                                        ifindoofasvarletfornewtrygetsetthistruenullelseenumcasevoidwithfrommetaconstclasscatchfalsebreakwhilethrowsuperasyncawaityieldusingdeferreturnimportexporttypeoftargetswitchstaticsourcedeletemoduledefaultextendsfinallyfunctioncontinuedebuggeraccessorinstanceof... => = async awaitbreakcase catch classcontinuedebuggerdefault:do elseexport export default extends  finally forfor (for (;;) from from functionget set if (importimport module new nullreturnstatic accessor superswitch (thisthrowtry voidwhile (with (yieldyield* await of  in  as $implicitlet  = * as varletconstusingawait using with  assert defer source .defer.sourceexportexport default{\" \"}{' '} />**=<<=>>=>>>=&&=||=??====!==>>>instanceoftypeofvoiddeletethrow |  & =>  => abstract declare override readonly readonlypublic protected private interfacetype  typetypeof  typeofenum const in out infer keyof unique asserts  is  extends extends extendsimplementsimplements mixinsmixins  satisfies namespace export = export as namespace requireanybigintbooleanintrinsicnevernumberobjectstringsymbolundefinedunknownmixedemptysuper  =>%checkscomponenthookmatch (opaque type proto writeonly ]: declare module.exportsrecordof renders renders? renders* implies nullabstractaccessoranyasassertsasyncbigintbooleandeclareenumgetglobalimplementsinferinterfaceintrinsiciskeyofmodulenamespacenevernumberobjectoutoverrideprivateprotectedpublicreadonlyrequiresatisfiessetstaticstringsymboltypeundefineduniqueunknownboolcheckscomponentemptyexportshookimpliesmatchmixedmixinsofopaqueprotorecordrenderswriteonly                                                                                                                                @prettier-placeholder--idPRETTIER_HTML_PLACEHOLDER_                                \x09";

/// All that lives from file to file.
pub struct Quick {
    /// The texts: the fixed ones, the file, and what is made while it is formatted.
    pub(crate) t: Vec<u8>,
    /// The tree.
    pub(crate) n: Vec<i32>,
    /// The document.
    pub(crate) d: Vec<i32>,
    /// Why the work stopped.
    pub(crate) why: Cell<i32>,
    /// One of [`rare`].
    pub(crate) which_rare: Cell<i32>,
    stack_check: bun_core::StackCheck,
    pub(crate) dialect: Dialect,
    had_bom: bool,
    redone: i32,
    /// Where the syntax error is, from the start of the text.
    pub(crate) failed_at: Cell<i32>,
    #[cfg(feature = "stages")]
    pub(crate) no_guests: bool,
    #[cfg(feature = "stages")]
    stages: [u64; 3],
    #[cfg(feature = "stages")]
    keep_stages: bool,
    #[cfg(feature = "stages")]
    kept: Vec<Vec<i32>>,
    pub(crate) text: text::Text,
    pub(crate) arena: arena::Arena,
    pub(crate) holes: holes::Holes,
    pub(crate) doc: doc::Doc,
    pub(crate) lang: lang::Lang,
    pub(crate) guest: guest::State,
    pub(crate) options: options::Options,
    pub(crate) printer: printer::Printer,
    pub(crate) mode: mode::Mode,
    pub(crate) lexer: lexer::Lexer,
    pub(crate) comments: comments::Comments,
    pub(crate) fast: fast::Fast,
    pub(crate) parse_flow: parse::flow::ParseFlow,
    pub(crate) parse_typescript: parse::typescript::ParseTypescript,
    pub(crate) parse: parse::core::Parse,
    pub(crate) print_embed: print::embed::PrintEmbed,
    pub(crate) print_jest_each: print::jest_each::PrintJestEach,
    pub(crate) print_binaryish: print::binaryish::PrintBinaryish,
    pub(crate) print_member: print::member::PrintMember,
    pub(crate) print_ternary: print::ternary::PrintTernary,
    pub(crate) print_object: print::object::PrintObject,
    pub(crate) print_types: print::types::PrintTypes,
    pub(crate) print_call: print::call::PrintCall,
    pub(crate) print_jsx: print::jsx::PrintJsx,
    pub(crate) print: print::core::Print,
    pub(crate) stands: stands::Stands,
}

impl Default for Quick {
    fn default() -> Self {
        Self::new()
    }
}

impl Quick {
    pub fn new() -> Self {
        let mut t = zeros::<u8>(1 << 17);
        t.set_all(&FIXED_TEXTS, 0);
        Self {
            t,
            n: zeros(1 << 16),
            d: zeros(1 << 16),
            why: Cell::new(why::NONE),
            which_rare: Cell::new(rare::OTHER),
            stack_check: bun_core::StackCheck::default(),
            dialect: Dialect::of_name(Language::JavaScript, b""),
            had_bom: false,
            redone: 0,
            failed_at: Cell::new(0),
            #[cfg(feature = "stages")]
            no_guests: false,
            #[cfg(feature = "stages")]
            stages: [0; 3],
            #[cfg(feature = "stages")]
            keep_stages: false,
            #[cfg(feature = "stages")]
            kept: Vec::new(),
            text: text::Text::new(),
            arena: arena::Arena::new(),
            holes: holes::Holes::new(),
            doc: doc::Doc::new(),
            lang: lang::Lang::new(),
            guest: guest::State::new(),
            options: options::Options::new(),
            printer: printer::Printer::new(),
            mode: mode::Mode::new(),
            lexer: lexer::Lexer::new(),
            comments: comments::Comments::new(),
            fast: fast::Fast::new(),
            parse_flow: parse::flow::ParseFlow::new(),
            parse_typescript: parse::typescript::ParseTypescript::new(),
            parse: parse::core::Parse::new(),
            print_embed: print::embed::PrintEmbed::new(),
            print_jest_each: print::jest_each::PrintJestEach::new(),
            print_binaryish: print::binaryish::PrintBinaryish::new(),
            print_member: print::member::PrintMember::new(),
            print_ternary: print::ternary::PrintTernary::new(),
            print_object: print::object::PrintObject::new(),
            print_types: print::types::PrintTypes::new(),
            print_call: print::call::PrintCall::new(),
            print_jsx: print::jsx::PrintJsx::new(),
            print: print::core::Print::new(),
            stands: stands::Stands::new(),
        }
    }

    #[cold]
    pub(crate) fn stop(&self, why: i32) -> Stop {
        self.why.set(why);
        Stop
    }

    /// `which` is one of [`rare`].
    #[cold]
    pub(crate) fn rare(&self, which: i32) -> Stop {
        self.which_rare.set(which);
        self.failed_at
            .set(self.lexer.tok_start - self.text.src_start);
        self.stop(why::RARE)
    }

    /// Where the letters of ASCII, digits, `_` and `$` from `p` on end.
    #[inline(always)]
    pub(crate) fn name_end(&self, mut p: i32) -> i32 {
        loop {
            let ends = where_name_ends(self.t.u64_at(p));
            if ends != 0 {
                return p + bytes_before(ends);
            }
            p += 8;
        }
    }

    /// Nothing of what a stage has left behind is read if part of it is lost.
    pub(crate) fn nothing_lost(&self) -> R<()> {
        if has_lost_something() {
            Err(self.stop(why::LOST))
        } else {
            Ok(())
        }
    }

    /// Whoever calls itself, directly or not, asks first whether there is room for that.
    #[inline(always)]
    pub(crate) fn stack(&self) -> R<()> {
        if self.stack_check.is_safe_to_recurse() {
            Ok(())
        } else {
            Err(self.stop(why::STACK))
        }
    }
}
