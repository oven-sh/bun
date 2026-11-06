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
//! - No buffer grows beyond [`LARGEST`]. Whoever finds no room ends the run ([`Quick::end_run`]), so that no length and no position has to be looked at where it is
//!   packed into a part of a word.
//! - A function that can stop the work returns [`R`]; why it stopped is `Quick::why`. `REDO` means: a short cut was taken on a wrong
//!   guess, and the file is formatted again without short cuts.
//! - Whoever calls itself, directly or not, asks `self.stack()?` first.

#![forbid(unsafe_code)]
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
#[cfg(test)]
mod tests;
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
pub use jsx_guess::is_probably_jsx;
pub use root::{
    Dialect, EndOfLine, Expression, Language, Options, QuoteProps, Refused, TrailingComma, Wrap,
    format, format_expression, stands,
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
    /// parameters as it will the next time; a union as the key of an indexer of Flow, which it does not indent; `boolean | null` and the
    /// like in Flow, which it does not break; a union that a conditional type checks, before which it leaves no line empty.
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
    /// The name `let`: at the start of a statement it gets parentheses, and a `;` in front of them where there are no semicolons.
    /// A statement that is an `as` or a `satisfies` expression, at the start of which more names get them.
    pub(crate) const LET: i32 = 7;
    /// A decorator and `export` on one line.
    pub(crate) const DECORATOR: i32 = 8;
    /// TypeScript: `a < b > c`. The long way ends no line with what looks like type arguments.
    pub(crate) const LESS_GREATER: i32 = 9;
    /// A chain of calls in the default value of a parameter of a function that is hugged: it is indented otherwise.
    /// A call there that hugs a function itself, an element of JSX there.
    pub(crate) const HUGGED_CHAIN: i32 = 10;
    /// `<T>` before something that breaks whatever its width, or with a type that does; `<const>`, which the long way never breaks.
    pub(crate) const ASSERTION: i32 = 11;
    /// A comment in a place where the long way is not known to print it alike: see is_comment_taken().
    pub(crate) const COMMENT: i32 = 12;
    /// Flow: a type guard as the return type of an arrow function, which gets no parentheses though there may be a function type in it;
    /// a `declare module` with nothing in it, whose braces stand on two lines; one parameter and `?{..}` as the return type, of which
    /// the long way breaks the parameter; `<*>` and its like, which the long way does not break, in a type on the left of a `=`.
    pub(crate) const FLOW: i32 = 13;
    /// `tabWidth: 1` and a conditional as a branch of a conditional: the long way moves it by one column where Prettier moves it by two.
    pub(crate) const TAB_WIDTH: i32 = 14;
    /// Where the long way is not Prettier's way, and nobody has said that it should not be: a template with a private name as its tag,
    /// a member with the name `export` in a class of Flow, `A<B<>>` and `(a: B<>)` in Flow, import attributes on several lines with
    /// `objectWrap: "collapse"`, a test call with `?.` in its callee, `boolean | null` in Flow where the group around it is not its own.
    pub(crate) const UNLIKE_PRETTIER: i32 = 15;
}

