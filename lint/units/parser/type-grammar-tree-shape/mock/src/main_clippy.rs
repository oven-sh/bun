
pub mod lexer;
pub mod p;
pub mod parser;
pub mod typescript;
pub mod parse {
    #[path = "../under_test/type_sink.rs"]
    pub mod type_sink;
    #[path = "../under_test/parse_skip_typescript.rs"]
    pub mod parse_skip_typescript;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error { SyntaxError, StackOverflow, Backtrack, MacroFailed, Lexer(lexer::Error), Alloc(()) }
impl From<lexer::Error> for Error { fn from(e: lexer::Error) -> Self { Error::Lexer(e) } }
impl From<p::AllocError> for Error { fn from(_: p::AllocError) -> Self { Error::Alloc(()) } }

use bun_ast::op::Level;
use bun_ast::ts::Metadata;
use bun_ast::{Log, Source};
use p::P;
use std::fmt::Write;


pub struct Shape;
use parse::type_sink::{Operand, TypeKeyword, TypeLiteral, TypeSink};
impl TypeSink for Shape {
    type Out = String;
    #[cfg(og)]
    const CONDITIONAL_FALSE_LEVEL: Level = Level::Lowest;
    #[cfg(newtrait)]
    const NONE: String = String::new();
    #[cfg(newtrait)]
    const STRICT: bool = false;
    #[cfg(newtrait)]
    const BUILDS: bool = false;
    #[cfg(newtrait)]
    type Sub = parse::type_sink::Discard;
    #[cfg(newtrait)]
    type K<V: parse::type_sink::ConstDefault> = ();
    fn literal(out: &mut String, _l: TypeLiteral) { *out = "lit".into(); }
    fn keyword(out: &mut String, k: TypeKeyword) {
        *out = match k {
            TypeKeyword::Any => "any", TypeKeyword::Never => "never", TypeKeyword::Unknown => "unknown", TypeKeyword::Undefined => "undefined",
            TypeKeyword::Object => "object", TypeKeyword::Number => "number", TypeKeyword::String => "string", TypeKeyword::Boolean => "boolean",
            TypeKeyword::Bigint => "bigint", TypeKeyword::Symbol => "symbol", TypeKeyword::Null => "null", TypeKeyword::Void => "void", TypeKeyword::This => "this",
        }.into();
    }
    fn function_type(out: &mut String) { *out = "fn".into(); }
    fn parenthesized(out: &mut String, inner: String) { *out = format!("paren({inner})"); }
    fn keyof_type(out: &mut String) { *out = "keyof".into(); }
    fn readonly_type(out: &mut String) { *out = "readonly".into(); }
    fn typeof_query(out: &mut String) { *out = "typeof".into(); }
    fn tuple_type(out: &mut String) { *out = "tuple".into(); }
    fn object_type(out: &mut String) { *out = "object{}".into(); }
    fn template_literal_type(out: &mut String) { *out = "template".into(); }
    fn reference<'a, E>(out: &mut String, name: &'a [u8], _find: impl FnOnce(&'a [u8]) -> Result<bun_ast::Ref, E>) -> Result<(), E> {
        *out = String::from_utf8_lossy(name).into_owned();
        Ok(())
    }
    fn member<'a, E>(out: &mut String, name: &'a [u8], _is_name: bool, _find: impl FnOnce(&'a [u8]) -> Result<bun_ast::Ref, E>) -> Result<(), E> {
        out.push('.');
        out.push_str(&String::from_utf8_lossy(name));
        Ok(())
    }
    fn index_or_array(out: &mut String, has_index: bool) { *out = format!("{}({})", if has_index { "idx" } else { "arr" }, out); }
    fn union_left<'n>(out: &mut String, _l: impl Fn(bun_ast::Ref) -> &'n [u8]) -> Operand<String> { Operand::Open(std::mem::take(out)) }
    fn union_right(out: &mut String, left: String) { *out = format!("({left}|{out})"); }
    fn intersection_left<'n>(out: &mut String, _l: impl Fn(bun_ast::Ref) -> &'n [u8]) -> Operand<String> { Operand::Open(std::mem::take(out)) }
    fn intersection_right(out: &mut String, left: String) { *out = format!("({left}&{out})"); }
    fn conditional_true<'n>(out: &mut String, when_true: String, _l: impl Fn(bun_ast::Ref) -> &'n [u8]) -> Operand<String> {
        Operand::Open(format!("cond({};{};", std::mem::take(out), when_true))
    }
    fn conditional_false(out: &mut String, left: String) { *out = format!("{left}{out})"); }
}


