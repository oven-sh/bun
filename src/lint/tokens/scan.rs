//! Scans a file into tokens and comments.
//!
//! JavaScript cannot be split into tokens without knowing the syntax: a `/` divides or starts a
//! regular expression, `>>` shifts or closes two lists of type arguments, `<` compares or opens a
//! JSX element, `if` is a keyword or the name of a property. The parser has decided all of that, so
//! [`Marks`] first collects, in one pass over some vectors of the HIR, the few positions where the
//! text alone does not tell. The scan itself is one pass over the text, which looks at the marks
//! only where it meets such a character or word. Templates and the inside of JSX elements need no
//! marks: a stack of [`Frame`]s follows their nesting.
//!
//! The result is what the parser that ESLint uses for the file produces: see [`Dialect`].
//!
//! [`comments`] finds only the comments, which is all that many files are asked for. Between
//! comments it jumps from one string, template, regular expression or JSX element to the next.

use super::{RawToken, TokenKind, skip_trivia, skip_trivia_back};
use crate::ast::File;
use bun_core::{lexer, strings};
use bun_sema::atom::known;
use bun_sema::hir::{
    self, BinOp, ExprKind, Flags, MemberKind, ModifierKind, NameKind, PropKey, StmtKind, TypeNodeKind,
};

/// The two parsers agree on where every token is. They disagree on the type of some words.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Dialect {
    /// JavaScript files: espree, ESLint's default parser.
    /// - `static`, `let` and `yield` are a `Keyword` wherever they are, even as the name of a
    ///   property. Up to ES5 only `static` is.
    /// - Every name in a JSX tag is a `JSXIdentifier`.
    /// - Unless the file is a module, `<!--` starts a comment, and so does `-->` at the start of a
    ///   line.
    Espree { is_es5: bool },
    /// TypeScript files: typescript-estree.
    /// - `implements`, `interface`, `let`, `package`, `private`, `protected`, `public`, `static`
    ///   and `yield` are a `Keyword` where they act as one and an `Identifier` where they are a name.
    /// - In a JSX tag `this` is a `Keyword`, and both names of `a:b` are an `Identifier`.
    /// - Anywhere inside a JSX element, the `a` and the `b` of the expression `a.b` are a
    ///   `JSXIdentifier`.
    /// - A `#!` with nothing after it on its line is not a comment.
    TypeScript,
}

/// Positions in ascending order, which are asked for in ascending order.
#[derive(Default)]
struct Positions {
    list: Vec<u32>,
    next: usize,
}

impl Positions {
    #[inline]
    fn push(&mut self, at: u32) {
        self.list.push(at);
    }

    fn sort(&mut self) {
        if !self.list.is_sorted() {
            self.list.sort_unstable();
        }
    }

    #[inline]
    fn has(&mut self, at: usize) -> bool {
        while let Some(&next) = self.list.get(self.next) {
            if next as usize >= at {
                return next as usize == at;
            }
            self.next += 1;
        }
        false
    }
}

/// What the text does not tell.
#[derive(Default)]
struct Marks {
    /// The regular expressions: the start and the end.
    regexes: Vec<(u32, u32)>,
    next_regex: usize,
    /// The `<` of each JSX element and fragment.
    elements: Positions,
    /// The operators `<<`, `>>`, `>>>`, `>=`, `<<=`, `>>=` and `>>>=`. Any other `<` or `>` that is
    /// followed by one of these characters is a token of its own.
    shifts: Positions,
    /// The reserved words that are a name: of a property, of a member, in an import or an export.
    /// Those after a `.` are not listed.
    names: Positions,
    /// [`Dialect::TypeScript`]: the words that are reserved in strict mode only, where they are a
    /// keyword.
    keywords: Positions,
    /// [`Dialect::TypeScript`], in a file with JSX: the `a` and the `b` of each `a.b`.
    accesses: Positions,
}

/// The start of the operator after an operand that ends at `at`, not counting its parentheses.
fn operator_after(text: &[u8], mut at: u32) -> u32 {
    loop {
        at = skip_trivia(text, at);
        if text.get(at as usize) != Some(&b')') {
            return at;
        }
        at += 1;
    }
}

impl Marks {
    /// Only what tells where comments cannot be: `regexes` and `elements`.
    fn for_comments(file: &File) -> Marks {
        let mut marks = Marks::default();
        for e in file.hir.exprs {
            match e.kind {
                ExprKind::Regex => marks.regexes.push((e.pos, e.end)),
                ExprKind::Jsx(_) => marks.elements.push(e.pos),
                _ => {}
            }
        }
        if !marks.regexes.is_sorted() {
            marks.regexes.sort_unstable();
        }
        marks.elements.sort();
        marks
    }

