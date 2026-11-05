//! The quick way for JavaScript and TypeScript.

mod arena;
mod ast;
mod comments;
mod doc;
mod es5_id_table;
mod fast;
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
mod text;
mod width_table;
mod words;
mod print {
    pub(crate) mod angular;
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
    pub(crate) mod ternary_experimental;
    pub(crate) mod types;
    pub(crate) mod util;
}
mod parse {
    pub(crate) mod core;
    pub(crate) mod flow;
    pub(crate) mod pipeline;
    pub(crate) mod typescript;
}

pub use root::{EndOfLine, Language, Options, QuoteProps, Refused, TrailingComma};

/// The work has stopped; `Quick::why` says why.
pub(crate) struct Stop;
pub(crate) type R<T> = Result<T, Stop>;

pub(crate) mod why {
    pub(crate) const NONE: i32 = 0;
    pub(crate) const SYNTAX: i32 = 1;
    pub(crate) const REDO: i32 = 2;
    pub(crate) const UNCHANGED: i32 = 3;
    pub(crate) const BUG: i32 = 4;
    pub(crate) const TOO_LARGE: i32 = 5;
    pub(crate) const STACK: i32 = 6;
    /// Something rare that is left to the long way.
    pub(crate) const RARE: i32 = 7;
}

/// Reads and writes that have an answer for every index: a read beyond the end gives 0, a write there does nothing.
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
    ($t:ty) => {
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
                if let Some(slot) = self.get_mut(i as u32 as usize) {
                    *slot = v as $t;
                }
            }
            fn fill_range(&mut self, v: i32, start: i32, end: i32) {
                let (start, end) = (clamp(start, self.len()), clamp(end, self.len()));
                if let Some(range) = self.get_mut(start..end) {
                    range.fill(v as $t);
                }
            }
            fn move_within(&mut self, to: i32, start: i32, end: i32) {
                let len = self.len();
                let (to, start, end) = (clamp(to, len), clamp(start, len), clamp(end, len));
                if start < end {
                    let count = (end - start).min(len - to);
                    self.copy_within(start..start + count, to);
                }
            }
            fn set_all(&mut self, from: &[$t], at: i32) {
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
                self.as_slice().at(i)
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
words!(u8);
words!(u16);
words!(i32);

/// Reads and writes of more than one byte, in little-endian order.
pub(crate) trait Bytes {
    fn u16_at(&self, p: i32) -> i32;
    fn i32_at(&self, p: i32) -> i32;
    fn u64_at(&self, p: i32) -> u64;
    fn put_u16(&mut self, p: i32, v: i32);
    fn put_u64(&mut self, p: i32, v: u64);
    /// The i-th pair of bytes.
    fn at16(&self, i: i32) -> i32;
    /// The i-th group of four bytes.
    fn at32(&self, i: i32) -> i32;
    fn index_of(&self, byte: i32, from: i32) -> i32;
    /// The last place at or before `from`.
    fn last_index_of(&self, byte: i32, from: i32) -> i32;
}

impl Bytes for [u8] {
    #[inline(always)]
    fn u16_at(&self, p: i32) -> i32 {
        match self
            .get(p as u32 as usize..)
            .and_then(|s| s.first_chunk::<2>())
        {
            Some(b) => u16::from_le_bytes(*b) as i32,
            None => 0,
        }
    }
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
    fn put_u16(&mut self, p: i32, v: i32) {
        if let Some(b) = self
            .get_mut(p as u32 as usize..)
            .and_then(|s| s.first_chunk_mut::<2>())
        {
            *b = (v as u16).to_le_bytes();
        }
    }
    #[inline(always)]
    fn put_u64(&mut self, p: i32, v: u64) {
        if let Some(b) = self
            .get_mut(p as u32 as usize..)
            .and_then(|s| s.first_chunk_mut::<8>())
        {
            *b = v.to_le_bytes();
        }
    }
    #[inline(always)]
    fn at16(&self, i: i32) -> i32 {
        self.u16_at(i.wrapping_mul(2))
    }
    #[inline(always)]
    fn at32(&self, i: i32) -> i32 {
        self.i32_at(i.wrapping_mul(4))
    }
    fn index_of(&self, byte: i32, from: i32) -> i32 {
        let from = clamp(from, self.len());
        match self
            .get(from..)
            .and_then(|s| s.iter().position(|&b| b as i32 == byte))
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
            .and_then(|s| s.iter().rposition(|&b| b as i32 == byte))
        {
            Some(i) => i as i32,
            None => -1,
        }
    }
}
impl Bytes for Vec<u8> {
    #[inline(always)]
    fn u16_at(&self, p: i32) -> i32 {
        self.as_slice().u16_at(p)
    }
    #[inline(always)]
    fn i32_at(&self, p: i32) -> i32 {
        self.as_slice().i32_at(p)
    }
    #[inline(always)]
    fn u64_at(&self, p: i32) -> u64 {
        self.as_slice().u64_at(p)
    }
    #[inline(always)]
    fn put_u16(&mut self, p: i32, v: i32) {
        self.as_mut_slice().put_u16(p, v)
    }
    #[inline(always)]
    fn put_u64(&mut self, p: i32, v: u64) {
        self.as_mut_slice().put_u64(p, v)
    }
    #[inline(always)]
    fn at16(&self, i: i32) -> i32 {
        self.as_slice().at16(i)
    }
    #[inline(always)]
    fn at32(&self, i: i32) -> i32 {
        self.as_slice().at32(i)
    }
    fn index_of(&self, byte: i32, from: i32) -> i32 {
        self.as_slice().index_of(byte, from)
    }
    fn last_index_of(&self, byte: i32, from: i32) -> i32 {
        self.as_slice().last_index_of(byte, from)
    }
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
    pub(crate) why: i32,
    /// Where the syntax error is, from the start of the text.
    pub(crate) failed_at: i32,
    had_bom: bool,
    redone: i32,
    /// The name of the file ends in .cjs or .cts.
    name_is_common_js: bool,
    /// 1: the name of the file says that `<a>` is an element; 0: that it is not; -1: it says nothing.
    name_says_jsx: i32,
    #[cfg(feature = "stages")]
    stages: [u64; 4],
    #[cfg(feature = "stages")]
    keep_stages: bool,
    #[cfg(feature = "stages")]
    kept: Vec<Vec<i32>>,
    pub(crate) text: text::Text,
    pub(crate) arena: arena::Arena,
    pub(crate) holes: holes::Holes,
    pub(crate) doc: doc::Doc,
    pub(crate) lang: lang::Lang,
    pub(crate) options: options::Options,
    pub(crate) printer: printer::Printer,
    pub(crate) mode: mode::Mode,
    pub(crate) lexer: lexer::Lexer,
    pub(crate) comments: comments::Comments,
    pub(crate) fast: fast::Fast,
    pub(crate) parse_pipeline: parse::pipeline::ParsePipeline,
    pub(crate) parse_flow: parse::flow::ParseFlow,
    pub(crate) parse_typescript: parse::typescript::ParseTypescript,
    pub(crate) parse: parse::core::Parse,
    pub(crate) print_embed: print::embed::PrintEmbed,
    pub(crate) print_jest_each: print::jest_each::PrintJestEach,
    pub(crate) print_binaryish: print::binaryish::PrintBinaryish,
    pub(crate) print_object: print::object::PrintObject,
    pub(crate) print_types: print::types::PrintTypes,
    pub(crate) print_call: print::call::PrintCall,
    pub(crate) print_jsx: print::jsx::PrintJsx,
    pub(crate) print: print::core::Print,
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
            why: why::NONE,
            failed_at: 0,
            had_bom: false,
            redone: 0,
            name_is_common_js: false,
            name_says_jsx: -1,
            #[cfg(feature = "stages")]
            stages: [0; 4],
            #[cfg(feature = "stages")]
            keep_stages: false,
            #[cfg(feature = "stages")]
            kept: Vec::new(),
            text: text::Text::new(),
            arena: arena::Arena::new(),
            holes: holes::Holes::new(),
            doc: doc::Doc::new(),
            lang: lang::Lang::new(),
            options: options::Options::new(),
            printer: printer::Printer::new(),
            mode: mode::Mode::new(),
            lexer: lexer::Lexer::new(),
            comments: comments::Comments::new(),
            fast: fast::Fast::new(),
            parse_pipeline: parse::pipeline::ParsePipeline::new(),
            parse_flow: parse::flow::ParseFlow::new(),
            parse_typescript: parse::typescript::ParseTypescript::new(),
            parse: parse::core::Parse::new(),
            print_embed: print::embed::PrintEmbed::new(),
            print_jest_each: print::jest_each::PrintJestEach::new(),
            print_binaryish: print::binaryish::PrintBinaryish::new(),
            print_object: print::object::PrintObject::new(),
            print_types: print::types::PrintTypes::new(),
            print_call: print::call::PrintCall::new(),
            print_jsx: print::jsx::PrintJsx::new(),
            print: print::core::Print::new(),
        }
    }

    pub(crate) fn stop(&mut self, why: i32) -> Stop {
        self.why = why;
        Stop
    }
}