#[cfg(newtrait)]
mod bshape {
    use crate::lexer::{Lexer, T};
    use crate::p::P;
    use crate::parse::type_sink::{b, ConstDefault, Operand, TypeKeyword, TypeLiteral, TypeSink};
    use crate::Error;
    use bun_ast::op::Level;
    use bun_ast::ts;
    use bun_ast::Ref;

    fn mk(s: String) -> ts::Type { ts::Type::mk(s) }
    fn close_set(set: &mut b::Set) -> ts::Type {
        let parts: Vec<String> = set.items.iter().map(|t| t.text()).collect();
        set.is_open = false;
        set.items.clear();
        mk(format!("{}[{}]", if set.is_union { "U" } else { "I" }, parts.join(",")))
    }
    fn led(node: ts::Type, is_union: bool) -> ts::Type { mk(format!("{}[{}]", if is_union { "U" } else { "I" }, node.text())) }

    /// The hooks of a sink that builds, with a text for every node.
    pub struct BShape;
    impl TypeSink for BShape {
        type Out = Option<ts::Type>;
        #[cfg(og)]
        const CONDITIONAL_FALSE_LEVEL: Level = Level::Lowest;
        const NONE: Option<ts::Type> = None;
        const STRICT: bool = true;
        const BUILDS: bool = true;
        type Sub = BShape;
        type K<V: ConstDefault> = V;
        fn literal(_out: &mut Self::Out, _l: TypeLiteral) {}
        fn keyword(_out: &mut Self::Out, _k: TypeKeyword) {}
        fn function_type(out: &mut Self::Out) { *out = Some(mk("fn".into())); }
        fn parenthesized(out: &mut Self::Out, inner: Self::Out) { *out = Some(mk(format!("paren({})", inner.map(|t| t.text()).unwrap_or_default()))); }
        fn keyof_type(_out: &mut Self::Out) {}
        fn readonly_type(_out: &mut Self::Out) {}
        fn typeof_query(_out: &mut Self::Out) {}
        fn tuple_type(_out: &mut Self::Out) {}
        fn object_type(_out: &mut Self::Out) {}
        fn template_literal_type(_out: &mut Self::Out) {}
        fn reference<'a, E>(_out: &mut Self::Out, _name: &'a [u8], _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>) -> Result<(), E> { Ok(()) }
        fn member<'a, E>(_out: &mut Self::Out, _name: &'a [u8], _is_name: bool, _find: impl FnOnce(&'a [u8]) -> Result<Ref, E>) -> Result<(), E> { Ok(()) }
        fn index_or_array(_out: &mut Self::Out, _has_index: bool) {}
        fn union_left<'n>(out: &mut Self::Out, _l: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out> { Operand::Open(*out) }
        fn union_right(_out: &mut Self::Out, _left: Self::Out) {}
        fn intersection_left<'n>(out: &mut Self::Out, _l: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out> { Operand::Open(*out) }
        fn intersection_right(_out: &mut Self::Out, _left: Self::Out) {}
        fn conditional_true<'n>(_out: &mut Self::Out, when_true: Self::Out, _l: impl Fn(Ref) -> &'n [u8]) -> Operand<Self::Out> { Operand::Open(when_true) }
        fn conditional_false(_out: &mut Self::Out, _left: Self::Out) {}