    #[inline(never)]
    fn new(file: &File, dialect: Dialect) -> Marks {
        let (hir, text) = (&file.hir, file.text());
        let is_typescript = dialect == Dialect::TypeScript;
        let marks_accesses = is_typescript && !hir.jsx.is_empty();
        let mut marks = Marks::default();
        let end_of = |e: hir::ExprId| hir.exprs.get(e.idx()).map_or(0, |e| e.end);
        for e in hir.exprs {
            match e.kind {
                ExprKind::Regex => marks.regexes.push((e.pos, e.end)),
                ExprKind::Jsx(_) => marks.elements.push(e.pos),
                ExprKind::Binary {
                    op: BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::Ge,
                    left: operand,
                    ..
                }
                | ExprKind::Assign {
                    op: Some(BinOp::Shl | BinOp::Shr | BinOp::UShr),
                    target: operand,
                    ..
                } => marks.shifts.push(operator_after(text, end_of(operand))),
                ExprKind::AsConst(_) => marks.as_const(text, e),
                ExprKind::Yield { .. } if is_typescript => marks.keywords.push(e.pos),
                ExprKind::Dot { obj, name_pos, .. } if marks_accesses => {
                    marks.accesses.push(name_pos);
                    if let Some(obj) = hir.exprs.get(obj.idx())
                        && matches!(obj.kind, ExprKind::Ident(_))
                        && text.get(skip_trivia(text, obj.end) as usize) != Some(&b')')
                    {
                        marks.accesses.push(obj.pos);
                    }
                }
                _ => {}
            }
        }
        for prop in hir.props {
            if prop.name_kind == NameKind::Identifier && matches!(prop.key, PropKey::Name(_)) {
                marks.name(text, prop.pos);
            }
        }
        for member in hir.members {
            use MemberKind::{Getter, Method, Property, Setter, StaticBlock};
            if matches!(member.kind, Property | Method | Getter | Setter) {
                marks.name(text, member.name_pos);
            } else if member.kind == StaticBlock && is_typescript {
                marks.keywords.push(member.start);
            }
        }
        for prop in hir.pat_props {
            marks.name(text, prop.key_pos);
        }
        for member in hir.enum_members {
            marks.name(text, member.pos);
        }
        for spec in hir.import_specs {
            marks.name(text, spec.imported_pos);
        }
        for spec in hir.export_specs {
            marks.name(text, spec.local_pos);
            marks.name(text, spec.pos);
        }
        for stmt in hir.stmts {
            if let StmtKind::ExportStar { alias, alias_pos, .. } = stmt.kind
                && alias.is_some()
            {
                marks.name(text, alias_pos);
            }
        }
        if is_typescript {
            marks.names_of_typescript(file);
            marks.strict_mode_keywords(file);
        }
        if marks_accesses {
            marks.accesses_in_types(file);
        }
        if !marks.regexes.is_sorted() {
            marks.regexes.sort_unstable();
        }
        for list in [
            &mut marks.elements,
            &mut marks.shifts,
            &mut marks.names,
            &mut marks.keywords,
            &mut marks.accesses,
        ] {
            list.sort();
        }
        marks
    }

    /// Marks the name at `at` if it is a reserved word.
    #[inline]
    fn name(&mut self, text: &[u8], at: u32) {
        let chunk = Chunk::at(text, at as usize);
        let word = Word::of_chunk(chunk, chunk.count(identifier_parts));
        if !matches!(word, Word::Name | Word::Strict | Word::StrictAndEspree) {
            self.names.push(at);
        }
    }

    /// `A.B` in a type is not an expression, with two exceptions.
    fn accesses_in_types(&mut self, file: &File) {
        let hir = &file.hir;
        let names = |names: hir::Span<hir::NameId>| hir.names.get(names.range()).unwrap_or_default().iter();
        // The operand of `typeof a.b` is an expression in the HIR only.
        let mut operands = Vec::new();
        for ty in hir.types {
            if let TypeNodeKind::Typeof { name, .. } = ty.kind {
                operands.extend(names(name).map(|name| name.pos()));
            }
        }
        if !operands.is_empty() {
            operands.sort_unstable();
            self.accesses.list.retain(|at| operands.binary_search(at).is_err());
        }
        // What a class implements and what an interface extends is an expression for TypeScript.
        let of_classes = hir.classes.iter().flat_map(|it| [it.implements, it.other_implements]);
        let of_interfaces = hir.interfaces.iter().flat_map(|it| [it.extends, it.other_heritage]);
        for list in of_classes.chain(of_interfaces) {
            for &ty in hir.ids.get(list.range()).unwrap_or_default() {
                if let Some(TypeNodeKind::Ref { name, .. }) = hir.types.get(ty as usize).map(|ty| ty.kind)
                    && name.len() > 1
                {
                    self.accesses.list.extend(names(name).map(|name| name.pos()));
                }
            }
        }
    }

    fn names_of_typescript(&mut self, file: &File) {
        let (hir, text) = (&file.hir, file.text());
        for elem in hir.tuple_elems {
            if elem.name.is_some() {
                let start = if elem.has_dots { skip_trivia(text, elem.start + 3) } else { elem.start };
                self.name(text, start);
            }
        }
        for pat in hir.pats {
            // `function f(this: T) {}`
            if matches!(pat.kind, hir::PatKind::Ident(known::this)) {
                self.names.push(pat.pos);
            }
        }
        for name in hir.names {
            // `typeof this.a`
            if name.text == known::this && !name.is_qualified() {
                self.names.push(name.pos());
            }
        }
    }

    /// The `const` of `a as const` and `<const>a` is the name of a type.
    fn as_const(&mut self, text: &[u8], e: &hir::Expr) {
        let at = match text.get(e.pos as usize) {
            Some(b'<') if !text.get(..e.end as usize).unwrap_or_default().ends_with(b"const") => {
                skip_trivia(text, e.pos + 1)
            }
            _ => e.end.saturating_sub(5),
        };
        self.names.push(at);
    }