thread_local! {
    /// Something was written beyond the end of a buffer, or read beyond the end of a buffer of numbers, in the run at hand: see OwnLosses.
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

/// The mark belongs to the thread, and a guest of one run can start another one on it (code in Markdown in a template). For the time that this lives
/// the mark is that of a new run; then it is again what it was.
pub(crate) struct OwnLosses {
    of_the_run_around: bool,
}

impl OwnLosses {
    pub(crate) fn start() -> Self {
        Self {
            of_the_run_around: LOST.replace(false),
        }
    }
}

impl Drop for OwnLosses {
    fn drop(&mut self) {
        LOST.set(self.of_the_run_around);
    }
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
            .get(i as u32 as usize..i as u32 as usize + COUNT)
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
            .get_mut(i as u32 as usize..i as u32 as usize + COUNT)
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
            .get(p as u32 as usize..p as u32 as usize + 4)
            .and_then(|s| s.first_chunk::<4>())
        {
            Some(b) => i32::from_le_bytes(*b),
            None => 0,
        }
    }
    #[inline(always)]
    fn u64_at(&self, p: i32) -> u64 {
        match self
            .get(p as u32 as usize..p as u32 as usize + 8)
            .and_then(|s| s.first_chunk::<8>())
        {
            Some(b) => u64::from_le_bytes(*b),
            None => 0,
        }
    }
    #[inline(always)]
    fn u128_at(&self, p: i32) -> u128 {
        match self
            .get(p as u32 as usize..p as u32 as usize + 16)
            .and_then(|s| s.first_chunk::<16>())
        {
            Some(b) => u128::from_le_bytes(*b),
            None => 0,
        }
    }
    #[inline(always)]
    fn put_u128(&mut self, p: i32, v: u128) {
        match self
            .get_mut(p as u32 as usize..p as u32 as usize + 16)
            .and_then(|s| s.first_chunk_mut::<16>())
        {
            Some(b) => *b = v.to_le_bytes(),
            None => lose(),
        }
    }
    #[inline(always)]
    fn put_u16(&mut self, p: i32, v: i32) {
        match self
            .get_mut(p as u32 as usize..p as u32 as usize + 2)
            .and_then(|s| s.first_chunk_mut::<2>())
        {
            Some(b) => *b = (v as u16).to_le_bytes(),
            None => lose(),
        }
    }
    #[inline(always)]
    fn put_u64(&mut self, p: i32, v: u64) {
        match self
            .get_mut(p as u32 as usize..p as u32 as usize + 8)
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

/// Copies `COUNT` bytes from `from[s..]` to `to[o..]`, if both have as many. Whoever calls this has room for all of them, and wants some.
#[inline(always)]
pub(crate) fn copy_block<const COUNT: usize>(to: &mut [u8], o: i32, from: &[u8], s: i32) -> bool {
    let (o, s) = (o as u32 as usize, s as u32 as usize);
    match (
        to.get_mut(o..o + COUNT)
            .and_then(|block| block.first_chunk_mut::<COUNT>()),
        from.get(s..s + COUNT)
            .and_then(|block| block.first_chunk::<COUNT>()),
    ) {
        (Some(to), Some(from)) => {
            *to = *from;
            true
        }
        _ => false,
    }
}

const ONES: u64 = 0x0101_0101_0101_0101;

const fn all(byte: u8) -> u128 {
    u128::from_le_bytes([byte; 16])
}

/// Sixteen bytes at a time: the top bit of the first byte of `v` that is `byte` is set, none below it; what is set above it says nothing.
#[inline(always)]
pub(crate) fn where_byte_is(v: u128, byte: u8) -> u128 {
    let x = v ^ all(byte);
    x.wrapping_sub(all(1)) & !x & all(0x80)
}

/// The same for the first byte that is not printable ASCII: below a blank, 127, or beyond.
#[inline(always)]
pub(crate) fn where_not_printable(v: u128) -> u128 {
    (v | v.wrapping_sub(all(32)) | v.wrapping_add(all(1))) & all(0x80)
}

/// The same for the first byte that is no letter of ASCII, and nothing is set above it that is one.
/// (x + (0x80 - low)) & !(x + (0x7f - high)) has the top bit set for low <= x <= high, for x below 0x80, without carries.
#[inline(always)]
pub(crate) fn where_letters_end(v: u128) -> u128 {
    let lower = (v & all(0x7f)) | all(0x20);
    !(lower.wrapping_add(all(0x1f)) & !lower.wrapping_add(all(0x05)) & !v) & all(0x80)
}

/// A digit, `_` or `$`.
#[inline(always)]
pub(crate) fn is_digit_or_sign_of_names(c: u8) -> bool {
    c.is_ascii_digit() || c == b'_' || c == b'$'
}

/// How many bytes stand before the first one that is marked.
#[inline(always)]
pub(crate) fn bytes_before(marks: u128) -> i32 {
    (marks.trailing_zeros() >> 3) as i32
}

pub(crate) fn zeros<T: Default + Clone>(length: i32) -> Vec<T> {
    vec![T::default(); length.max(0) as usize]
}

/// No buffer has more items than this: bytes of text, words of the tree or of the document, entries of a stack. So a position or a length takes 26 bits, which is what
/// the narrowest place has that packs one with something else (`op::Nop` and `op::IndentIfBreakOpen` of doc.rs), and sums of a few of them are far from the largest number.
/// (The tests of this crate come to the limits with small texts.)
pub(crate) const LARGEST: i32 = if cfg!(test) { 1 << 19 } else { 1 << 26 };

/// See [`Quick::waste`]. (Real code comes to a fraction of a unit for each byte.)
const WASTE_FOR_A_BYTE: i32 = 8;
const WASTE_FOR_A_TEXT: i32 = 1 << 16;

/// How long a buffer of `length` items becomes that has to hold `need` of them, if it may. It becomes much larger: memory that is not written to costs nothing.
pub(crate) fn larger(length: i32, need: i32) -> Option<i32> {
    if !(0..=LARGEST).contains(&need) {
        return None;
    }
    let mut length = length.clamp(16, LARGEST);
    while length < need {
        length = if length < (1 << 22) {
            length * 8
        } else {
            length * 2
        };
    }
    Some(length.min(LARGEST))
}

/// Makes room for `need` items and `spare` more, and keeps the first `used`. False if that is more than a buffer may hold: it then stays as it is.
/// Whatever is written at a position grows this way. A table that is laid out anew when it grows (the comments of the nodes, the docs that are kept, the trials that
/// have failed) asks for itself whether it may.
#[cold]
#[inline(never)]
pub(crate) fn grow<T: Default + Copy>(
    buffer: &mut Vec<T>,
    used: i32,
    need: i32,
    spare: i32,
) -> bool {
    let Some(length) = larger(buffer.len() as i32 - spare, need) else {
        return false;
    };
    let mut next = zeros::<T>(length + spare);
    let used = clamp(used, buffer.len().min(next.len()));
    if let (Some(to), Some(from)) = (next.get_mut(..used), buffer.get(..used)) {
        to.copy_from_slice(from);
    }
    *buffer = next;
    true
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
    /// Not 0: why the run is over, see end_run().
    ended: i32,
    /// How much work of this run has been for nothing, and how much may be: see waste().
    pub(crate) wasted: i32,
    pub(crate) allowance: i32,
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
    pub(crate) fast_before_code: fast::Fast,
    pub(crate) parse_flow: parse::flow::ParseFlow,
    pub(crate) parse_typescript: parse::typescript::ParseTypescript,
    pub(crate) parse: parse::core::Parse,
    pub(crate) parse_stacks: parse::core::ParseStacks,
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
    pub(crate) host: js::Host,
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
            n: zeros((1 << 16) + arena::SPARE),
            d: zeros(1 << 16),
            why: Cell::new(why::NONE),
            which_rare: Cell::new(rare::OTHER),
            stack_check: bun_core::StackCheck::default(),
            ended: why::NONE,
            wasted: 0,
            allowance: 0,
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
            fast_before_code: fast::Fast::new(),
            parse_flow: parse::flow::ParseFlow::new(),
            parse_typescript: parse::typescript::ParseTypescript::new(),
            parse: parse::core::Parse::new(),
            parse_stacks: parse::core::ParseStacks::new(),
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
            host: js::Host::new(),
        }
    }

    /// The parsers, the reader and the printers set things for the time of a call and put them back behind it. A run that stops half way
    /// does not get there, and what it has set would hold for the next text. (What the texts, the tree, the document, the comments and the
    /// layout keep is set anew at the start of a run.)
    #[cold]
    pub(crate) fn forget_run(&mut self) {
        self.holes = holes::Holes::new();
        self.fast = fast::Fast::new();
        self.parse_flow = parse::flow::ParseFlow::new();
        self.parse_typescript = parse::typescript::ParseTypescript::new();
        self.parse = parse::core::Parse::new();
        self.print_embed = print::embed::PrintEmbed::new();
        self.print_jest_each = print::jest_each::PrintJestEach::new();
        self.print_binaryish = print::binaryish::PrintBinaryish::new();
        self.print_member = print::member::PrintMember::new();
        self.print_ternary = print::ternary::PrintTernary::new();
        self.print_object = print::object::PrintObject::new();
        self.print_types = print::types::PrintTypes::new();
        self.print_call = print::call::PrintCall::new();
        self.print_jsx = print::jsx::PrintJsx::new();
        self.print = print::core::Print::new();
        self.stands = stands::Stands::new();
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
            let ends = where_letters_end(self.t.u128_at(p));
            if ends == 0 {
                p += 16;
                continue;
            }
            // most names are letters and no more
            p += bytes_before(ends);
            if !is_digit_or_sign_of_names(self.t.at(p) as u8) {
                return p;
            }
            p += 1;
        }
    }

    /// Where the blanks from `p` on end.
    #[inline(always)]
    pub(crate) fn blanks_end(&self, mut p: i32) -> i32 {
        loop {
            let others = self.t.u64_at(p) ^ ONES.wrapping_mul(32);
            if others != 0 {
                return p + (others.trailing_zeros() >> 3) as i32;
            }
            p += 8;
        }
    }

    /// Where the blanks that end at `p` start.
    #[inline(always)]
    pub(crate) fn blanks_start(&self, mut p: i32) -> i32 {
        loop {
            let others = self.t.u64_at(p - 8) ^ ONES.wrapping_mul(32);
            if others != 0 {
                return p - (others.leading_zeros() >> 3) as i32;
            }
            p -= 8;
        }
    }

    /// Where the blanks and ends of lines from `p` on end.
    #[inline(always)]
    pub(crate) fn blank_lines_end(&self, mut p: i32) -> i32 {
        loop {
            p = self.blanks_end(p);
            if self.t.at(p) != 10 {
                return p;
            }
            p += 1;
        }
    }

    /// A run starts.
    pub(crate) fn start_run(&mut self) {
        self.why.set(why::NONE);
        self.which_rare.set(rare::OTHER);
        self.ended = why::NONE;
        self.stack_check = bun_core::StackCheck::init();
    }

    /// A run is over. What a very large text has needed is not kept for the next one: there is a scratch for each thread, and whoever goes the long way
    /// with such a text needs memory too.
    pub(crate) fn give_back_what_is_large(&mut self) {
        let lengths = self.t.len()
            | self.n.len()
            | self.d.len()
            | self.printer.out.len()
            | self.lexer.c.len();
        // (one of them has half of what it may have, or more)
        if lengths >= (LARGEST / 2) as usize {
            self.give_back();
        }
    }

    #[cold]
    #[inline(never)]
    fn give_back(&mut self) {
        let guests = self.lend_guests(None);
        let redone = self.redone;
        let (why, which_rare, failed_at) =
            (self.why.get(), self.which_rare.get(), self.failed_at.get());
        let fresh = Self::new();
        #[cfg(feature = "stages")]
        let fresh = Self {
            no_guests: self.no_guests,
            stages: self.stages,
            keep_stages: self.keep_stages,
            kept: std::mem::take(&mut self.kept),
            ..fresh
        };
        *self = fresh;
        self.lend_guests(guests);
        self.redone = redone;
        self.why.set(why);
        self.which_rare.set(which_rare);
        self.failed_at.set(failed_at);
    }

    /// Ends the run from a place that has no way to say so to whoever called it (a writer that finds no room). What is written from here on may be lost. It is not
    /// for long: the next one who asks for room on the stack is told that there is none, and nothing of what a stage leaves behind is read.
    #[cold]
    #[inline(never)]
    pub(crate) fn end_run(&mut self, why: i32) {
        self.ended = why;
        self.stack_check = bun_core::StackCheck::exhausted();
    }

    /// A text of `length` bytes is about to be formatted.
    pub(crate) fn allow_waste_for(&mut self, length: i32) {
        self.wasted = 0;
        self.allowance = length
            .saturating_mul(WASTE_FOR_A_BYTE)
            .saturating_add(WASTE_FOR_A_TEXT);
    }

    /// Something has been tried and given up: so many bytes will be read again, so many words of the tree or of the document are dropped. One trial can hold another,
    /// so there is no saying how often a byte is read at worst. What is known is the sum, which is taken where something fails, and a text whose trials cost many
    /// times what the text itself costs is left to the long way.
    pub(crate) fn waste(&mut self, amount: i32) -> R<()> {
        self.wasted = self.wasted.saturating_add(amount);
        if self.wasted > self.allowance {
            self.end_run(why::TOO_LARGE);
            return Err(self.stop(why::TOO_LARGE));
        }
        Ok(())
    }

    /// grow() for a buffer that is kept whole. Whoever calls this writes without a look at what has become of it.
    #[cold]
    #[inline(never)]
    pub(crate) fn make_room<T: Default + Copy>(
        &mut self,
        buffer: fn(&mut Quick) -> &mut Vec<T>,
        need: i32,
    ) {
        let buffer = buffer(self);
        if !grow(buffer, buffer.len() as i32, need, 0) {
            self.end_run(why::TOO_LARGE);
        }
    }

    /// Nothing of what a stage has left behind is read if part of it is lost.
    pub(crate) fn nothing_lost(&self) -> R<()> {
        if self.ended != why::NONE {
            Err(self.stop(self.ended))
        } else if has_lost_something() {
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
            Err(self.no_stack())
        }
    }

    #[cold]
    fn no_stack(&self) -> Stop {
        self.stop(if self.ended != why::NONE {
            self.ended
        } else {
            why::STACK
        })
    }
}