        fn node(out: &Self::Out) -> Option<ts::Type> { *out }
        fn b_take(out: &mut Self::Out) -> Option<ts::Type> { out.take() }
        fn b_node(out: &mut Self::Out, node: ts::Type) { *out = Some(node); }
        fn b_start(lx: &Lexer<'_>) -> u32 { lx.start as u32 }
        fn b_tok(_lx: &Lexer<'_>, _kind: ts::TokenKind) -> Option<ts::Token> { Some(ts::Token) }
        fn b_ident(lx: &Lexer<'_>) -> Option<ts::Name> { (lx.token == T::TIdentifier).then_some(ts::Name { start: lx.start as u32, end: lx.end as u32 }) }
        fn b_token(lx: &mut Lexer<'_>, out: &mut Self::Out) -> Result<(), Error> {
            let text = match lx.token {
                T::TIdentifier | T::TVoid | T::TNull | T::TThis => String::from_utf8_lossy(lx.raw()).into_owned(),
                _ => "lit".into(),
            };
            *out = Some(mk(text));
            Ok(())
        }
        fn b_negative(_lx: &mut Lexer<'_>, out: &mut Self::Out, _start: &u32) -> Result<(), Error> { *out = Some(mk("lit".into())); Ok(()) }
        fn b_reference(lx: &Lexer<'_>, out: &mut Self::Out) { *out = Some(mk(String::from_utf8_lossy(lx.raw()).into_owned())); }
        fn b_member(lx: &mut Lexer<'_>, out: &mut Self::Out) -> Result<(), Error> {
            *out = Some(mk(format!("{}.{}", out.map(|t| t.text()).unwrap_or_default(), String::from_utf8_lossy(lx.raw()))));
            Ok(())
        }
        fn b_type_arguments(_lx: &mut Lexer<'_>, _out: &mut Self::Out, _arguments: Option<b::Closed>) -> Result<(), Error> { Ok(()) }
        fn b_query(_lx: &Lexer<'_>, out: &mut Self::Out, _start: &u32) { *out = Some(mk("typeof".into())); }
        fn b_index(_lx: &Lexer<'_>, out: &mut Self::Out, index: Option<ts::Type>) {
            *out = Some(mk(format!("{}({})", if index.is_some() { "idx" } else { "arr" }, out.map(|t| t.text()).unwrap_or_default())));
        }
        fn b_non_null(_lx: &Lexer<'_>, out: &mut Self::Out) { *out = Some(mk(format!("nn({})", out.map(|t| t.text()).unwrap_or_default()))); }
        fn b_operator(_lx: &Lexer<'_>, out: &mut Self::Out, _start: &u32, operator: ts::TypeOperatorKind, operand: Option<ts::Type>) {
            let name = match operator { ts::TypeOperatorKind::KeyOf => "keyof", ts::TypeOperatorKind::Readonly => "readonly", ts::TypeOperatorKind::Unique => "unique" };
            *out = operand.map(|t| mk(format!("{}({})", name, t.text())));
        }
        fn b_infer(_lx: &Lexer<'_>, out: &mut Self::Out, _start: &u32, name: Option<ts::Name>, constraint: Option<ts::Type>) {
            *out = name.map(|_| mk(match constraint { Some(c) => format!("infer({})", c.text()), None => "infer".into() }));
        }
        fn b_conditional(_lx: &Lexer<'_>, out: &mut Self::Out, check: Option<ts::Type>, extends: Option<ts::Type>, when_true: Option<ts::Type>) {
            let (Some(c), Some(e), Some(t), Some(f)) = (check, extends, when_true, *out) else { return; };
            *out = Some(mk(format!("cond({};{};{};{})", c.text(), e.text(), t.text(), f.text())));
        }
        fn b_predicate(_lx: &mut Lexer<'_>, out: &mut Self::Out, _asserts: Option<ts::Token>, _type_node: Option<ts::Type>) -> Result<(), Error> { *out = Some(mk("pred".into())); Ok(()) }
        fn b_template(_lx: &Lexer<'_>, out: &mut Self::Out, _head: Option<ts::TemplatePiece>, _spans: b::List<ts::TemplateLiteralTypeSpan>) { *out = Some(mk("template".into())); }
        fn b_leading(lx: &Lexer<'_>, lead: &mut b::Lead) {
            let at = lx.start as u32;
            if lx.token == T::TBar { lead.bar.get_or_insert(at); } else { lead.ampersand.get_or_insert(at); }
        }
        fn b_operand(_lx: &Lexer<'_>, out: &mut Self::Out, set: &mut b::Set, lead: &mut b::Lead, is_union: bool) {
            let Some(mut left) = out.take() else { return; };
            if set.is_open {
                if set.is_union == is_union { return; }
                left = close_set(set);
            } else if is_union {
                if lead.ampersand.take().is_some() { left = led(left, false); }
            }
            let _ = if is_union { lead.bar.take() } else { lead.ampersand.take() };
            set.is_union = is_union;
            set.is_open = true;
            set.items.push(left);
        }
        fn b_operand_end(out: &mut Self::Out, set: &mut b::Set) {
            if let (true, Some(right)) = (set.is_open, *out) { set.items.push(right); }
        }
        fn b_finish(_lx: &Lexer<'_>, out: &mut Self::Out, set: &mut b::Set, lead: &mut b::Lead) {
            if set.is_open { *out = Some(close_set(set)); }
            let Some(mut node) = *out else { return; };
            if lead.ampersand.take().is_some() { node = led(node, false); }
            if lead.bar.take().is_some() { node = led(node, true); }
            *out = Some(node);
        }
    }

    /// Mocks of the productions that the sink that builds reads itself.
    impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
        fn mock_skip_balanced(&mut self) -> Result<(), Error> {
            let mut depth = 0usize;
            loop {
                match self.lexer.token {
                    T::TEndOfFile => return Err(Error::SyntaxError),
                    T::TOpenParen | T::TOpenBracket | T::TOpenBrace => depth += 1,
                    T::TCloseParen | T::TCloseBracket | T::TCloseBrace => { if depth == 0 { return Err(Error::SyntaxError); } depth -= 1; if depth == 0 { self.lexer.next()?; return Ok(()); } }
                    _ => {}
                }
                self.lexer.next()?;
            }
        }
        pub(crate) fn build_next_token_is(&mut self, token: T) -> bool {
            let old = self.lexer.snapshot();
            self.lexer.is_log_disabled = true;
            let holds = self.lexer.next().is_ok() && self.lexer.token == token;
            self.lexer.restore(&old);
            holds
        }
        pub(crate) fn build_is_greater_than(&self) -> bool {
            matches!(self.lexer.token, T::TGreaterThan | T::TGreaterThanEquals | T::TGreaterThanGreaterThan | T::TGreaterThanGreaterThanEquals
                | T::TGreaterThanGreaterThanGreaterThan | T::TGreaterThanGreaterThanGreaterThanEquals)
        }
        pub(crate) fn build_type_script_fn_type(&mut self) -> Result<ts::Type, Error> {
            if self.lexer.token == T::TIdentifier { self.lexer.next()?; }
            if self.lexer.token == T::TNew { self.lexer.next()?; }
            let _ = self.skip_type_script_type_parameters(crate::parser::TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
            let mut out = None;
            self.skip_type_script_paren_or_fn_type::<BShape>(&mut out)?;
            out.ok_or(Error::SyntaxError)
        }
        pub(crate) fn build_type_script_paren_or_fn_type(&mut self) -> Result<ts::Type, Error> {
            let mut out = None;
            self.skip_type_script_paren_or_fn_type::<BShape>(&mut out)?;
            out.ok_or(Error::SyntaxError)
        }
        pub(crate) fn build_type_script_tuple_type(&mut self) -> Result<ts::Type, Error> { self.mock_skip_balanced()?; Ok(mk("tuple".into())) }
        pub(crate) fn build_type_script_object_type(&mut self) -> Result<ts::Type, Error> { self.mock_skip_balanced()?; Ok(mk("object{}".into())) }
        pub(crate) fn build_type_script_import_type(&mut self) -> Result<ts::Type, Error> {
            let is_typeof = self.lexer.token == T::TTypeof;
            if is_typeof { self.lexer.next()?; }
            self.lexer.next()?;
            self.mock_skip_balanced()?;
            while self.lexer.token == T::TDot { self.lexer.next()?; self.lexer.next()?; }
            if !self.lexer.has_newline_before { let _ = self.skip_type_script_type_arguments::<false, false>()?; }
            Ok(mk(if is_typeof { "typeof import".into() } else { "import".into() }))
        }
        pub(crate) fn bshape_type(&mut self) -> Result<String, Error> {
            let mut out = None;
            self.skip_type_script_type_with_opts::<BShape>(Level::Lowest, crate::typescript::SkipTypeOptionsBitset::empty(), &mut out)?;
            Ok(out.map(|t| t.text()).unwrap_or_else(|| "_".into()))
        }
    }
}

fn meta(p: &P<'_, true, false>, m: &Metadata) -> String {
    let name = |r: &bun_ast::Ref| String::from_utf8_lossy(p.load_name_from_ref(*r)).into_owned();
    match m {
        Metadata::MNone => "None".into(), Metadata::MNever => "Never".into(), Metadata::MUnknown => "Unknown".into(),
        Metadata::MAny => "Any".into(), Metadata::MVoid => "Void".into(), Metadata::MNull => "Null".into(),
        Metadata::MUndefined => "Undefined".into(), Metadata::MFunction => "Function".into(), Metadata::MArray => "Array".into(),
        Metadata::MBoolean => "Boolean".into(), Metadata::MString => "String".into(), Metadata::MObject => "Object".into(),
        Metadata::MNumber => "Number".into(), Metadata::MBigint => "Bigint".into(), Metadata::MSymbol => "Symbol".into(),
        Metadata::MPromise => "Promise".into(), Metadata::MIdentifier(r) => format!("Id({})", name(r)),
        Metadata::MDot(rs) => format!("Dot({})", rs.iter().map(name).collect::<Vec<_>>().join(".")),
    }
}

/// mode: t = type, r = return type, T = type with metadata, R = return type with metadata,
/// a = "<" type arguments in an expression (attempt), w = arrow return type at ":" (attempt)
fn run(src: &[u8], mode: char, log_disabled: bool) -> String {
    // ";" in front, so that the first token of the input is not at the start of the file
    let mut prefixed = b"; ".to_vec();
    prefixed.extend_from_slice(src);
    let source = Source { contents: prefixed };
    let mut log = Log::default();
    let mut p: P<'_, true, false> = P::init(&mut log, &source);
    let mut out = String::new();
    if p.lexer.next().is_err() || p.lexer.next().is_err() { return "LEXERR".into(); }
    p.lexer.is_log_disabled = log_disabled;
    let mut m = None;
    let res: Result<String, Error> = match mode {
        't' => p.skip_type_script_type(Level::Lowest).map(|_| String::new()),
        'r' => p.skip_typescript_return_type().map(|_| String::new()),
        'T' => p.skip_type_script_type_with_metadata(Level::Lowest).map(|x| { m = Some(x); String::new() }),
        'R' => p.skip_typescript_return_type_with_metadata().map(|x| { m = Some(x); String::new() }),
        'S' => {
            let mut shape = String::new();
            p.skip_type_script_type_with_opts::<Shape>(Level::Lowest, typescript::SkipTypeOptionsBitset::empty(), &mut shape).map(|_| format!("{}", if shape.is_empty() { "_".into() } else { shape }))
        }
        #[cfg(newtrait)]
        'B' => p.bshape_type(),
        'a' => Ok(format!("{}", p.try_skip_type_script_type_arguments_with_backtracking())),
        'w' => Ok(format!("{}", p.try_skip_type_script_arrow_return_type_with_backtracking())),
        _ => unreachable!(),
    };
    match &res {
        Ok(s) => { let _ = write!(out, "ok{}{}", if s.is_empty() { "" } else { ":" }, s); }
        Err(e) => { let _ = write!(out, "err:{:?}", e); }
    }
    let _ = write!(out, " @{} {:?}", p.lexer.start, p.lexer.token);
    let errors = log.errors;
    let first = log.msgs.first().map(|m| format!("{}@{}", m.text, m.loc.start)).unwrap_or_default();
    let _ = write!(out, " E{}", errors);
    if errors > 0 { let _ = write!(out, " [{}]", first); }
    if let Some(m) = &m { let _ = write!(out, " M={}", meta(&p, m)); }
    if mode == 'T' || mode == 'R' { let _ = write!(out, " S={}", p.trace.join(",")); }
    let _ = write!(out, " n{}", p.lexer.tokens_scanned);
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read(&args[1]).unwrap();
    // one input per line; "\n" inside an input is written as the two bytes \ n, "\\" as \ \
    for line in text.split(|b| *b == b'\n') {
        if line.is_empty() { continue; }
        let mut src = Vec::new();
        let mut i = 0;
        while i < line.len() {
            if line[i] == b'\\' && i + 1 < line.len() {
                match line[i + 1] { b'n' => src.push(b'\n'), b'\\' => src.push(b'\\'), other => { src.push(b'\\'); src.push(other); } }
                i += 2;
            } else { src.push(line[i]); i += 1; }
        }
        println!("## {}", String::from_utf8_lossy(line));
        for mode in ['t', 'r', 'T', 'R'] {
            for dis in [false, true] {
                println!("  {}{} {}", mode, if dis { "-" } else { "+" }, run(&src, mode, dis));
            }
        }
        println!("  S+ {}", run(&src, 'S', false));
        #[cfg(newtrait)]
        println!("  B+ {}", run(&src, 'B', false));
        let mut wrapped = b"<".to_vec(); wrapped.extend_from_slice(&src); wrapped.extend_from_slice(b">(x)");
        println!("  a  {}", run(&wrapped, 'a', false));
        let mut wrapped = b": ".to_vec(); wrapped.extend_from_slice(&src); wrapped.extend_from_slice(b" => x");
        println!("  w  {}", run(&wrapped, 'w', false));
    }
}