    fn strict_mode_keywords(&mut self, file: &File) {
        let (hir, text) = (&file.hir, file.text());
        let mut word_before = |at: u32, word: &[u8]| {
            if text.get(..at as usize).is_some_and(|before| before.ends_with(word)) {
                self.keywords.push(at - word.len() as u32);
            }
        };
        for modifier in hir.modifiers {
            const WORDS: Flags = (Flags::STATIC.union(Flags::PRIVATE)).union(Flags::PROTECTED.union(Flags::PUBLIC));
            if let ModifierKind::Keyword(flag) = modifier.kind
                && WORDS.contains(flag)
            {
                word_before(modifier.pos + hir::modifier_text(flag).len() as u32, hir::modifier_text(flag).as_bytes());
            }
        }
        for decl in hir.var_decls {
            if decl.kind == hir::VarKind::Let {
                word_before(decl.loc.pos, b"let");
            }
        }
        for interface in hir.interfaces {
            word_before(skip_trivia_back(text, interface.name_pos), b"interface");
        }
        for class in hir.classes {
            let first = hir.ids.get(class.implements.start as usize).filter(|_| !class.implements.is_empty());
            if let Some(first) = first.and_then(|&first| hir.types.get(first as usize)) {
                word_before(skip_trivia_back(text, first.pos), b"implements");
            }
        }
    }

    /// The first regular expression that starts at `at` or after it.
    #[inline]
    fn next_regex(&mut self, at: usize) -> Option<(usize, usize)> {
        while let Some(&(start, end)) = self.regexes.get(self.next_regex) {
            if start as usize >= at && end > start {
                return Some((start as usize, end as usize));
            }
            self.next_regex += 1;
        }
        None
    }

    /// The end of the regular expression that starts at `at`.
    #[inline]
    fn regex_end(&mut self, at: usize) -> Option<usize> {
        self.next_regex(at).filter(|regex| regex.0 == at).map(|regex| regex.1)
    }
}

const ONES: u64 = 0x0101_0101_0101_0101;
const HIGH_BITS: u64 = ONES * 0x80;

/// For 8 bytes that are all below 0x80: the high bit of each that is `byte`.
#[inline]
const fn equal_to(bytes: u64, byte: u8) -> u64 {
    !((bytes ^ (ONES * byte as u64)) + ONES * 0x7F)
}

/// The same for each that is in `first..=last`.
#[inline]
const fn between(bytes: u64, first: u8, last: u8) -> u64 {
    (bytes + ONES * (0x80 - first as u64)) & !(bytes + ONES * (0x7F - last as u64))
}

/// The ASCII characters that continue an identifier.
#[inline]
const fn identifier_parts(bytes: u64) -> u64 {
    between(bytes | (ONES * 0x20), b'a', b'z') | between(bytes, b'0', b'9') | equal_to(bytes, b'_') | equal_to(bytes, b'$')
}

/// The whitespace of ASCII, and the control characters, which are in no token.
#[inline]
const fn blanks(bytes: u64) -> u64 {
    !(bytes + ONES * (0x7F - b' ' as u64))
}

/// For any 8 bytes: the high bit of the first that is `byte`, and possibly of some after it.
#[inline]
const fn first_equal_to(bytes: u64, byte: u8) -> u64 {
    let difference = bytes ^ (ONES * byte as u64);
    difference.wrapping_sub(ONES) & !difference
}

/// The position of the first byte of `text` from `at` that is one of `stops`, or the end of `text`.
#[inline]
fn find(text: &[u8], at: usize, stops: &[u8]) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    strings::index_of_any(rest, stops).map_or(text.len(), |found| at + found)
}

/// `find` for what is likely within a few bytes, as the end of a string is: too near for the call
/// of a vectorized search to pay off.
#[inline]
fn find_nearby<const N: usize>(text: &[u8], mut at: usize, stops: [u8; N]) -> usize {
    let first = |bytes: u64| {
        let found = stops.iter().fold(0, |found, &stop| found | first_equal_to(bytes, stop));
        (found & HIGH_BITS).trailing_zeros() / 8
    };
    for _ in 0..2 {
        let chunk = Chunk::at(text, at);
        let (low, high) = (first(chunk.0), first(chunk.1));
        let plain = (low + if low == 8 { high } else { 0 }) as usize;
        at += plain;
        if plain < Chunk::LEN || at >= text.len() {
            return at.min(text.len());
        }
    }
    find(text, at, &stops)
}

/// 16 bytes of the text, to classify at once: a loop over the bytes of a word or of an indentation
/// ends in a branch that the processor cannot predict.
#[derive(Copy, Clone)]
struct Chunk(u64, u64);

impl Chunk {
    const LEN: usize = 16;

    /// The bytes from `at`. Zeros after the end of the text.
    #[inline]
    fn at(text: &[u8], at: usize) -> Chunk {
        match text.get(at..).and_then(|rest| rest.first_chunk::<16>()) {
            Some(bytes) => {
                let bytes = u128::from_le_bytes(*bytes);
                Chunk(bytes as u64, (bytes >> 64) as u64)
            }
            None => Chunk::at_end(text, at),
        }
    }

    #[cold]
    fn at_end(text: &[u8], at: usize) -> Chunk {
        let (rest, mut bytes) = (text.get(at..).unwrap_or_default(), [0; 16]);
        bytes[..rest.len()].copy_from_slice(rest);
        let bytes = u128::from_le_bytes(bytes);
        Chunk(bytes as u64, (bytes >> 64) as u64)
    }

    /// How many bytes from the start are of a class of ASCII characters. `class` gets 8 bytes with
    /// their high bits cleared and sets the high bit of each that is of the class.
    #[inline]
    fn count(self, class: impl Fn(u64) -> u64) -> usize {
        let others = |bytes: u64| !(class(bytes & !HIGH_BITS) & !bytes) & HIGH_BITS;
        let (first, second) = (others(self.0).trailing_zeros() / 8, others(self.1).trailing_zeros() / 8);
        (first + if first == 8 { second } else { 0 }) as usize
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Word {
    Name,
    Reserved,
    /// Not reserved up to ES5.
    ReservedSinceEs6,
    /// Reserved, but not a keyword of JavaScript.
    Enum,
    Null,
    Boolean,
    /// Reserved in strict mode, and what espree always takes for a keyword.
    StrictAndEspree,
    /// Reserved in strict mode.
    Strict,
}

impl Word {
    const ALL: [(&'static [u8], Word); 45] = [
        (b"break", Word::Reserved),
        (b"case", Word::Reserved),
        (b"catch", Word::Reserved),
        (b"class", Word::ReservedSinceEs6),
        (b"const", Word::ReservedSinceEs6),
        (b"continue", Word::Reserved),
        (b"debugger", Word::Reserved),
        (b"default", Word::Reserved),
        (b"delete", Word::Reserved),
        (b"do", Word::Reserved),
        (b"else", Word::Reserved),
        (b"enum", Word::Enum),
        (b"export", Word::ReservedSinceEs6),
        (b"extends", Word::ReservedSinceEs6),
        (b"false", Word::Boolean),
        (b"finally", Word::Reserved),
        (b"for", Word::Reserved),
        (b"function", Word::Reserved),
        (b"if", Word::Reserved),
        (b"implements", Word::Strict),
        (b"import", Word::ReservedSinceEs6),
        (b"in", Word::Reserved),
        (b"instanceof", Word::Reserved),
        (b"interface", Word::Strict),
        (b"let", Word::StrictAndEspree),
        (b"new", Word::Reserved),
        (b"null", Word::Null),
        (b"package", Word::Strict),
        (b"private", Word::Strict),
        (b"protected", Word::Strict),
        (b"public", Word::Strict),
        (b"return", Word::Reserved),
        (b"static", Word::StrictAndEspree),
        (b"super", Word::ReservedSinceEs6),
        (b"switch", Word::Reserved),
        (b"this", Word::Reserved),
        (b"throw", Word::Reserved),
        (b"true", Word::Boolean),
        (b"try", Word::Reserved),
        (b"typeof", Word::Reserved),
        (b"var", Word::Reserved),
        (b"void", Word::Reserved),
        (b"while", Word::Reserved),
        (b"with", Word::Reserved),
        (b"yield", Word::StrictAndEspree),
    ];

    /// No two of `ALL` have the same.
    #[inline]
    const fn hash(first: u8, second: u8, len: usize) -> usize {
        (first as usize * 11 + second as usize * 123 + len) % 128
    }

    /// By `hash`: the bytes of the word as two little-endian numbers, and what it is.
    const BY_HASH: [(u64, u64, Word); 128] = {
        let mut table = [(0, 0, Word::Name); 128];
        let mut i = 0;
        while i < Word::ALL.len() {
            let word = Word::ALL[i].0;
            let hash = Word::hash(word[0], word[1], word.len());
            assert!(table[hash].0 == 0);
            let mut bytes = [0; 16];
            let mut j = 0;
            while j < word.len() {
                bytes[j] = word[j];
                j += 1;
            }
            let bytes = u128::from_le_bytes(bytes);
            table[hash] = (bytes as u64, (bytes >> 64) as u64, Word::ALL[i].1);
            i += 1;
        }
        table
    };

    /// What the first `len` bytes of `chunk` are.
    #[inline]
    fn of_chunk(chunk: Chunk, len: usize) -> Word {
        if !(2..=10).contains(&len) {
            return Word::Name;
        }
        let low = if len < 8 { chunk.0 & ((1 << (8 * len)) - 1) } else { chunk.0 };
        let high = if len > 8 { chunk.1 & ((1 << (8 * (len - 8))) - 1) } else { 0 };
        let candidate = Word::BY_HASH[Word::hash(low as u8, (low >> 8) as u8, len)];
        if (candidate.0, candidate.1) == (low, high) { candidate.2 } else { Word::Name }
    }

    #[inline]
    fn of(word: &[u8]) -> Word {
        Word::of_chunk(Chunk::at(word, 0), word.len())
    }
}

/// What the scanner is in the middle of, and returns to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Code,
    /// After the `<` of `<a b="c">` or `<a/>`.
    OpeningTag,
    /// After the `</` of `</a>`.
    ClosingTag,
    /// Between `<a>` and `</a>`.
    Children,
}

#[derive(Copy, Clone)]
enum FrameKind {
    /// After the `${` of a template. The `}` continues the template.
    Substitution,
    /// After a `{` in a JSX tag or among JSX children. The `}` returns there.
    Container(Mode),
    /// In a JSX element, which is in that.
    Element(Mode),
    /// After the `<` of the type arguments of a JSX tag. The `>` returns to the tag.
    TypeArguments,
}

struct Frame {
    kind: FrameKind,
    /// `Scanner::braces` and `Scanner::angles` outside of it.
    braces: u32,
    angles: u32,
}

/// `TOKENS`: whether the tokens are wanted, or only the comments.
struct Scanner<'a, const TOKENS: bool> {
    text: &'a [u8],
    at: usize,
    tokens: Vec<RawToken>,
    comments: Vec<RawToken>,
    marks: Marks,
    dialect: Dialect,
    /// `<!--` and `-->` start a comment.
    has_html_comments: bool,
    frames: Vec<Frame>,
    /// The `{` that are open in the innermost frame.
    braces: u32,
    /// The `<` that are open in the innermost frame, if that is `TypeArguments`.
    angles: u32,
    /// The JSX elements that are open.
    elements: u32,
}

/// The tokens and the comments of `file`.
pub(super) fn scan(file: &File) -> (Vec<RawToken>, Vec<RawToken>) {
    let dialect = Dialect::of(file);
    let capacity = file.text().len() / 5 + 1;
    let scanner = Scanner::<true>::run(file, dialect, Marks::new(file, dialect), capacity);
    (scanner.tokens, scanner.comments)
}

/// The comments of `file`. `None`: they cannot be told without the tokens.
pub(super) fn comments(file: &File) -> Option<Vec<RawToken>> {
    let text = file.text();
    if has_html_comments(file) && (strings::contains(text, b"<!--") || strings::contains(text, b"-->")) {
        return None;
    }
    Some(Scanner::<false>::run(file, Dialect::of(file), Marks::for_comments(file), 0).comments)
}

fn has_html_comments(file: &File) -> bool {
    file.is_javascript() && !file.is_module()
}

impl Dialect {
    fn of(file: &File) -> Dialect {
        match file.is_javascript() {
            true => Dialect::Espree {
                is_es5: file.language().ecma_version <= 5,
            },
            false => Dialect::TypeScript,
        }
    }
}

impl<'a, const TOKENS: bool> Scanner<'a, TOKENS> {
    fn run(file: &File<'a>, dialect: Dialect, marks: Marks, capacity: usize) -> Self {
        let text = file.text();
        let mut scanner = Scanner {
            text,
            at: 0,
            tokens: Vec::with_capacity(capacity),
            comments: Vec::new(),
            marks,
            dialect,
            has_html_comments: has_html_comments(file),
            frames: Vec::new(),
            braces: 0,
            angles: 0,
            elements: 0,
        };
        if text.starts_with(b"#!") {
            scanner.line_comment(TokenKind::Shebang);
            if scanner.at == 2 && dialect == Dialect::TypeScript {
                scanner.comments.clear();
            }
        }
        let mut mode = Mode::Code;
        while scanner.at < text.len() {
            mode = match mode {
                Mode::Code if TOKENS => scanner.code(),
                Mode::Code => scanner.skip_code(),
                Mode::OpeningTag => scanner.tag(false),
                Mode::ClosingTag => scanner.tag(true),
                Mode::Children => scanner.children(),
            };
        }
        scanner
    }

    /// Adds the token from `start` to `end`, and continues there.
    #[inline]
    fn token(&mut self, kind: TokenKind, start: usize, end: usize) {
        let end = end.min(self.text.len());
        if TOKENS {
            self.tokens.push(RawToken {
                start: start as u32,
                end: end as u32,
                kind,
            });
        }
        self.at = end;
    }

    /// Adds the punctuator of `len` bytes at the current position.
    #[inline]
    fn punctuator(&mut self, len: usize) {
        self.token(TokenKind::Punctuator, self.at, self.at + len);
    }

    #[inline]
    fn byte(&self, at: usize) -> u8 {
        self.text.get(at).copied().unwrap_or(0)
    }

    fn enter(&mut self, kind: FrameKind) {
        self.frames.push(Frame {
            kind,
            braces: self.braces,
            angles: self.angles,
        });
        (self.braces, self.angles) = (0, 0);
    }

    fn leave(&mut self) {
        if let Some(frame) = self.frames.pop() {
            (self.braces, self.angles) = (frame.braces, frame.angles);
        }
    }

    /// At a `}` in code. Returns what it returns to, if that is not code.
    #[inline]
    fn close_brace(&mut self) -> Option<Mode> {
        if self.braces > 0 {
            self.braces -= 1;
            self.punctuator(1);
            return None;
        }
        match self.frames.last().map(|frame| frame.kind) {
            Some(FrameKind::Substitution) => {
                self.leave();
                self.template();
                None
            }
            Some(FrameKind::Container(mode)) => {
                self.leave();
                self.punctuator(1);
                Some(mode)
            }
            _ => {
                self.punctuator(1);
                None
            }
        }
    }

    /// At the `<` of a JSX element that is in `outer`.
    fn open_element(&mut self, outer: Mode) -> Mode {
        self.punctuator(1);
        self.enter(FrameKind::Element(outer));
        self.elements += 1;
        Mode::OpeningTag
    }

    /// At a `>` in code that is a token of its own. Returns what it returns to, if that is not code.
    #[inline]
    fn close_angle(&mut self) -> Option<Mode> {
        self.punctuator(1);
        if self.angles == 0 {
            return None;
        }
        self.angles -= 1;
        (self.angles == 0).then(|| {
            self.leave();
            Mode::OpeningTag
        })
    }

    /// `code` without the tokens: from one character that can start or end something in which
    /// `//` and `/*` are not comments to the next.
    fn skip_code(&mut self) -> Mode {
        let text = self.text;
        loop {
            let regex = self.marks.next_regex(self.at);
            let code = &text[..regex.map_or(text.len(), |regex| regex.0)];
            let at = match (self.frames.is_empty(), self.marks.elements.list.is_empty()) {
                (true, true) => find(code, self.at, b"/\"'`"),
                (true, false) => find(code, self.at, b"/\"'`<"),
                (false, _) => find(code, self.at, b"/\"'`<>{}"),
            };
            if at == code.len() {
                self.at = regex.map_or(text.len(), |regex| regex.1);
                if regex.is_none() {
                    return Mode::Code;
                }
                continue;
            }
            self.at = at;
            match text[at] {
                b'/' => match self.byte(at + 1) {
                    b'/' => self.line_comment(TokenKind::Line),
                    b'*' => self.block_comment(),
                    _ => self.at += 1,
                },
                quote @ (b'"' | b'\'') => self.string(quote),
                b'`' => self.template(),
                b'{' => {
                    self.braces += 1;
                    self.at += 1;
                }
                b'}' => {
                    if let Some(mode) = self.close_brace() {
                        return mode;
                    }
                }
                b'<' if self.marks.elements.has(at) => return self.open_element(Mode::Code),
                b'<' => {
                    self.angles += u32::from(self.angles > 0);
                    self.at += 1;
                }
                // Not the `>` of `=>`.
                _ if at > 0 && text[at - 1] == b'=' => self.at += 1,
                _ => {
                    if let Some(mode) = self.close_angle() {
                        return mode;
                    }
                }
            }
        }
    }

    /// Tokens of JavaScript and TypeScript, until something else starts or continues.
    fn code(&mut self) -> Mode {
        let text = self.text;
        loop {
            let mut at = self.at;
            // Whether a token is followed by no blank, by one, or by more is mostly predictable.
            if self.byte(at) <= b' ' {
                at += 1;
                if self.byte(at) <= b' ' {
                    loop {
                        let blank = Chunk::at(text, at).count(blanks);
                        at += blank;
                        if blank < Chunk::LEN || at >= text.len() {
                            break;
                        }
                    }
                }
            }
            let Some(&first) = text.get(at) else {
                self.at = text.len();
                return Mode::Code;
            };
            self.at = at;
            let next = self.byte(at + 1);
            match first {
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' => self.word(),
                b'(' | b')' | b'[' | b']' | b';' | b',' | b':' | b'~' | b'@' => self.punctuator(1),
                b'{' => {
                    self.braces += 1;
                    self.punctuator(1);
                }
                b'}' => {
                    if let Some(mode) = self.close_brace() {
                        return mode;
                    }
                }
                b'.' if next.is_ascii_digit() => self.number(),
                b'.' => self.punctuator(if next == b'.' && self.byte(at + 2) == b'.' { 3 } else { 1 }),
                b'0'..=b'9' => self.number(),
                b'"' | b'\'' => self.string(first),
                b'`' => self.template(),
                b'=' => self.punctuator(match (next, self.byte(at + 2)) {
                    (b'=', b'=') => 3,
                    (b'=' | b'>', _) => 2,
                    _ => 1,
                }),
                b'!' => self.punctuator(match (next, self.byte(at + 2)) {
                    (b'=', b'=') => 3,
                    (b'=', _) => 2,
                    _ => 1,
                }),
                b'-' if next == b'-' && self.has_html_comments && self.is_html_close_comment() => {
                    self.line_comment(TokenKind::Line);
                }
                b'+' | b'-' => self.punctuator(if next == first || next == b'=' { 2 } else { 1 }),
                b'%' | b'^' => self.punctuator(if next == b'=' { 2 } else { 1 }),
                b'*' | b'&' | b'|' => self.punctuator(match (next, self.byte(at + 2)) {
                    (b'=', _) => 2,
                    (_, b'=') if next == first => 3,
                    _ if next == first => 2,
                    _ => 1,
                }),
                b'?' => self.punctuator(match (next, self.byte(at + 2)) {
                    (b'?', b'=') => 3,
                    (b'?', _) => 2,
                    (b'.', after) if !after.is_ascii_digit() => 2,
                    _ => 1,
                }),
                b'/' => match next {
                    b'/' => self.line_comment(TokenKind::Line),
                    b'*' => self.block_comment(),
                    _ => match self.marks.regex_end(at) {
                        Some(end) => self.token(TokenKind::RegularExpression, at, end),
                        None => self.punctuator(if next == b'=' { 2 } else { 1 }),
                    },
                },
                b'<' if next == b'!' && self.has_html_comments && text[at..].starts_with(b"<!--") => {
                    self.line_comment(TokenKind::Line);
                }
                b'<' => {
                    if self.marks.elements.has(at) {
                        return self.open_element(Mode::Code);
                    }
                    if next == b'<' && self.marks.shifts.has(at) {
                        self.punctuator(if self.byte(at + 2) == b'=' { 3 } else { 2 });
                    } else if next == b'=' {
                        self.punctuator(2);
                    } else {
                        self.angles += u32::from(self.angles > 0);
                        self.punctuator(1);
                    }
                }
                b'>' => {
                    if matches!(next, b'>' | b'=') && self.marks.shifts.has(at) {
                        let same = text[at..].iter().take(3).take_while(|&&b| b == b'>').count();
                        self.punctuator(same + usize::from(self.byte(at + same) == b'='));
                    } else if let Some(mode) = self.close_angle() {
                        return mode;
                    }
                }
                b'#' => {
                    let end = lexer::scan_identifier_parts(text, at + 1);
                    self.token(TokenKind::PrivateIdentifier, at, end);
                }
                0x80.. => self.non_ascii(),
                _ => self.at += 1,
            }
        }
    }

    /// At `--`: whether a `>` follows and no token precedes on the line.
    #[cold]
    fn is_html_close_comment(&self) -> bool {
        let Some(last) = self.tokens.last() else {
            return self.byte(self.at + 2) == b'>';
        };
        let mut between = &self.text[last.end as usize..self.at];
        while let Some(found) = strings::index_of_any(between, b"\n\r\xE2") {
            if lexer::starts_with_line_break(&between[found..]) {
                return self.byte(self.at + 2) == b'>';
            }
            between = &between[found + 1..];
        }
        false
    }

    /// At a character that is not ASCII: whitespace, or the start of an identifier.
    #[cold]
    fn non_ascii(&mut self) {
        let (c, size) = lexer::char_and_size(self.text, self.at);
        if lexer::is_identifier_start(c as u32) {
            self.word();
        } else {
            self.at += size.max(1);
        }
    }

    /// Whether the last token is a `.` or a `?.`.
    #[inline]
    fn is_after_dot(&self) -> bool {
        self.tokens.last().is_some_and(|last| {
            last.end - last.start <= 2 && last.kind == TokenKind::Punctuator && self.byte((last.end as usize).saturating_sub(1)) == b'.'
        })
    }

    /// An identifier or a keyword.
    #[inline(always)]
    fn word(&mut self) {
        let (text, start) = (self.text, self.at);
        let chunk = Chunk::at(text, start);
        let mut end = start + chunk.count(identifier_parts);
        while end - start >= Chunk::LEN {
            let parts = Chunk::at(text, end).count(identifier_parts);
            end += parts;
            if parts < Chunk::LEN {
                break;
            }
        }
        if matches!(text.get(end), Some(b'\\' | 0x80..)) {
            return self.unusual_word(end);
        }
        let mut kind = TokenKind::Identifier;
        let word = Word::of_chunk(chunk, end - start);
        if word != Word::Name {
            kind = self.kind_of_word(word);
        }
        if kind == TokenKind::Identifier && self.elements > 0 && self.marks.accesses.has(start) {
            kind = TokenKind::JsxIdentifier;
        }
        self.token(kind, start, end);
    }

    /// The type of the word at the current position.
    fn kind_of_word(&mut self, word: Word) -> TokenKind {
        let kind = match (word, self.dialect) {
            (Word::Name, _) => return TokenKind::Identifier,
            (Word::StrictAndEspree, Dialect::Espree { is_es5 }) => {
                let is_keyword = !is_es5 || self.byte(self.at) == b's';
                return if is_keyword { TokenKind::Keyword } else { TokenKind::Identifier };
            }
            (Word::Strict | Word::Enum, Dialect::Espree { .. })
            | (Word::ReservedSinceEs6, Dialect::Espree { is_es5: true }) => return TokenKind::Identifier,
            (Word::Strict | Word::StrictAndEspree, Dialect::TypeScript) => {
                let is_keyword = self.marks.keywords.has(self.at);
                return if is_keyword { TokenKind::Keyword } else { TokenKind::Identifier };
            }
            (Word::Null, _) => TokenKind::Null,
            (Word::Boolean, _) => TokenKind::Boolean,
            (Word::Reserved | Word::ReservedSinceEs6 | Word::Enum, _) => TokenKind::Keyword,
        };
        if self.marks.names.has(self.at) || self.is_after_dot() {
            return TokenKind::Identifier;
        }
        kind
    }

    /// An identifier with an escape sequence or a character that is not ASCII at `end`. With an
    /// escape sequence a reserved word can only be a name.
    #[cold]
    fn unusual_word(&mut self, end: usize) {
        let (text, start) = (self.text, self.at);
        let end = lexer::scan_identifier_parts(text, end);
        if end == start {
            self.at += 1;
            return;
        }
        let mut kind = TokenKind::Identifier;
        if let Dialect::Espree { .. } = self.dialect
            && strings::contains_char(&text[start..end], b'\\')
        {
            let (mut word, mut len, mut at) = ([0u8; 8], 0, start);
            while at < end && len < word.len() {
                let (c, size) = match text[at] {
                    b'\\' => lexer::peek_unicode_escape(text, at).unwrap_or((0, 1)),
                    c => (i32::from(c), 1),
                };
                word[len] = u8::try_from(c).unwrap_or(0);
                (len, at) = (len + 1, at + size);
            }
            let is_es5 = self.dialect == Dialect::Espree { is_es5: true };
            if at == end && Word::of(&word[..len]) == Word::StrictAndEspree && (!is_es5 || word[0] == b's') {
                kind = TokenKind::Keyword;
            }
        } else if self.elements > 0 && self.marks.accesses.has(start) {
            kind = TokenKind::JsxIdentifier;
        }
        self.token(kind, start, end);
    }

    fn number(&mut self) {
        let (text, start) = (self.text, self.at);
        let digits = |mut at: usize| {
            while matches!(text.get(at), Some(b'0'..=b'9' | b'_')) {
                at += 1;
            }
            at
        };
        let mut end = start;
        if text[start] == b'0' && matches!(self.byte(start + 1), b'x' | b'X' | b'o' | b'O' | b'b' | b'B') {
            end += 2;
            while text.get(end).is_some_and(|&b| b.is_ascii_alphanumeric() || b == b'_') {
                end += 1;
            }
            return self.token(TokenKind::Numeric, start, end);
        }
        end = digits(end);
        let is_legacy_octal = text[start] == b'0' && end > start + 1 && text[start..end].iter().all(|b| matches!(b, b'0'..=b'7'));
        if is_legacy_octal {
            return self.token(TokenKind::Numeric, start, end);
        }
        if self.byte(end) == b'.' {
            end = digits(end + 1);
        }
        if matches!(self.byte(end), b'e' | b'E') {
            let sign = usize::from(matches!(self.byte(end + 1), b'+' | b'-'));
            if self.byte(end + 1 + sign).is_ascii_digit() {
                end = digits(end + 1 + sign);
            }
        }
        if self.byte(end) == b'n' {
            end += 1;
        }
        self.token(TokenKind::Numeric, start, end);
    }

    fn string(&mut self, quote: u8) {
        let (text, start) = (self.text, self.at);
        let mut end = start + 1;
        loop {
            end = find_nearby(text, end, [quote, b'\\', b'\n', b'\r']);
            match text.get(end) {
                Some(b'\\') => end += if text[end + 1..].starts_with(b"\r\n") { 3 } else { 2 },
                Some(&b) => {
                    end += usize::from(b == quote);
                    break;
                }
                None => break,
            }
        }
        self.token(TokenKind::String, start, end);
    }

    /// From a `` ` ``, or from the `}` that ends a substitution, to the next `${` or the closing
    /// `` ` ``.
    fn template(&mut self) {
        let (text, start) = (self.text, self.at);
        let mut end = start + 1;
        loop {
            end = find(text, end, b"`\\$") + 1;
            match self.byte(end - 1) {
                b'\\' => end += 1,
                b'$' if self.byte(end) == b'{' => {
                    end += 1;
                    self.enter(FrameKind::Substitution);
                    break;
                }
                b'$' => {}
                _ => break,
            }
        }
        self.token(TokenKind::Template, start, end);
    }

    fn comment(&mut self, kind: TokenKind, end: usize) {
        self.comments.push(RawToken {
            start: self.at as u32,
            end: end as u32,
            kind,
        });
        self.at = end;
    }

    /// From `//` or `#!` to the end of the line.
    fn line_comment(&mut self, kind: TokenKind) {
        let text = self.text;
        let mut end = self.at + 2;
        loop {
            // 0xE2 starts U+2028 and U+2029, which end a line too.
            end = find(text, end, b"\n\r\xE2");
            if self.byte(end) != 0xE2 || lexer::starts_with_line_break(&text[end..]) {
                break;
            }
            end += 1;
        }
        self.comment(kind, end);
    }

    fn block_comment(&mut self) {
        let rest = &self.text[self.at + 2..];
        let len = strings::index_of(rest, b"*/").map_or(rest.len(), |found| found + 2);
        self.comment(TokenKind::Block, self.at + 2 + len);
    }

    /// Past whitespace and comments.
    fn trivia(&mut self) {
        loop {
            match self.byte(self.at) {
                b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => self.at += 1,
                b'/' if self.byte(self.at + 1) == b'/' => self.line_comment(TokenKind::Line),
                b'/' if self.byte(self.at + 1) == b'*' => self.block_comment(),
                0x80.. => {
                    let (c, size) = lexer::char_and_size(self.text, self.at);
                    if lexer::is_identifier_start(c as u32) {
                        return;
                    }
                    self.at += size.max(1);
                }
                _ => return,
            }
        }
    }

    /// The tokens of a JSX tag after its `<` or `</`, up to its `>` or to something in it that is
    /// not scanned like a tag.
    fn tag(&mut self, is_closing: bool) -> Mode {
        let mut is_after_slash = false;
        loop {
            self.trivia();
            let at = self.at;
            let Some(&first) = self.text.get(at) else {
                return Mode::Code;
            };
            match first {
                b'>' => {
                    self.punctuator(1);
                    if !is_closing && !is_after_slash {
                        return Mode::Children;
                    }
                    // Only an unfinished element leaves other frames above its own.
                    while let Some(frame) = self.frames.last() {
                        let kind = frame.kind;
                        self.leave();
                        if let FrameKind::Element(mode) = kind {
                            self.elements = self.elements.saturating_sub(1);
                            return mode;
                        }
                    }
                    return Mode::Code;
                }
                b'{' => {
                    self.punctuator(1);
                    self.enter(FrameKind::Container(Mode::OpeningTag));
                    return Mode::Code;
                }
                b'<' if self.marks.elements.has(at) => return self.open_element(Mode::OpeningTag),
                b'<' => {
                    self.punctuator(1);
                    self.enter(FrameKind::TypeArguments);
                    self.angles = 1;
                    return Mode::Code;
                }
                b'"' | b'\'' => {
                    self.token(TokenKind::JsxText, at, find_nearby(self.text, at + 1, [first]) + 1);
                }
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' | 0x80.. => self.jsx_name(),
                _ => self.punctuator(1),
            }
            is_after_slash = first == b'/';
        }
    }

    /// A name in a JSX tag, which can contain `-`.
    fn jsx_name(&mut self) {
        let (text, start) = (self.text, self.at);
        let mut end = start;
        loop {
            end = lexer::scan_identifier_parts(text, end);
            if self.byte(end) != b'-' {
                break;
            }
            end += 1;
        }
        if end == start {
            self.at += 1;
            return;
        }
        let mut kind = TokenKind::JsxIdentifier;
        if self.dialect == Dialect::TypeScript {
            let is_colon = |at: usize| self.byte(at) == b':';
            let is_after_colon = self.tokens.last().is_some_and(|last| is_colon(last.start as usize));
            if is_after_colon || is_colon(skip_trivia(text, end as u32) as usize) {
                kind = TokenKind::Identifier;
            } else if &text[start..end] == b"this" && !self.is_after_dot() && self.is_tag_name() {
                kind = TokenKind::Keyword;
            }
        }
        self.token(kind, start, end);
    }

    /// Whether the last token is the `<` or the `/` that the name of a tag follows.
    fn is_tag_name(&self) -> bool {
        self.tokens.last().is_some_and(|last| matches!(self.byte(last.start as usize), b'<' | b'/'))
    }

    /// The text between JSX tags, up to and including the `{` or the `<` that ends it.
    fn children(&mut self) -> Mode {
        let (text, start) = (self.text, self.at);
        let end = find(text, start, b"{<");
        if end > start {
            self.token(TokenKind::JsxText, start, end);
        }
        match text.get(end) {
            Some(b'{') => {
                self.punctuator(1);
                self.enter(FrameKind::Container(Mode::Children));
                Mode::Code
            }
            Some(_) => {
                self.punctuator(1);
                self.trivia();
                if self.byte(self.at) == b'/' {
                    self.punctuator(1);
                    return Mode::ClosingTag;
                }
                self.enter(FrameKind::Element(Mode::Children));
                self.elements += 1;
                Mode::OpeningTag
            }
            None => Mode::Code,
        }
    }
}
