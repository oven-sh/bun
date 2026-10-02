//! Parses what the parser proper only skips: types, and declarations that leave nothing behind at run time
//! (interfaces, aliases, `declare`, overload signatures, whole declaration files).
//!
//! It has a lexer of its own, which is pointed at a place in the source the parser has already accepted, so it neither
//! reports errors nor decides where anything ends. What it cannot make sense of becomes `TypeNodeKind::Error`.

use crate::Error;
use crate::lexer::{Lexer, T};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{self, *};

type R<T> = Result<T, Error>;

const MAX_DEPTH: u32 = 200;

pub(crate) struct Builder<'a> {
    pub(crate) file: hir::File,
    pub(crate) atoms: &'a Interner,
    /// The short names that were interned for this file, each at the place its spelling gives it. The last to come to a place has it.
    seen_names: Box<[std::cell::Cell<SeenName>]>,
    pub(crate) lexer: Lexer<'a>,
    /// The TypeScript syntax nodes the parser built.
    pub(crate) ts: bun_ast::ts_syntax::Syntax,
    /// Those nodes, keyed by start offset.
    pub(crate) kept: super::keep::KeptNodes,
    /// Parts of cloned nodes that the lowering still has to fill in.
    pub(crate) pending: Vec<super::clone_types::PendingPart>,
    depth: u32,
    /// The modifiers `parse_modifiers` last went over, in the order they are written, and where each is.
    pub(crate) modifiers: Vec<(Flags, u32)>,
    /// The class whose members are being parsed is a declaration that says `abstract`.
    pub(crate) in_abstract_class: bool,
    /// Those `member_header_at` found.
    pub(crate) header_modifiers: Vec<(Flags, u32)>,
    /// The modifiers of the statements being parsed, those of the innermost last.
    pub(crate) statement_modifiers: Vec<Modifier>,
    /// Where the statement being parsed has said `declare`, the first time.
    said_declare: Option<u32>,
    /// Directly in the block of a namespace or a module that is ambient.
    in_ambient_block: bool,
    /// Something has been said of the modifiers of the statement being parsed.
    modifiers_in_error: bool,
    /// The decorators of the class member `class_member_at` read last: where the member is, and the expression.
    pub(crate) member_decorators: Vec<(u32, ExprId)>,
    /// The parser has already reported the syntax errors, so a missing token does not stop the reader. False for declaration
    /// files, and inside `look_ahead` and `attempt`.
    pub(crate) tolerant: bool,
    /// How many classes what is being lowered is written in.
    pub(crate) classes_around: u32,
    /// `TypeSyntax::ambient_statements`, sorted by start.
    pub(crate) ambient_statements: Vec<(i32, i32, bun_ast::Stmt)>,
    /// `TypeSyntax::ambient_initializers`, sorted by the start of the binding.
    pub(crate) ambient_initializers: Vec<(i32, bun_ast::Expr)>,
    /// Empty statements that the lowering still has to turn into what the parser read there.
    pub(crate) pending_statements: Vec<(StmtId, bun_ast::Stmt)>,
    /// Variables whose initializer the lowering still has to fill in.
    pub(crate) pending_initializers: Vec<(VarDeclId, bun_ast::Expr)>,
    /// `IsInJSFile`
    pub(crate) is_js: bool,
    /// `NodeFlagsJSDoc`: the type being cloned is written in a JSDoc comment.
    pub(crate) in_jsdoc: bool,
    /// Where the first token of the statement being made is: a decorator, a modifier or its keyword.
    pub(crate) statement_start: u32,
    /// `Lexer::all_comments` of the parser, which has been through all of the file.
    pub(crate) comments: Vec<bun_ast::Range>,
}

/// A name of at most 16 bytes and its atom. The first bytes, the last bytes and the length say all there is to say of its spelling.
#[derive(Copy, Clone)]
struct SeenName {
    head: u64,
    tail: u64,
    /// 0 where there is no name.
    len_plus_one: u32,
    atom: Atom,
}

impl SeenName {
    const NONE: SeenName = SeenName {
        head: 0,
        tail: 0,
        len_plus_one: 0,
        atom: Atom(0),
    };
}

/// What modifiers are written on, as far as it matters to which are allowed.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Modified {
    Property,
    Method,
    Accessor,
    Constructor,
    ClassIndexSignature,
    IndexSignature,
    /// A property or a method of an interface or a type literal.
    TypeMember,
    Parameter,
}

/// `checkGrammarModifiers`, of TypeScript 7.0.2's grammarchecks.go, for the members of classes and types and for parameters:
/// the first thing that is wrong, where it is and the code it goes by.
pub(crate) fn modifier_error(
    modifiers: &[(Flags, u32)],
    on: Modified,
    in_abstract_class: bool,
    is_parent_ambient: bool,
    has_private_name: bool,
) -> Option<(u32, u32)> {
    const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);
    let mut seen = Flags::empty();
    let (mut last_static, mut last_override, mut last_async) = (0, 0, 0);
    let in_class = !matches!(
        on,
        Modified::IndexSignature | Modified::TypeMember | Modified::Parameter
    );
    for &(modifier, at) in modifiers {
        let error = |code: u32| Some((at, code));
        // One that is made from a JSDoc tag comes last wherever the tag is: nothing is said of the order.
        let is_written = !modifier.contains(Flags::REPARSED);
        let modifier = modifier.difference(Flags::REPARSED);
        if modifier != Flags::READONLY {
            if on == Modified::TypeMember {
                return error(1070);
            }
            if on == Modified::IndexSignature
                || on == Modified::ClassIndexSignature && modifier != Flags::STATIC
            {
                return error(1071);
            }
        }
        if modifier == Flags::CONST {
            // Reported on the declaration: `check_modifiers` moves it to the name.
            return error(1248);
        } else if modifier == Flags::IN || modifier == Flags::OUT {
            return error(1274);
        } else if modifier == Flags::EXPORT {
            if seen.contains(Flags::EXPORT) {
                return error(1030);
            } else if seen.intersects(Flags::AMBIENT | Flags::ABSTRACT | Flags::ASYNC) {
                return error(1029);
            } else if in_class {
                return error(1031);
            } else if on == Modified::Parameter {
                return error(1090);
            }
        } else if modifier == Flags::OVERRIDE {
            if seen.contains(Flags::OVERRIDE) {
                return error(1030);
            } else if seen.contains(Flags::AMBIENT) {
                return error(1243);
            } else if is_written
                && seen.intersects(Flags::READONLY | Flags::ACCESSOR | Flags::ASYNC)
            {
                return error(1029);
            }
            last_override = at;
        } else if ACCESSIBILITY.contains(modifier) {
            if seen.intersects(ACCESSIBILITY) {
                return error(1028);
            } else if is_written
                && seen.intersects(
                    Flags::OVERRIDE
                        | Flags::STATIC
                        | Flags::ACCESSOR
                        | Flags::READONLY
                        | Flags::ASYNC,
                )
            {
                return error(1029);
            } else if seen.contains(Flags::ABSTRACT) {
                if modifier == Flags::PRIVATE {
                    return error(1243);
                } else if is_written {
                    return error(1029);
                }
            } else if has_private_name {
                return error(18010);
            }
        } else if modifier == Flags::STATIC {
            if seen.contains(Flags::STATIC) {
                return error(1030);
            } else if seen.intersects(Flags::READONLY | Flags::ASYNC | Flags::ACCESSOR) {
                return error(1029);
            } else if on == Modified::Parameter {
                return error(1090);
            } else if seen.contains(Flags::ABSTRACT) {
                return error(1243);
            } else if seen.contains(Flags::OVERRIDE) {
                return error(1029);
            }
            last_static = at;
        } else if modifier == Flags::ACCESSOR {
            if seen.contains(Flags::ACCESSOR) {
                return error(1030);
            } else if seen.intersects(Flags::READONLY | Flags::AMBIENT) {
                return error(1243);
            } else if on != Modified::Property {
                return error(1275);
            }
        } else if modifier == Flags::READONLY {
            if seen.contains(Flags::READONLY) {
                return error(1030);
            } else if matches!(
                on,
                Modified::Method | Modified::Accessor | Modified::Constructor
            ) {
                return error(1024);
            } else if seen.contains(Flags::ACCESSOR) {
                return error(1243);
            }
        } else if modifier == Flags::AMBIENT {
            if seen.contains(Flags::AMBIENT) {
                return error(1030);
            } else if seen.intersects(Flags::ASYNC | Flags::OVERRIDE) {
                return error(1040);
            } else if in_class && on != Modified::Property {
                return error(1031);
            } else if on == Modified::Parameter {
                return error(1090);
            } else if has_private_name {
                return error(18019);
            } else if seen.contains(Flags::ACCESSOR) {
                return error(1243);
            }
        } else if modifier == Flags::ABSTRACT {
            if seen.contains(Flags::ABSTRACT) {
                return error(1030);
            }
            if !matches!(
                on,
                Modified::Method | Modified::Property | Modified::Accessor
            ) {
                return error(1242);
            }
            if !in_abstract_class {
                return error(if on == Modified::Property { 1253 } else { 1244 });
            }
            if seen.intersects(Flags::STATIC | Flags::PRIVATE) {
                return error(1243);
            }
            if seen.contains(Flags::ASYNC) {
                return Some((last_async, 1243));
            }
            if seen.intersects(Flags::OVERRIDE | Flags::ACCESSOR) {
                return error(1029);
            }
            if has_private_name {
                return error(18019);
            }
        } else if modifier == Flags::ASYNC {
            if seen.contains(Flags::ASYNC) {
                return error(1030);
            } else if seen.contains(Flags::AMBIENT) || is_parent_ambient {
                return error(1040);
            } else if on == Modified::Parameter {
                return error(1090);
            }
            if seen.contains(Flags::ABSTRACT) {
                return error(1243);
            }
            last_async = at;
        }
        seen |= modifier;
    }
    if on == Modified::Constructor {
        return if seen.contains(Flags::STATIC) {
            Some((last_static, 1089))
        } else if seen.contains(Flags::OVERRIDE) {
            Some((last_override, 1089))
        } else if seen.contains(Flags::ASYNC) {
            Some((last_async, 1089))
        } else {
            None
        };
    }
    // `checkGrammarAsyncModifier`
    (seen.contains(Flags::ASYNC) && on != Modified::Method).then_some((last_async, 1042))
}

/// What `Builder::parse_parameter_list` read.
struct ParameterList {
    params: Vec<Param>,
    /// Where the comma right before the closing token is.
    trailing_comma: Option<u32>,
    /// Where the `...` of the first parameter is, if it has `Flags::REST`.
    first_rest: u32,
    /// Where the `?` of the first parameter is, if it has `Flags::OPTIONAL`.
    first_question: u32,
    first_has_modifiers: bool,
}

impl<'a> Builder<'a> {
    pub(crate) fn new(mut lexer: Lexer<'a>, atoms: &'a Interner) -> Self {
        lexer.is_log_disabled = true;
        // Scans malformed tokens the way the parser's lexer did.
        lexer.tolerant = true;
        let is_js = lexer.is_javascript_file();
        // A power of two, and more than a file of this length has different names.
        let names = (lexer.contents.len() / 16)
            .next_power_of_two()
            .clamp(64, 2048);
        Builder {
            file: hir::File::default(),
            atoms,
            seen_names: vec![std::cell::Cell::new(SeenName::NONE); names].into_boxed_slice(),
            lexer,
            ts: Default::default(),
            kept: Default::default(),
            pending: Vec::new(),
            depth: 0,
            modifiers: Vec::new(),
            in_abstract_class: false,
            header_modifiers: Vec::new(),
            statement_modifiers: Vec::new(),
            said_declare: None,
            in_ambient_block: false,
            modifiers_in_error: false,
            member_decorators: Vec::new(),
            tolerant: true,
            classes_around: 0,
            ambient_statements: Vec::new(),
            ambient_initializers: Vec::new(),
            pending_statements: Vec::new(),
            pending_initializers: Vec::new(),
            is_js,
            in_jsdoc: false,
            statement_start: 0,
            comments: Vec::new(),
        }
    }

    /// Makes the token that starts at `offset` the current one.
    pub(crate) fn seek(&mut self, offset: u32) -> R<()> {
        self.lexer.current = offset as usize;
        self.lexer.end = offset as usize;
        self.lexer.start = offset as usize;
        self.lexer.step();
        self.lexer.next()?;
        Ok(())
    }

    #[inline]
    fn pos(&self) -> u32 {
        self.lexer.loc().start as u32
    }

    /// Reuses a node the parser already built at the current position and moves the lexer past it.
    fn reuse_kept<X: Copy>(&mut self, kept: Option<super::keep::KeptNode<X>>) -> R<Option<X>> {
        let Some(kept) = kept else { return Ok(None) };
        self.seek(kept.end)?;
        self.lexer.has_newline_before = kept.newline_before_end;
        Ok(Some(kept.node))
    }

    #[inline]
    fn tok(&self) -> T {
        self.lexer.token
    }

    #[inline]
    fn next(&mut self) -> R<()> {
        Ok(self.lexer.next()?)
    }

    #[inline]
    fn expect(&mut self, t: T) -> R<()> {
        if self.lexer.token != t {
            // `parseExpected`: nothing is consumed.
            return if self.tolerant {
                Ok(())
            } else {
                Err(Error::SyntaxError)
            };
        }
        self.next()
    }

    #[inline]
    fn eat(&mut self, t: T) -> R<bool> {
        if self.lexer.token == t {
            self.next()?;
            return Ok(true);
        }
        Ok(false)
    }

    #[inline]
    fn is_kw(&self, text: &'static [u8]) -> bool {
        self.lexer.is_contextual_keyword(text)
    }

    fn eat_kw(&mut self, text: &'static [u8]) -> R<bool> {
        if self.is_kw(text) {
            self.next()?;
            return Ok(true);
        }
        Ok(false)
    }

    /// `parseExpected` of a contextual keyword, like `expect`.
    fn expect_kw(&mut self, text: &'static [u8]) -> R<()> {
        if self.eat_kw(text)? || self.tolerant {
            Ok(())
        } else {
            Err(Error::SyntaxError)
        }
    }

    pub(crate) fn atom(&self, text: &[u8]) -> Atom {
        let len = text.len();
        // The first bytes and the last, which may overlap.
        let (head, tail) = match len {
            0 => (0, 0),
            1..=3 => (
                u64::from(text[0]),
                u64::from(text[len / 2]) << 8 | u64::from(text[len - 1]),
            ),
            4..=7 => (
                u64::from(u32::from_le_bytes(text[..4].try_into().unwrap())),
                u64::from(u32::from_le_bytes(text[len - 4..].try_into().unwrap())),
            ),
            8..=16 => (
                u64::from_le_bytes(text[..8].try_into().unwrap()),
                u64::from_le_bytes(text[len - 8..].try_into().unwrap()),
            ),
            _ => return self.atoms.intern(text),
        };
        let hash = (head ^ tail.rotate_left(23) ^ len as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        let place = &self.seen_names[(hash >> 40) as usize & (self.seen_names.len() - 1)];
        let seen = place.get();
        if seen.head == head && seen.tail == tail && seen.len_plus_one == len as u32 + 1 {
            return seen.atom;
        }
        self.intern_unseen(text, head, tail, place)
    }

    #[inline(never)]
    fn intern_unseen(
        &self,
        text: &[u8],
        head: u64,
        tail: u64,
        place: &std::cell::Cell<SeenName>,
    ) -> Atom {
        let atom = self.atoms.intern(text);
        place.set(SeenName {
            head,
            tail,
            len_plus_one: text.len() as u32 + 1,
            atom,
        });
        atom
    }

    /// The spelling of the current identifier or keyword.
    fn name_text(&self) -> &'a [u8] {
        if self.lexer.token == T::TIdentifier {
            self.lexer.identifier
        } else {
            self.lexer.raw()
        }
    }

    fn ident_or_keyword(&mut self) -> R<Atom> {
        if !self.lexer.is_identifier_or_keyword() {
            return Err(Error::SyntaxError);
        }
        let atom = self.atom(self.name_text());
        self.next()?;
        Ok(atom)
    }

    fn string_value(&mut self) -> R<Atom> {
        let s = self.lexer.to_utf8_e_string()?;
        Ok(self.atom(s.slice8()))
    }

    fn semicolon(&mut self) -> R<()> {
        if self.tok() == T::TSemicolon {
            return self.next();
        }
        if self.lexer.has_newline_before || matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
            return Ok(());
        }
        // `parseSemicolon`: nothing is consumed.
        if self.tolerant {
            Ok(())
        } else {
            Err(Error::SyntaxError)
        }
    }

    /// Runs `f` and puts the lexer back where it was.
    fn look_ahead<X>(&mut self, f: impl FnOnce(&mut Self) -> R<X>) -> Option<X> {
        let snapshot = self.lexer.snapshot();
        let tolerant = std::mem::replace(&mut self.tolerant, false);
        let result = f(self);
        self.tolerant = tolerant;
        self.lexer.restore(&snapshot);
        result.ok()
    }

    /// Runs `f`, and puts the lexer back where it was unless it gives something.
    fn attempt<X>(&mut self, f: impl FnOnce(&mut Self) -> R<Option<X>>) -> Option<X> {
        let snapshot = self.lexer.snapshot();
        let tolerant = std::mem::replace(&mut self.tolerant, false);
        let result = f(self);
        self.tolerant = tolerant;
        match result {
            Ok(Some(x)) => Some(x),
            _ => {
                self.lexer.restore(&snapshot);
                None
            }
        }
    }

    fn enter(&mut self) -> R<()> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(Error::StackOverflow);
        }
        Ok(())
    }

    pub(crate) fn number_name(&self, n: f64) -> Atom {
        self.atom(bun_sema::atom::number_to_string(n).as_bytes())
    }

    // ───────────────────────────── entry points ─────────────────────────────

    /// The type that starts at `offset`.
    pub(crate) fn type_at(&mut self, offset: u32) -> TypeNodeId {
        self.depth = 0;
        match self.seek(offset).and_then(|()| self.parse_type()) {
            Ok(ty) => ty,
            Err(_) => self.error_type(offset),
        }
    }

    /// The value of the string literal at `offset`. `NONE` if there is none.
    pub(crate) fn string_at(&mut self, offset: u32) -> Atom {
        match self.seek(offset) {
            Ok(()) if self.tok() == T::TStringLiteral => self.string_value().unwrap_or(Atom::NONE),
            _ => Atom::NONE,
        }
    }

    /// The return type that starts at `offset`: it may be a type predicate.
    pub(crate) fn return_type_at(&mut self, offset: u32) -> TypeNodeId {
        self.depth = 0;
        let result = self.seek(offset).and_then(|()| {
            self.eat(T::TColon)?;
            self.parse_type()
        });
        match result {
            Ok(ty) => ty,
            Err(_) => self.error_type(offset),
        }
    }

    fn error_type(&mut self, offset: u32) -> TypeNodeId {
        if self.file.syntax_errors == 0 {
            self.file.error_pos = self.pos();
        }
        self.file.syntax_errors += 1;
        self.file.ty(TypeNodeKind::Error, offset)
    }

    /// The type parameters of the arrow function at `offset`: `<T>(a) => b`, `async <T>(a) => b`.
    pub(crate) fn arrow_type_params_at(&mut self, offset: u32) -> Span<TypeParamId> {
        self.depth = 0;
        self.seek(offset)
            .and_then(|()| {
                self.eat_kw(b"async")?;
                if self.tok() == T::TLessThan {
                    self.parse_type_params()
                } else {
                    Ok(Span::EMPTY)
                }
            })
            .unwrap_or(Span::EMPTY)
    }

    /// The type parameters of the class whose `class` keyword is at `offset`.
    pub(crate) fn class_type_params_at(&mut self, offset: u32) -> Span<TypeParamId> {
        self.depth = 0;
        self.seek(offset)
            .and_then(|()| {
                self.expect(T::TClass)?;
                if self.tok() == T::TIdentifier && !self.is_implements_clause() {
                    self.next()?;
                }
                if self.tok() == T::TLessThan {
                    self.parse_type_params()
                } else {
                    Ok(Span::EMPTY)
                }
            })
            .unwrap_or(Span::EMPTY)
    }

    /// The modifiers of the class member that starts at `offset`, and the annotation if it is a field.
    pub(crate) fn member_header_at(&mut self, offset: u32) -> (Flags, TypeNodeId) {
        self.depth = 0;
        let mut flags = Flags::empty();
        let result = self.seek(offset).and_then(|()| {
            while self.tok() == T::TAt {
                self.skip_decorator()?;
            }
            flags = self.parse_modifiers()?;
            self.header_modifiers = std::mem::take(&mut self.modifiers);
            if self.tok() == T::TIdentifier && matches!(self.lexer.identifier, b"get" | b"set") {
                let is_accessor = self
                    .look_ahead(|p| {
                        p.next()?;
                        Ok(p.lexer.is_identifier_or_keyword()
                            || matches!(
                                p.tok(),
                                T::TStringLiteral
                                    | T::TNumericLiteral
                                    | T::TBigIntegerLiteral
                                    | T::TOpenBracket
                                    | T::TPrivateIdentifier
                            ))
                    })
                    .unwrap_or(false);
                if is_accessor {
                    return Ok(TypeNodeId::NONE);
                }
            }
            self.eat(T::TAsterisk)?;
            if self.tok() == T::TOpenBracket {
                self.skip_balanced()?
            } else {
                self.next()?
            }
            if self.eat(T::TQuestion)? {
                flags |= Flags::OPTIONAL;
            } else if self.eat(T::TExclamation)? {
                flags |= Flags::DEFINITE;
            }
            if self.eat(T::TColon)? {
                self.parse_type()
            } else {
                Ok(TypeNodeId::NONE)
            }
        });
        match result {
            Ok(ty) => (flags, ty),
            Err(_) => (flags, self.error_type(offset)),
        }
    }

    /// `<A, B extends C = D>` at `offset`.
    pub(crate) fn type_params_at(&mut self, offset: u32) -> Span<TypeParamId> {
        self.depth = 0;
        self.seek(offset)
            .and_then(|()| self.parse_type_params())
            .unwrap_or(Span::EMPTY)
    }

    /// `<A, B>` at `offset`.
    pub(crate) fn type_args_at(&mut self, offset: u32) -> IdList<TypeNodeId> {
        self.depth = 0;
        self.seek(offset)
            .and_then(|()| self.parse_type_args())
            .unwrap_or(IdList::EMPTY)
    }

    /// The `A.B` at `offset`: an element of an `extends` clause, without its type arguments.
    pub(crate) fn member_expr_at(&mut self, offset: u32) -> Option<ExprId> {
        self.depth = 0;
        self.seek(offset)
            .and_then(|()| self.parse_member_expr())
            .ok()
    }

    /// `A, B<C>` at `offset`: what follows `implements`.
    pub(crate) fn type_list_at(&mut self, offset: u32) -> IdList<TypeNodeId> {
        self.depth = 0;
        let mut list = Vec::new();
        let result = self.seek(offset).and_then(|()| {
            // `parseDelimitedList(PCHeritageClauseElement)`: it goes on after a missing comma, which the parser reported.
            while self.is_heritage_element() {
                list.push(self.parse_implemented()?);
                if !self.eat(T::TComma)? && (!self.tolerant || self.is_end_of_heritage_list()) {
                    break;
                }
            }
            Ok(())
        });
        if result.is_err() {
            return IdList::EMPTY;
        }
        self.file.list(&list)
    }

    /// The statement at `offset`, which the parser dropped or kept only part of. May be several (`namespace A.B`
    /// is one; `declare const a, b` is one).
    pub(crate) fn statement_at(&mut self, offset: u32, flags: Flags) -> Option<StmtId> {
        self.depth = 0;
        self.start_statement(false);
        self.statement_modifiers.clear();
        let statement = self
            .seek(offset)
            .and_then(|()| self.parse_statement(flags))
            .ok()?;
        self.take_statement_modifiers(statement, 0);
        Some(statement)
    }

    /// The word the lexer is at is a modifier of the statement being parsed, or the `export` of an export declaration or assignment,
    /// or the `default` after it.
    fn push_statement_modifier(&mut self, flag: Flags) {
        let pos = self.pos();
        self.statement_modifiers.push(Modifier {
            kind: ModifierKind::Keyword(flag),
            pos,
        });
    }

    /// `modifiers` as a `ModifierList`.
    pub(crate) fn add_modifier_list(&mut self, modifiers: &[(Flags, u32)]) -> Span<ModifierId> {
        let start = self.file.modifiers.len() as u32;
        self.file
            .modifiers
            .extend(modifiers.iter().map(|&(flag, pos)| Modifier {
                kind: ModifierKind::Keyword(flag),
                pos,
            }));
        Span::new(start, modifiers.len() as u32)
    }

    /// `statement` has the modifiers that were come upon since there were `base` of them. Its own `export` and `default` are none.
    pub(crate) fn take_statement_modifiers(&mut self, statement: StmtId, base: usize) {
        let own_keywords = match self.file[statement].kind {
            StmtKind::ExportDefault(_) => 2,
            StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => 1,
            _ => 0,
        };
        let end = self
            .statement_modifiers
            .len()
            .saturating_sub(own_keywords)
            .max(base);
        if end > base {
            let list = self
                .file
                .add_modifiers(&self.statement_modifiers[base..end]);
            self.file[statement].modifiers = list;
        }
        self.statement_modifiers.truncate(base);
    }

    /// The `B` of `namespace A.B { }`, from the dot at `offset` (`parseModuleOrNamespaceDeclaration`).
    pub(crate) fn nested_module_at(&mut self, offset: u32) -> Option<StmtId> {
        self.depth = 0;
        self.start_statement(false);
        self.seek(offset)
            .and_then(|()| self.expect(T::TDot))
            .and_then(|()| {
                let pos = self.pos();
                self.parse_module(pos, Flags::EXPORT)
            })
            .ok()
    }

    /// Before a statement that is not part of another: nothing has been made of its modifiers yet. One that was given up on leaves
    /// all this as it was where it was.
    fn start_statement(&mut self, in_ambient_block: bool) {
        (
            self.in_ambient_block,
            self.said_declare,
            self.modifiers_in_error,
        ) = (in_ambient_block, None, false);
    }

    /// A member of a class that has nothing to run: an overload, an index signature, `declare x`, `abstract m()`.
    pub(crate) fn class_member_at(&mut self, offset: u32, ambient: bool) -> Option<Member> {
        self.depth = 0;
        self.member_decorators.clear();
        let flags = if ambient {
            Flags::AMBIENT
        } else {
            Flags::empty()
        };
        self.seek(offset)
            .and_then(|()| self.parse_member(flags))
            .ok()
    }

    /// A whole declaration file. `tolerant`: the caller reports the parser's syntax errors. Otherwise they are not read, so a syntax
    /// error has to fail here.
    pub(crate) fn declaration_file(&mut self, tolerant: bool) {
        self.file.kind = FileKind::Declaration;
        self.tolerant = tolerant;
        self.scan_references();
        let mut stmts = Vec::new();
        let result = self.seek(0).and_then(|()| {
            if self.tok() == T::THashbang {
                self.next()?;
            }
            while self.tok() != T::TEndOfFile {
                // `abortParsingListOrMoveToNextToken`: the parser has reported it (1128).
                if tolerant && self.tok() == T::TCloseBrace {
                    self.next()?;
                    continue;
                }
                self.depth = 0;
                self.start_statement(false);
                let start = self.pos();
                self.statement_start = start;
                let statement = self.parse_statement(Flags::AMBIENT)?;
                self.finish_statement(statement, start);
                self.take_statement_modifiers(statement, 0);
                stmts.push(statement);
                if self.pos() == start {
                    return Err(Error::SyntaxError);
                }
            }
            Ok(())
        });
        self.file.has_errors = result.is_err();
        if result.is_err() {
            self.file.error_pos = self.pos();
        }
        self.file.body = self.file.list(&stmts);
        self.file.parens.sort_unstable_by_key(|p| p.0.0);
    }

    /// Forgets all that was read, to read the file again.
    pub(crate) fn start_over(&mut self) {
        self.file = hir::File {
            source_len: self.file.source_len,
            ..Default::default()
        };
        self.pending.clear();
        self.pending_statements.clear();
        self.pending_initializers.clear();
        self.modifiers.clear();
        self.statement_modifiers.clear();
        self.header_modifiers.clear();
        self.member_decorators.clear();
        self.in_abstract_class = false;
    }

    /// `processCommentDirective`: `@ts-ignore` and `@ts-expect-error` at the start of a `//` comment, or of the last line of a `/* */`
    /// one. Nothing is reported in the next line that is neither empty nor a `//` comment.
    fn scan_suppressions(&mut self) {
        let text = self.lexer.contents;
        let line_end = |i: usize| {
            bun_core::strings::index_of_char(&text[i..], b'\n')
                .map_or(text.len(), |n| i + n as usize)
        };
        // Whether a `/* */` comment is still open at `i`.
        let in_comment = |i: usize| {
            bun_core::strings::last_index_of(&text[..i], b"/*").is_some_and(|open| {
                bun_core::strings::index_of(&text[open + 2..i], b"*/").is_none()
            })
        };
        let mut from = 0;
        while let Some(found) = bun_core::strings::index_of(&text[from..], b"@ts-") {
            let at = from + found;
            from = at + 4;
            if !(text[from..].starts_with(b"ignore") || text[from..].starts_with(b"expect-error")) {
                continue;
            }
            let line_start =
                bun_core::strings::last_index_of_char(&text[..at], b'\n').map_or(0, |i| i + 1);
            // What is before it in its line, less the blanks: `before`, and then `opener`, which is nothing but `/` and `*`.
            let lead = text[line_start..at].trim_ascii_end();
            let marks = lead
                .iter()
                .rev()
                .take_while(|&&c| c == b'/' || c == b'*')
                .count();
            let (before, opener) = lead.split_at(lead.len() - marks);
            let slashes = opener.iter().rev().take_while(|&&c| c == b'/').count();
            let closes_here = bun_core::strings::index_of(&text[at..line_end(at)], b"*/").is_some();
            let is_directive = if slashes >= 2 && slashes == marks {
                // After `//` only more of `/` is passed over.
                true
            } else if slashes >= 3 && in_comment(line_start + lead.len() - slashes - 1) {
                // `*/`, which ends one comment, and then `//`.
                true
            } else if opener.starts_with(b"/*") {
                // Its first line is its last.
                closes_here
            } else {
                // The last line of a comment that was opened in an earlier one: any `/` and `*` are passed over.
                closes_here && before.trim_ascii().is_empty() && in_comment(line_start)
            };
            if !is_directive {
                continue;
            }
            let mut start = line_end(at);
            loop {
                if start >= text.len() {
                    break;
                }
                start += 1;
                let end = line_end(start);
                let line = text[start..end].trim_ascii();
                if !line.is_empty() && !line.starts_with(b"//") {
                    self.file.suppressed.push((start as u32, end as u32));
                    break;
                }
                start = end;
            }
        }
    }

    /// `/// <reference path="..." />` and its like, in the comments at the top of the file.
    pub(crate) fn scan_references(&mut self) {
        let text = self.lexer.contents;
        self.scan_suppressions();
        let mut i = 0;
        // `#!/usr/bin/env node`
        if text.starts_with(b"#!") {
            i = bun_core::strings::index_of_char(text, b'\n').map_or(text.len(), |n| n as usize);
        }
        while i < text.len() {
            while i < text.len() && text[i].is_ascii_whitespace() {
                i += 1;
            }
            if text[i..].starts_with(b"/*") {
                match bun_core::strings::index_of(&text[i + 2..], b"*/") {
                    Some(end) => i += 2 + end + 2,
                    None => return,
                }
                continue;
            }
            if !text[i..].starts_with(b"//") {
                return;
            }
            let end = bun_core::strings::index_of_char(&text[i..], b'\n')
                .map_or(text.len(), |n| i + n as usize);
            self.scan_reference(i, end);
            i = end;
        }
    }

    /// What the `//` comment from `start` to `end` refers to, if it is `/// <reference name="value" name = 'value' />`.
    fn scan_reference(&mut self, start: usize, end: usize) {
        let text = self.lexer.contents;
        let comment = &text[start..end];
        // `extractPragmas`
        let blanks = |at: usize| {
            at + comment[at..]
                .iter()
                .take_while(|&&c| c == b' ' || c == b'\t')
                .count()
        };
        let word = |at: usize| {
            at + comment[at..]
                .iter()
                .take_while(|&&c| c.is_ascii_alphabetic() || c == b'-')
                .count()
        };
        if !comment.starts_with(b"///") {
            return;
        }
        let open = blanks(3);
        if comment.get(open) != Some(&b'<') {
            return;
        }
        let mut at = word(open + 1);
        if !comment[open + 1..at].eq_ignore_ascii_case(b"reference") {
            return;
        }
        const NAMES: [&[u8]; 5] = [
            b"types",
            b"lib",
            b"path",
            b"resolution-mode",
            b"no-default-lib",
        ];
        // From where to where the value of each is. Of two that go by one name the last counts.
        let mut values: [Option<(usize, usize)>; 5] = [None; 5];
        loop {
            at = blanks(at);
            let name_end = word(at);
            let equals = blanks(name_end);
            if name_end == at || comment.get(equals) != Some(&b'=') {
                break;
            }
            let quote_at = blanks(equals + 1);
            let Some(&quote) = comment.get(quote_at) else {
                break;
            };
            if quote != b'"' && quote != b'\'' {
                break;
            }
            let Some(len) = comment[quote_at + 1..].iter().position(|&c| c == quote) else {
                break;
            };
            if let Some(n) = NAMES
                .iter()
                .position(|name| comment[at..name_end].eq_ignore_ascii_case(name))
            {
                values[n] = Some((quote_at + 1, quote_at + 1 + len));
            }
            at = quote_at + len + 2;
        }
        // `processPragmasIntoFields`: one thing is referred to. `types` goes before `lib`, and `lib` before `path`.
        let [types, lib, path, mode, no_default_lib] = values;
        if no_default_lib.is_some_and(|(from, to)| &comment[from..to] == b"true") {
            return;
        }
        let (kind, (from, to)) = match (types, lib, path) {
            (Some(value), ..) => (ReferenceKind::Types, value),
            (None, Some(value), _) => (ReferenceKind::Lib, value),
            (None, None, Some(value)) => (ReferenceKind::Path, value),
            (None, None, None) => {
                self.file.early_errors.push((start as u32, 1084));
                return;
            }
        };
        // `parseResolutionMode`
        let mode = match mode.filter(|_| kind == ReferenceKind::Types) {
            Some((from, to)) => match &comment[from..to] {
                b"import" => ResolutionMode::Import,
                b"require" => ResolutionMode::Require,
                _ => {
                    self.file.early_errors.push(((start + from) as u32, 1453));
                    ResolutionMode::None
                }
            },
            None => ResolutionMode::None,
        };
        let value = self.atom(&comment[from..to]);
        self.file
            .references
            .push((kind, value, (start + from) as u32, mode));
    }

    // ───────────────────────────── types ─────────────────────────────

    /// The type at the current position. The parser built it.
    pub(crate) fn parse_type(&mut self) -> R<TypeNodeId> {
        let kept = self.kept.types.get(&(self.pos() as i32)).copied();
        let ty = self.reuse_kept(kept)?.ok_or(Error::SyntaxError)?;
        Ok(self.clone_type(ty))
    }

    /// Over a bracketed group, whatever is in it.
    fn skip_balanced(&mut self) -> R<()> {
        let mut depth = 0u32;
        loop {
            match self.tok() {
                T::TOpenBrace | T::TOpenBracket | T::TOpenParen => depth += 1,
                T::TCloseBrace | T::TCloseBracket | T::TCloseParen => {
                    depth -= 1;
                    if depth == 0 {
                        return self.next();
                    }
                }
                T::TEndOfFile => return Err(Error::SyntaxError),
                _ => {}
            }
            self.next()?;
        }
    }

    /// `<T>(a: A, b?: B)`
    fn parse_signature_head(&mut self) -> R<(Span<TypeParamId>, u32, Span<ParamId>)> {
        let type_params = if self.tok() == T::TLessThan {
            self.parse_type_params()?
        } else {
            Span::EMPTY
        };
        let anchor = self.pos();
        Ok((type_params, anchor, self.parse_params()?))
    }

    fn keyword(&mut self, k: Keyword, pos: u32) -> R<TypeNodeId> {
        self.next()?;
        Ok(self.file.ty(TypeNodeKind::Keyword(k), pos))
    }

    /// `GetResolutionModeOverride`, at the `{` of import attributes: what `{ "resolution-mode": "import" }` says, if that is the one
    /// attribute there is.
    fn resolution_mode_override(&mut self) -> ResolutionMode {
        self.look_ahead(|p| {
            p.next()?;
            if p.tok() != T::TStringLiteral {
                return Ok(ResolutionMode::None);
            }
            let name = p.string_value()?;
            p.next()?;
            if !p.eat(T::TColon)?
                || !matches!(
                    p.tok(),
                    T::TStringLiteral | T::TNoSubstitutionTemplateLiteral
                )
            {
                return Ok(ResolutionMode::None);
            }
            let value = p.string_value()?;
            p.next()?;
            p.eat(T::TComma)?;
            if p.tok() != T::TCloseBrace || name != p.atom(b"resolution-mode") {
                return Ok(ResolutionMode::None);
            }
            Ok(if value == p.atom(b"import") {
                ResolutionMode::Import
            } else if value == p.atom(b"require") {
                ResolutionMode::Require
            } else {
                ResolutionMode::None
            })
        })
        .unwrap_or(ResolutionMode::None)
    }

    /// `A.B.C`
    fn parse_entity_name(&mut self, allow_private: bool) -> R<IdList<Atom>> {
        let mut names = vec![self.ident_or_keyword()?];
        while self.tok() == T::TDot {
            self.next()?;
            if allow_private && self.tok() == T::TPrivateIdentifier {
                names.push(self.atom(self.lexer.identifier));
                self.next()?;
            } else if self.tolerant && self.is_name_after_dot_missing() {
                // The name stays qualified. The parser reported 1003.
                names.push(known::empty);
            } else {
                names.push(self.ident_or_keyword()?);
            }
        }
        Ok(self.file.list(&names))
    }

    /// `parseRightSideOfDot`: no name follows the dot, or the word on the next line starts something else.
    fn is_name_after_dot_missing(&mut self) -> bool {
        !self.lexer.is_identifier_or_keyword()
            || self.lexer.has_newline_before
                && self.look_ahead(|p| {
                    p.next()
                        .map(|()| p.lexer.is_identifier_or_keyword() && !p.lexer.has_newline_before)
                }) == Some(true)
    }

    fn parse_type_reference(&mut self) -> R<TypeNodeId> {
        let pos = self.pos();
        let kept = self.kept.types.get(&(pos as i32)).copied();
        if let Some(ty) = self.reuse_kept(kept)? {
            // In a heritage clause `string` is an entity name, not the keyword type.
            if let bun_ast::ts_syntax::TypeData::Keyword(keyword) = self.ts[ty].data {
                let name = self.atom(super::keep::keyword_text(keyword));
                let name = self.file.list(&[name]);
                return Ok(self.file.ty(
                    TypeNodeKind::Ref {
                        name,
                        args: IdList::EMPTY,
                    },
                    pos,
                ));
            }
            return Ok(self.clone_type(ty));
        }
        let name = self.parse_entity_name(false)?;
        let args = if !self.lexer.has_newline_before
            && matches!(self.tok(), T::TLessThan | T::TLessThanLessThan)
        {
            self.parse_type_args()?
        } else {
            IdList::EMPTY
        };
        Ok(self.file.ty(TypeNodeKind::Ref { name, args }, pos))
    }

    /// `<A, B>` at the current position. The parser built it.
    pub(crate) fn parse_type_args(&mut self) -> R<IdList<TypeNodeId>> {
        let kept = self.kept.type_arguments.get(&(self.pos() as i32)).copied();
        let arguments = self.reuse_kept(kept)?.ok_or(Error::SyntaxError)?;
        Ok(self.clone_type_list(arguments))
    }

    /// `<T, U>` at the current position. The parser built it.
    pub(crate) fn parse_type_params(&mut self) -> R<Span<TypeParamId>> {
        let kept = self.kept.type_parameters.get(&(self.pos() as i32)).copied();
        let parameters = self.reuse_kept(kept)?.ok_or(Error::SyntaxError)?;
        Ok(self.clone_type_params(parameters))
    }

    // ───────────────────────────── members ─────────────────────────────

    /// The members of the interface whose `{` is at the current position. The parser built them.
    fn interface_members(&mut self) -> R<Span<MemberId>> {
        match self.kept.object_types.get(&(self.pos() as i32)) {
            Some(&kept) => match kept.node {
                super::keep::ObjectTypeBody::Members(members) => {
                    self.reuse_kept(Some(kept))?;
                    Ok(self.clone_members(members))
                }
                super::keep::ObjectTypeBody::Mapped(_) => Err(Error::SyntaxError),
            },
            None => Err(Error::SyntaxError),
        }
    }

    /// `{ ... }` of a class.
    fn parse_class_members(&mut self, flags: Flags) -> R<Span<MemberId>> {
        self.enter()?;
        self.expect(T::TOpenBrace)?;
        let mut members = Vec::new();
        while !matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
            if self.eat(T::TSemicolon)? || self.eat(T::TComma)? {
                continue;
            }
            if self.tolerant
                && !(self.is_literal_property_name()
                    || matches!(self.tok(), T::TOpenBracket | T::TAsterisk | T::TAt))
            {
                // `abortParsingListOrMoveToNextToken`
                if !(self.is_skipped_in_recovery()
                    || matches!(self.tok(), T::TQuestion | T::TCloseParen | T::TCloseBracket))
                {
                    break;
                }
                self.next()?;
                continue;
            }
            members.push(self.parse_member(flags)?);
        }
        self.expect(T::TCloseBrace)?;
        self.depth -= 1;
        Ok(self.file.add_members(&members))
    }

    /// A word that is a modifier if what follows on the same line could be the rest of a member.
    fn parse_modifiers(&mut self) -> R<Flags> {
        self.parse_modifiers_ex(true)
    }

    /// `parseModifiersEx`. `const`, `export`, `in` and `out` go into `self.modifiers` only, not into the flags returned.
    fn parse_modifiers_ex(&mut self, permit_const: bool) -> R<Flags> {
        let mut flags = Flags::empty();
        self.modifiers.clear();
        loop {
            let flag = match self.tok() {
                T::TConst if permit_const => Flags::CONST,
                T::TExport => Flags::EXPORT,
                T::TIn => Flags::IN,
                T::TIdentifier => match self.lexer.identifier {
                    b"out" => Flags::OUT,
                    b"readonly" => Flags::READONLY,
                    b"public" => Flags::PUBLIC,
                    b"private" => Flags::PRIVATE,
                    b"protected" => Flags::PROTECTED,
                    b"static" => Flags::STATIC,
                    b"abstract" => Flags::ABSTRACT,
                    b"declare" => Flags::AMBIENT,
                    b"override" => Flags::OVERRIDE,
                    b"accessor" => Flags::ACCESSOR,
                    b"async" => Flags::ASYNC,
                    _ => break,
                },
                _ => break,
            };
            // `tryParseModifier`: after one `static`, another is a name.
            if flag == Flags::STATIC && flags.contains(Flags::STATIC) {
                break;
            }
            // `nextTokenCanFollowModifier`
            let is_modifier = if flag == Flags::EXPORT {
                self.is_export_modifier()
            } else {
                self.look_ahead(|p| {
                    p.next()?;
                    if p.lexer.has_newline_before && flag != Flags::STATIC {
                        return Ok(false);
                    }
                    Ok(p.lexer.is_identifier_or_keyword()
                        || matches!(
                            p.tok(),
                            T::TStringLiteral
                                | T::TNumericLiteral
                                | T::TBigIntegerLiteral
                                | T::TOpenBracket
                                | T::TPrivateIdentifier
                                | T::TAsterisk
                                | T::TDotDotDot
                                | T::TOpenBrace
                        ))
                })
                .unwrap_or(false)
            };
            if !is_modifier {
                break;
            }
            if !flag.intersects(Flags::CONST | Flags::EXPORT | Flags::IN | Flags::OUT) {
                flags |= flag;
            }
            self.modifiers.push((flag, self.pos()));
            self.next()?;
        }
        Ok(flags)
    }

    /// Says what is wrong with `modifiers`, if anything is. `name_pos`: where the name of what they are written on is.
    pub(crate) fn check_modifiers(
        &mut self,
        modifiers: &[(Flags, u32)],
        on: Modified,
        is_parent_ambient: bool,
        has_private_name: bool,
        name_pos: u32,
    ) {
        if let Some((at, code)) = modifier_error(
            modifiers,
            on,
            self.in_abstract_class,
            is_parent_ambient,
            has_private_name,
        ) {
            // 1248 is reported on the declaration, whose error span is its name.
            self.file
                .early_errors
                .push((if code == 1248 { name_pos } else { at }, code));
        }
    }

    fn signature_fn(
        &mut self,
        kind: FnKind,
        flags: Flags,
        name: Atom,
        name_pos: u32,
        start: u32,
    ) -> R<FnId> {
        let pos = name_pos;
        let (type_params, anchor, params) = self.parse_signature_head()?;
        let (this_param, params) = self.file.split_this_parameter(params);
        let ret = if self.eat(T::TColon)? {
            self.parse_type()?
        } else {
            TypeNodeId::NONE
        };
        Ok(self.file.add_fn(Func {
            kind,
            flags,
            name,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor,
            pos,
            start,
        }))
    }

    fn end_member(&mut self) -> R<()> {
        if self.eat(T::TSemicolon)? || self.eat(T::TComma)? {
            return Ok(());
        }
        if self.lexer.has_newline_before || matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
            return Ok(());
        }
        // `parseSemicolon`: nothing is consumed.
        if self.tolerant {
            Ok(())
        } else {
            Err(Error::SyntaxError)
        }
    }

    /// `nextIsUnambiguouslyIndexSignature`, at the `[`.
    fn is_index_signature(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next()?;
            if matches!(p.tok(), T::TDotDotDot | T::TCloseBracket) {
                return Ok(true);
            }
            if p.is_modifier_kind() {
                p.next()?;
                if p.tok() == T::TIdentifier {
                    return Ok(true);
                }
            } else if p.tok() != T::TIdentifier {
                return Ok(false);
            } else {
                p.next()?;
            }
            if matches!(p.tok(), T::TColon | T::TComma) {
                return Ok(true);
            }
            if p.tok() != T::TQuestion {
                return Ok(false);
            }
            p.next()?;
            Ok(matches!(p.tok(), T::TColon | T::TComma | T::TCloseBracket))
        })
        .unwrap_or(false)
    }

    /// `IsModifierKind`
    fn is_modifier_kind(&self) -> bool {
        match self.tok() {
            T::TConst | T::TDefault | T::TExport | T::TIn => true,
            T::TIdentifier => matches!(
                self.lexer.identifier,
                b"abstract"
                    | b"accessor"
                    | b"async"
                    | b"declare"
                    | b"out"
                    | b"override"
                    | b"private"
                    | b"protected"
                    | b"public"
                    | b"readonly"
                    | b"static"
            ),
            _ => false,
        }
    }

    /// `checkGrammarIndexSignatureParameters`, up to where the type of the parameter is looked at. The checker does the rest.
    /// `start`: where the index signature starts, modifiers included.
    fn check_index_signature_parameters(&mut self, list: &ParameterList, start: u32) {
        let Some(first) = list.params.first() else {
            self.file.early_errors.push((start, 1096));
            return;
        };
        let name = self.file[first.pat].pos;
        if list.params.len() != 1 {
            self.file.early_errors.push((name, 1096));
            return;
        }
        if let Some(comma) = list.trailing_comma {
            self.file.early_errors.push((comma, 1025));
        }
        let error = if first.flags.contains(Flags::REST) {
            (list.first_rest, 1017)
        } else if list.first_has_modifiers {
            (name, 1018)
        } else if first.flags.contains(Flags::OPTIONAL) {
            (list.first_question, 1019)
        } else if first.default.is_some() {
            (name, 1020)
        } else if first.ty.is_none() {
            (name, 1022)
        } else {
            return;
        };
        self.file.early_errors.push(error);
    }

    fn parse_member(&mut self, inherited: Flags) -> R<Member> {
        let mut modifiers = Vec::new();
        let first_decorator = self.member_decorators.len();
        let mut member = self.parse_member_with(inherited, &mut modifiers)?;
        member.loc = TextRange {
            pos: self.full_start_of(member.start),
            end: self.full_start(),
        };
        for decorator in &mut self.member_decorators[first_decorator..] {
            decorator.0 = member.pos;
        }
        // `parseModifiersEx(stopOnStartOfClassStaticBlock)`
        let own_static = usize::from(member.kind == MemberKind::StaticBlock);
        member.modifiers =
            self.add_modifier_list(&modifiers[..modifiers.len().saturating_sub(own_static)]);
        if !modifiers.is_empty() {
            let on = match member.kind {
                MemberKind::IndexSignature => Modified::ClassIndexSignature,
                MemberKind::Property => Modified::Property,
                MemberKind::Getter | MemberKind::Setter => Modified::Accessor,
                MemberKind::Constructor => Modified::Constructor,
                _ => Modified::Method,
            };
            if member.kind != MemberKind::StaticBlock {
                self.check_modifiers(
                    &modifiers,
                    on,
                    inherited.contains(Flags::AMBIENT),
                    matches!(member.key, PropKey::Private(_)),
                    member.pos,
                );
            }
        }
        Ok(member)
    }

    fn parse_member_with(
        &mut self,
        inherited: Flags,
        modifiers: &mut Vec<(Flags, u32)>,
    ) -> R<Member> {
        let start = self.pos();
        let mut member = Member {
            kind: MemberKind::Property,
            key: PropKey::None,
            flags: inherited,
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            pos: start,
            start,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        };
        while self.tok() == T::TAt {
            // In an ambient class a member's own `declare`, which `NodeCanBeDecorated` goes by, is not told from that of the class.
            let decorator = if !inherited.contains(Flags::AMBIENT) {
                self.attempt(|p| p.parse_decorator().map(Some))
            } else {
                None
            };
            match decorator {
                Some(decorator) => self.member_decorators.push((0, decorator)),
                None => self.skip_decorator()?,
            }
        }
        member.pos = self.pos();
        member.flags |= self.parse_modifiers()?;
        *modifiers = std::mem::take(&mut self.modifiers);
        if self.tok() == T::TOpenBrace && member.flags.contains(Flags::STATIC) {
            self.skip_balanced()?;
            member.kind = MemberKind::StaticBlock;
            return Ok(member);
        }
        if self.tok() == T::TOpenBracket && self.is_index_signature() {
            // `parseIndexSignatureDeclaration`
            let pos = self.pos();
            self.next()?;
            let list = self.parse_parameter_list(T::TCloseBracket)?;
            let ret = if self.eat(T::TColon)? {
                self.parse_type_or_error()?
            } else {
                TypeNodeId::NONE
            };
            // `checkGrammarIndexSignature`: if the modifiers are in error, nothing more is reported.
            if modifier_error(
                modifiers,
                Modified::ClassIndexSignature,
                self.in_abstract_class,
                inherited.contains(Flags::AMBIENT),
                false,
            )
            .is_none()
            {
                self.check_index_signature_parameters(&list, member.pos);
            }
            let params = self.file.add_params(&list.params);
            member.kind = MemberKind::IndexSignature;
            member.ty = ret;
            member.func = self.file.add_fn(Func {
                kind: FnKind::IndexSignature,
                flags: member.flags,
                name: Atom::NONE,
                name_pos: pos,
                type_params: Span::EMPTY,
                params,
                this_param: ParamId::NONE,
                ret,
                body: FnBody::None,
                anchor: pos,
                pos,
                start,
            });
            self.end_member()?;
            return Ok(member);
        }
        let mut accessor = None;
        if self.tok() == T::TIdentifier && matches!(self.lexer.identifier, b"get" | b"set") {
            let is_accessor = self
                .look_ahead(|p| {
                    p.next()?;
                    Ok(p.lexer.is_identifier_or_keyword()
                        || matches!(
                            p.tok(),
                            T::TStringLiteral
                                | T::TNumericLiteral
                                | T::TBigIntegerLiteral
                                | T::TOpenBracket
                                | T::TPrivateIdentifier
                        ))
                })
                .unwrap_or(false);
            if is_accessor {
                accessor = Some(self.lexer.identifier == b"get");
                self.next()?;
            }
        }
        if self.eat(T::TAsterisk)? {
            member.flags |= Flags::GENERATOR;
        }
        member.pos = self.pos();
        let name_token = self.tok();
        // `getLiteralTypeFromPropertyName`: `"0"` and `["0"]` name a property with a string, `0` and `[0]` with a number.
        let starts_with_string = match name_token {
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => true,
            T::TOpenBracket => {
                self.look_ahead(|p| {
                    p.next().map(|()| {
                        matches!(
                            p.tok(),
                            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral
                        )
                    })
                }) == Some(true)
            }
            _ => false,
        };
        member.key = if self.tolerant
            && member.flags.contains(Flags::GENERATOR)
            && !(self.is_literal_property_name() || self.tok() == T::TOpenBracket)
        {
            // `parsePropertyName`: the name after the `*` is missing.
            member.pos = self.full_start();
            PropKey::Name(known::empty)
        } else {
            self.parse_property_name()?
        };
        if starts_with_string && matches!(member.key, PropKey::Name(_)) {
            member.flags |= Flags::STRING_NAME;
        }
        // `tryParseConstructorDeclaration`: `constructor`, or `"constructor"` right before the `(`.
        let is_constructor_name = member.key == PropKey::Name(known::constructor)
            && (name_token == T::TIdentifier
                || name_token == T::TStringLiteral && self.tok() == T::TOpenParen);
        if self.eat(T::TQuestion)? {
            member.flags |= Flags::OPTIONAL;
        } else if self.tok() == T::TExclamation {
            self.next()?;
            member.flags |= Flags::DEFINITE;
        }
        let name = member.key.name().unwrap_or(Atom::NONE);
        if let Some(is_getter) = accessor {
            // `parseClassElement`: its own `declare` makes a property or a method ambient, not an accessor.
            if !inherited.contains(Flags::AMBIENT) {
                member.flags.remove(Flags::AMBIENT);
            }
            member.kind = if is_getter {
                MemberKind::Getter
            } else {
                MemberKind::Setter
            };
            let kind = if is_getter {
                FnKind::Getter
            } else {
                FnKind::Setter
            };
            member.func = self.signature_fn(kind, member.flags, name, member.pos, start)?;
            self.body_if_any(member.func, member.flags.contains(Flags::AMBIENT))?;
            self.end_member()?;
            return Ok(member);
        }
        if self.tolerant
            && !matches!(self.tok(), T::TOpenParen | T::TLessThan)
            && (is_constructor_name || member.flags.contains(Flags::GENERATOR))
        {
            // `tryParseConstructorDeclaration`, `parsePropertyOrMethodDeclaration`: `constructor` or a `*` decides.
            // `parseParameters`: without a `(` there are no parameters.
            let is_constructor = is_constructor_name && !member.flags.contains(Flags::GENERATOR);
            member.kind = if is_constructor {
                MemberKind::Constructor
            } else {
                MemberKind::Method
            };
            member.func = self.file.add_fn(Func {
                kind: if is_constructor {
                    FnKind::Constructor
                } else {
                    FnKind::Method
                },
                flags: member.flags,
                name,
                name_pos: member.pos,
                type_params: Span::EMPTY,
                params: Span::EMPTY,
                this_param: ParamId::NONE,
                ret: TypeNodeId::NONE,
                body: FnBody::None,
                anchor: member.pos,
                pos: member.pos,
                start,
            });
            self.end_member()?;
            return Ok(member);
        }
        if matches!(self.tok(), T::TOpenParen | T::TLessThan) {
            let is_constructor = is_constructor_name;
            // Nor a constructor.
            if is_constructor && !inherited.contains(Flags::AMBIENT) {
                member.flags.remove(Flags::AMBIENT);
            }
            member.kind = if is_constructor {
                MemberKind::Constructor
            } else {
                MemberKind::Method
            };
            let kind = if is_constructor {
                FnKind::Constructor
            } else {
                FnKind::Method
            };
            member.func = self.signature_fn(kind, member.flags, name, member.pos, start)?;
            self.body_if_any(member.func, member.flags.contains(Flags::AMBIENT))?;
            self.end_member()?;
            return Ok(member);
        }
        if self.eat(T::TColon)? {
            member.ty = self.parse_type_or_error()?;
        }
        if self.tok() == T::TEquals {
            // `static readonly x = 1` in a declaration file.
            self.next()?;
            member.init = self.parse_initializer()?;
        }
        self.end_member()?;
        Ok(member)
    }

    /// The body of `func`, of which the parser proper kept nothing. `parseFunctionBlockOrSemicolon` takes a body wherever one is
    /// written. It is kept if it is simple enough to be read here; if not, `func` says `BODY_DROPPED`.
    fn body_if_any(&mut self, func: FnId, is_ambient: bool) -> R<()> {
        if self.tok() != T::TOpenBrace {
            return Ok(());
        }
        // `checkGrammarStatementInAmbientContext`, `checkGrammarAccessor`
        if is_ambient {
            self.file.early_errors.push((self.pos(), 1183));
        }
        match self.attempt(|p| p.parse_simple_body().map(Some)) {
            Some(body) => self.file[func].body = FnBody::Block(body),
            None => {
                self.skip_balanced()?;
                self.file[func].flags |= Flags::BODY_DROPPED;
            }
        }
        // What follows a body needs no separator.
        self.lexer.has_newline_before = true;
        Ok(())
    }

    /// `{ }`, `{ return e; }`
    fn parse_simple_body(&mut self) -> R<IdList<StmtId>> {
        self.expect(T::TOpenBrace)?;
        let mut stmts = Vec::new();
        while self.tok() != T::TCloseBrace {
            let pos = self.pos();
            match self.tok() {
                T::TSemicolon => {
                    self.next()?;
                    let empty = self.file.stmt(StmtKind::Empty, pos);
                    stmts.push(self.finish_statement(empty, pos));
                }
                T::TReturn => {
                    self.next()?;
                    // `canParseSemicolon`
                    let is_bare = self.lexer.has_newline_before
                        || matches!(self.tok(), T::TSemicolon | T::TCloseBrace | T::TEndOfFile);
                    let value = if is_bare {
                        ExprId::NONE
                    } else {
                        self.parse_expr(0)?
                    };
                    self.semicolon()?;
                    let statement = self.file.stmt(StmtKind::Return(value), pos);
                    stmts.push(self.finish_statement(statement, pos));
                }
                _ => return Err(Error::SyntaxError),
            }
        }
        self.expect(T::TCloseBrace)?;
        Ok(self.file.list(&stmts))
    }

    fn skip_decorator(&mut self) -> R<()> {
        self.expect(T::TAt)?;
        if self.tok() == T::TOpenParen {
            return self.skip_balanced();
        }
        self.ident_or_keyword()?;
        while self.eat(T::TDot)? {
            self.ident_or_keyword()?;
        }
        if self.tok() == T::TOpenParen {
            self.skip_balanced()?;
        }
        Ok(())
    }

    /// `parseDecorator`, of `@a.b(c)`: a name, what is in it, calls. Anything else is more than is read here.
    fn parse_decorator(&mut self) -> R<ExprId> {
        self.expect(T::TAt)?;
        let pos = self.pos();
        if self.tok() != T::TIdentifier {
            return Err(Error::SyntaxError);
        }
        let name = self.atom(self.lexer.identifier);
        self.next()?;
        let mut expr = self.file.expr(ExprKind::Ident(name), pos);
        loop {
            match self.tok() {
                T::TDot => {
                    self.next()?;
                    let name_pos = self.pos();
                    let name = self.ident_or_keyword()?;
                    expr = self.file.expr(
                        ExprKind::Dot {
                            obj: expr,
                            name,
                            name_pos,
                            chain: Chain::No,
                        },
                        pos,
                    );
                }
                T::TOpenParen => expr = self.parse_call(expr, IdList::EMPTY, pos)?,
                // `parseMemberExpressionRest`: in a decorator a `[` is left alone, it starts the name of what is decorated.
                _ => return Ok(expr),
            }
        }
    }

    /// `parseArgumentList`: `(a, ...b)` after `callee`, which starts at `pos`, and after `type_args` if there are any.
    fn parse_call(&mut self, callee: ExprId, type_args: IdList<TypeNodeId>, pos: u32) -> R<ExprId> {
        self.expect(T::TOpenParen)?;
        let mut args = Vec::new();
        while self.tok() != T::TCloseParen {
            let at = self.pos();
            let is_spread = self.eat(T::TDotDotDot)?;
            let mut arg = self.parse_expr(1)?;
            if is_spread {
                arg = self.file.expr(ExprKind::Spread(arg), at);
            }
            args.push(arg);
            if !self.eat(T::TComma)? {
                break;
            }
        }
        let close_pos = match self.tok() {
            T::TCloseParen => self.pos(),
            _ => self.lexer.full_start().start as u32 - 1,
        };
        self.expect(T::TCloseParen)?;
        let args = self.file.list(&args);
        let call = self.file.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain: Chain::No,
            template: ExprId::NONE,
        });
        Ok(self.file.expr(ExprKind::Call(call), pos))
    }

    fn parse_property_name(&mut self) -> R<PropKey> {
        match self.tok() {
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                let name = self.string_value()?;
                self.next()?;
                Ok(PropKey::Name(name))
            }
            T::TNumericLiteral => {
                let name = self.number_name(self.lexer.number);
                self.next()?;
                Ok(PropKey::Name(name))
            }
            // `parsePropertyNameWorker`. Named like `Lower::key` names it.
            T::TBigIntegerLiteral => {
                let name = self.atom(self.lexer.identifier);
                self.next()?;
                Ok(PropKey::Name(name))
            }
            T::TPrivateIdentifier => {
                let name = self.atom(self.lexer.identifier);
                self.next()?;
                Ok(PropKey::Private(name))
            }
            T::TOpenBracket => {
                self.next()?;
                let expr = self.parse_expr(0)?;
                self.expect(T::TCloseBracket)?;
                Ok(self.computed_key(expr))
            }
            _ => Ok(PropKey::Name(self.ident_or_keyword()?)),
        }
    }

    /// `["a"]` is `a`.
    pub(crate) fn computed_key(&mut self, expr: ExprId) -> PropKey {
        match self.file[expr].kind {
            ExprKind::String(name) => PropKey::Name(name),
            ExprKind::Number(n) => PropKey::Name(self.number_name(self.file.numbers[n as usize])),
            _ => PropKey::Computed(expr),
        }
    }

    // ───────────────────────────── parameters ─────────────────────────────

    /// `(a: A, b?: B, ...c: C[])`
    fn parse_params(&mut self) -> R<Span<ParamId>> {
        let kept = self.kept.parameters.get(&(self.pos() as i32)).copied();
        if let Some(parameters) = self.reuse_kept(kept)? {
            return Ok(self.clone_params(parameters));
        }
        if self.tolerant && self.tok() != T::TOpenParen {
            // `parseParameters`: without the `(` the list is empty, and no `)` is looked for.
            return Ok(Span::EMPTY);
        }
        self.expect(T::TOpenParen)?;
        let list = self.parse_parameter_list(T::TCloseParen)?;
        Ok(self.file.add_params(&list.params))
    }

    /// `parseDelimitedList(PCParameters, parseParameter)` and then `close`. The opening token has been consumed.
    fn parse_parameter_list(&mut self, close: T) -> R<ParameterList> {
        let mut list = ParameterList {
            params: Vec::new(),
            trailing_comma: None,
            first_rest: 0,
            first_question: 0,
            first_has_modifiers: false,
        };
        while !matches!(
            self.tok(),
            T::TCloseParen | T::TCloseBracket | T::TEndOfFile
        ) {
            if self.tolerant && !self.is_start_of_parameter() {
                // `abortParsingListOrMoveToNextToken`
                if !self.is_skipped_in_recovery() {
                    break;
                }
                self.next()?;
                continue;
            }
            let start = self.pos();
            self.parse_parameter(&mut list)?;
            list.trailing_comma = (self.tok() == T::TComma).then(|| self.pos());
            if self.eat(T::TComma)? {
                continue;
            }
            if !self.tolerant
                || matches!(
                    self.tok(),
                    T::TCloseParen | T::TCloseBracket | T::TEndOfFile
                )
            {
                break;
            }
            // A parameter that consumed nothing is not tried again.
            if self.pos() == start {
                self.next()?;
            }
        }
        self.expect(close)?;
        Ok(list)
    }

    /// `parseParameterEx`
    fn parse_parameter(&mut self, list: &mut ParameterList) -> R<()> {
        const PROPERTY_MODIFIERS: Flags = Flags::PUBLIC
            .union(Flags::PRIVATE)
            .union(Flags::PROTECTED)
            .union(Flags::READONLY)
            .union(Flags::OVERRIDE);
        let start = self.pos();
        while self.tok() == T::TAt {
            self.skip_decorator()?;
        }
        // The other modifiers are errors and mean nothing on a parameter.
        let mut flags = self.parse_modifiers_ex(false)? & PROPERTY_MODIFIERS;
        let modifiers = std::mem::take(&mut self.modifiers);
        let errors_before = self.file.early_errors.len();
        if !modifiers.is_empty() {
            self.check_modifiers(&modifiers, Modified::Parameter, false, false, start);
        }
        if !flags.is_empty() {
            flags |= Flags::PARAMETER_PROPERTY;
        }
        // `parseNameOfParameter` takes `this` for a name.
        if self.tok() == T::TThis {
            let name_pos = self.pos();
            let pat = self.file.pat(PatKind::Ident(known::this), name_pos);
            self.next()?;
            let ty = if self.eat(T::TColon)? {
                self.parse_type_or_error()?
            } else {
                TypeNodeId::NONE
            };
            list.params.push(Param {
                pat,
                ty,
                default: ExprId::NONE,
                flags: Flags::empty(),
                pos: start,
            });
            return Ok(());
        }
        let rest_pos = self.pos();
        if self.eat(T::TDotDotDot)? {
            flags |= Flags::REST;
        }
        let pat = self.parse_binding()?;
        let is_missing = matches!(self.file[pat].kind, PatKind::Missing);
        // `parseNameOfParameter`: a modifier keyword that cannot be a name is passed over.
        if is_missing
            && modifiers.is_empty()
            && matches!(self.tok(), T::TConst | T::TDefault | T::TExport | T::TIn)
        {
            self.next()?;
        }
        // The end of `checkGrammarModifiers`
        if flags.contains(Flags::PARAMETER_PROPERTY)
            && self.file.early_errors.len() == errors_before
        {
            if matches!(self.file[pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
                self.file.early_errors.push((start, 1187));
            } else if flags.contains(Flags::REST) {
                self.file.early_errors.push((start, 1317));
            }
        }
        let question_pos = self.pos();
        if self.eat(T::TQuestion)? {
            flags |= Flags::OPTIONAL;
        }
        let ty = if self.eat(T::TColon)? {
            self.parse_type_or_error()?
        } else {
            TypeNodeId::NONE
        };
        let default = if self.eat(T::TEquals)? {
            self.parse_initializer()?
        } else {
            ExprId::NONE
        };
        if list.params.is_empty() {
            (
                list.first_rest,
                list.first_question,
                list.first_has_modifiers,
            ) = (rest_pos, question_pos, !modifiers.is_empty());
        }
        // A parameter that is missing altogether is where the token before it ends.
        let pos = if self.pos() == start {
            self.full_start()
        } else {
            start
        };
        list.params.push(Param {
            pat,
            ty,
            default,
            flags,
            pos,
        });
        Ok(())
    }

    /// `isStartOfParameter`
    fn is_start_of_parameter(&self) -> bool {
        matches!(
            self.tok(),
            T::TDotDotDot | T::TIdentifier | T::TPrivateIdentifier | T::TOpenBrace | T::TOpenBracket | T::TAt
                // `IsModifierKind`
                | T::TConst | T::TDefault | T::TExport | T::TIn
                // `isStartOfType`
                | T::TVoid | T::TNull | T::TThis | T::TTypeof | T::TLessThan | T::TBar | T::TAmpersand | T::TNew
                | T::TStringLiteral | T::TNumericLiteral | T::TBigIntegerLiteral | T::TTrue | T::TFalse
                | T::TAsterisk | T::TQuestion | T::TExclamation | T::TImport
                | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead
        )
    }

    /// `abortParsingListOrMoveToNextToken`, at a token that neither starts an element nor ends the list: whether the token is skipped.
    /// This reader does not track the enclosing lists (`isInSomeParsingContext`). These tokens start or end nothing in any of them.
    fn is_skipped_in_recovery(&self) -> bool {
        match self.tok() {
            T::TComma
            | T::TColon
            | T::TSemicolon
            | T::TDot
            | T::TQuestionDot
            | T::TEqualsGreaterThan
            | T::TSyntaxError => true,
            // TypeScript scans these as `>`, a binary operator, which can start an expression statement.
            T::TGreaterThanGreaterThanEquals | T::TGreaterThanGreaterThanGreaterThanEquals => false,
            token => token.is_assign(),
        }
    }

    /// `TokenFullStart`: where the token before the current one ends. A missing node is there.
    fn full_start(&self) -> u32 {
        self.full_start_of(self.pos())
    }

    /// `node.Pos()` of what starts with the token at `token`, `node.End()` of what ends before it. Not in a JSDoc comment.
    pub(crate) fn full_start_of(&self, token: u32) -> u32 {
        crate::lexer::comments_before(self.lexer.contents, &self.comments, token as usize).1 as u32
    }

    /// `isLiteralPropertyName`
    fn is_literal_property_name(&self) -> bool {
        self.lexer.is_identifier_or_keyword()
            || matches!(
                self.tok(),
                T::TPrivateIdentifier
                    | T::TStringLiteral
                    | T::TNumericLiteral
                    | T::TBigIntegerLiteral
            )
    }

    /// The type at the current position. Where the parser kept none, nothing is consumed and the type is an error type.
    fn parse_type_or_error(&mut self) -> R<TypeNodeId> {
        let pos = self.pos();
        match self.parse_type() {
            Err(_) if self.tolerant => Ok(self.file.ty(TypeNodeKind::Error, pos)),
            result => result,
        }
    }

    /// `parseInitializer`, after the `=`. An expression this reader cannot parse is skipped and becomes `Missing`.
    fn parse_initializer(&mut self) -> R<ExprId> {
        let pos = self.pos();
        let parsed = self.attempt(|p| {
            let expr = p.parse_expr(1)?;
            let is_at_end = p.lexer.has_newline_before
                || matches!(
                    p.tok(),
                    T::TComma
                        | T::TSemicolon
                        | T::TCloseParen
                        | T::TCloseBracket
                        | T::TCloseBrace
                        | T::TEndOfFile
                );
            Ok(is_at_end.then_some(expr))
        });
        if let Some(expr) = parsed {
            return Ok(expr);
        }
        self.skip_expression()?;
        Ok(self.file.expr(ExprKind::Missing, pos))
    }

    /// Skips an assignment expression: up to a `,`, a `;` or a closing bracket that is not inside brackets, or to a word on a new line
    /// after a token that can end an expression.
    fn skip_expression(&mut self) -> R<()> {
        let mut can_end = false;
        loop {
            match self.tok() {
                T::TComma
                | T::TSemicolon
                | T::TCloseParen
                | T::TCloseBracket
                | T::TCloseBrace
                | T::TEndOfFile => return Ok(()),
                // The `}` of a substitution would have to be scanned again as part of the template.
                T::TTemplateHead => return Err(Error::SyntaxError),
                T::TIn | T::TInstanceof => {}
                _ if can_end
                    && self.lexer.has_newline_before
                    && self.lexer.is_identifier_or_keyword() =>
                {
                    return Ok(());
                }
                _ => {}
            }
            if matches!(self.tok(), T::TOpenParen | T::TOpenBracket | T::TOpenBrace) {
                self.skip_balanced()?;
                can_end = true;
                continue;
            }
            can_end = matches!(
                self.tok(),
                T::TIdentifier
                    | T::TPrivateIdentifier
                    | T::TThis
                    | T::TSuper
                    | T::TTrue
                    | T::TFalse
                    | T::TNull
                    | T::TNumericLiteral
                    | T::TBigIntegerLiteral
                    | T::TStringLiteral
                    | T::TNoSubstitutionTemplateLiteral
            );
            self.next()?;
        }
    }

    fn parse_binding(&mut self) -> R<PatId> {
        self.enter()?;
        let result = self.parse_binding_inner();
        self.depth -= 1;
        result
    }

    fn parse_binding_inner(&mut self) -> R<PatId> {
        let pos = self.pos();
        match self.tok() {
            T::TOpenBrace => {
                self.next()?;
                let mut props = Vec::new();
                // `parseDelimitedList(PCObjectBindingElements, parseObjectBindingElement)`
                while !matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
                    if self.tolerant
                        && !(self.is_literal_property_name()
                            || matches!(self.tok(), T::TOpenBracket | T::TDotDotDot))
                    {
                        if !self.is_skipped_in_recovery() {
                            break;
                        }
                        self.next()?;
                        continue;
                    }
                    let start = self.pos();
                    if self.eat(T::TDotDotDot)? {
                        let value = self.parse_binding()?;
                        props.push(PatProp {
                            key: PropKey::None,
                            value,
                            default: ExprId::NONE,
                            is_rest: true,
                            pos: start,
                        });
                    } else {
                        let key_pos = self.pos();
                        let is_identifier = self.tok() == T::TIdentifier;
                        let key = self.parse_property_name()?;
                        let value = if self.eat(T::TColon)? {
                            self.parse_binding()?
                        } else if is_identifier || !self.tolerant {
                            let name = key.name().ok_or(Error::SyntaxError)?;
                            self.file.pat(PatKind::Ident(name), key_pos)
                        } else {
                            // The `:` is missing.
                            self.parse_binding()?
                        };
                        let default = if self.eat(T::TEquals)? {
                            self.parse_initializer()?
                        } else {
                            ExprId::NONE
                        };
                        props.push(PatProp {
                            key,
                            value,
                            default,
                            is_rest: false,
                            pos: key_pos,
                        });
                    }
                    if self.eat(T::TComma)? {
                        continue;
                    }
                    if !self.tolerant || matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
                        break;
                    }
                    if self.pos() == start {
                        self.next()?;
                    }
                }
                self.expect(T::TCloseBrace)?;
                let props = self.file.add_pat_props(&props);
                Ok(self.file.pat(PatKind::Object(props), pos))
            }
            T::TOpenBracket => {
                self.next()?;
                let mut elems = Vec::new();
                // `parseDelimitedList(PCArrayBindingElements, parseArrayBindingElement)`
                while !matches!(self.tok(), T::TCloseBracket | T::TEndOfFile) {
                    if self.tok() == T::TComma {
                        let hole = self.file.pat(PatKind::Missing, self.pos());
                        elems.push(PatElem {
                            pat: hole,
                            default: ExprId::NONE,
                            is_rest: false,
                            start: self.pos(),
                        });
                        self.next()?;
                        continue;
                    }
                    if self.tolerant
                        && !matches!(
                            self.tok(),
                            T::TDotDotDot
                                | T::TIdentifier
                                | T::TPrivateIdentifier
                                | T::TOpenBrace
                                | T::TOpenBracket
                        )
                    {
                        if !self.is_skipped_in_recovery() {
                            break;
                        }
                        self.next()?;
                        continue;
                    }
                    let start = self.pos();
                    let is_rest = self.eat(T::TDotDotDot)?;
                    let pat = self.parse_binding()?;
                    let default = if self.eat(T::TEquals)? {
                        self.parse_initializer()?
                    } else {
                        ExprId::NONE
                    };
                    elems.push(PatElem {
                        pat,
                        default,
                        is_rest,
                        start,
                    });
                    if self.eat(T::TComma)? {
                        continue;
                    }
                    if !self.tolerant || matches!(self.tok(), T::TCloseBracket | T::TEndOfFile) {
                        break;
                    }
                    if self.pos() == start {
                        self.next()?;
                    }
                }
                self.expect(T::TCloseBracket)?;
                let elems = self.file.add_pat_elems(&elems);
                Ok(self.file.pat(PatKind::Array(elems), pos))
            }
            // `createIdentifier`: the parser has objected to a private name, and it is the name.
            T::TPrivateIdentifier if self.tolerant => {
                let name = self.atom(self.lexer.identifier);
                self.next()?;
                Ok(self.file.pat(PatKind::Ident(name), pos))
            }
            // `createMissingIdentifier`: nothing is consumed.
            token if self.tolerant && token != T::TIdentifier => {
                let pos = self.full_start();
                Ok(self.file.pat(PatKind::Missing, pos))
            }
            _ => {
                let name = self.ident_or_keyword()?;
                Ok(self.file.pat(PatKind::Ident(name), pos))
            }
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// The few expressions a declaration can hold: initializers of enum members and of constants, computed names,
    /// `extends` clauses, `export default`. `level` 0 allows a comma.
    fn parse_expr(&mut self, level: u8) -> R<ExprId> {
        self.enter()?;
        let result = match level {
            0 => self.parse_comma(),
            1 => self.parse_assignment(),
            _ => self.parse_binary(level),
        };
        self.depth -= 1;
        result
    }

    /// `parseExpression`
    fn parse_comma(&mut self) -> R<ExprId> {
        let pos = self.pos();
        let mut left = self.parse_assignment()?;
        while self.eat(T::TComma)? {
            let right = self.parse_assignment()?;
            left = self.file.expr(
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                },
                pos,
            );
        }
        Ok(left)
    }

    /// `parseAssignmentExpressionOrHigher`: a binary expression, and then `= value` or `? yes : no`.
    fn parse_assignment(&mut self) -> R<ExprId> {
        let pos = self.pos();
        let left = self.parse_binary(1)?;
        if self.eat(T::TEquals)? {
            let value = self.parse_expr(1)?;
            return Ok(self.file.expr(
                ExprKind::Assign {
                    op: None,
                    target: left,
                    value,
                },
                pos,
            ));
        }
        if self.eat(T::TQuestion)? {
            let yes = self.parse_expr(1)?;
            self.expect(T::TColon)?;
            let no = self.parse_expr(1)?;
            return Ok(self.file.expr(
                ExprKind::Cond {
                    test: left,
                    yes,
                    no,
                },
                pos,
            ));
        }
        Ok(left)
    }

    fn binary_op(&self) -> Option<(BinOp, u8)> {
        Some(match self.tok() {
            T::TBarBar => (BinOp::Or, 2),
            T::TQuestionQuestion => (BinOp::Nullish, 2),
            T::TAmpersandAmpersand => (BinOp::And, 3),
            T::TBar => (BinOp::BitOr, 4),
            T::TCaret => (BinOp::BitXor, 5),
            T::TAmpersand => (BinOp::BitAnd, 6),
            T::TEqualsEquals => (BinOp::EqEq, 7),
            T::TExclamationEquals => (BinOp::NotEq, 7),
            T::TEqualsEqualsEquals => (BinOp::EqEqEq, 7),
            T::TExclamationEqualsEquals => (BinOp::NotEqEq, 7),
            T::TIn => (BinOp::In, 8),
            T::TInstanceof => (BinOp::Instanceof, 8),
            T::TLessThanLessThan => (BinOp::Shl, 9),
            T::TGreaterThanGreaterThan => (BinOp::Shr, 9),
            T::TGreaterThanGreaterThanGreaterThan => (BinOp::UShr, 9),
            T::TPlus => (BinOp::Add, 10),
            T::TMinus => (BinOp::Sub, 10),
            T::TAsterisk => (BinOp::Mul, 11),
            T::TSlash => (BinOp::Div, 11),
            T::TPercent => (BinOp::Rem, 11),
            T::TAsteriskAsterisk => (BinOp::Pow, 12),
            _ => return None,
        })
    }

    fn parse_binary(&mut self, min: u8) -> R<ExprId> {
        let pos = self.pos();
        let mut left = self.parse_unary()?;
        while let Some((op, level)) = self.binary_op() {
            if level < min {
                break;
            }
            self.next()?;
            // `parseBinaryExpressionRest`: `a ** b ** c` is `a ** (b ** c)`, the others go the other way.
            let right = self.parse_binary(if op == BinOp::Pow { level } else { level + 1 })?;
            left = self.file.expr(ExprKind::Binary { op, left, right }, pos);
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> R<ExprId> {
        let pos = self.pos();
        let op = match self.tok() {
            T::TMinus => UnOp::Minus,
            T::TPlus => UnOp::Plus,
            T::TTilde => UnOp::BitNot,
            T::TExclamation => UnOp::Not,
            T::TTypeof => UnOp::Typeof,
            T::TVoid => UnOp::Void,
            T::TDelete => UnOp::Delete,
            _ => return self.parse_member_expr(),
        };
        self.next()?;
        let operand = self.parse_unary()?;
        Ok(self.file.expr(ExprKind::Unary { op, operand }, pos))
    }

    fn parse_member_expr(&mut self) -> R<ExprId> {
        let pos = self.pos();
        let expr = match self.tok() {
            T::TNumericLiteral => {
                let n = self.file.number(self.lexer.number);
                self.next()?;
                self.file.expr(ExprKind::Number(n), pos)
            }
            T::TBigIntegerLiteral => {
                let text = self.atom(self.lexer.identifier);
                self.next()?;
                self.file.expr(ExprKind::BigInt(text), pos)
            }
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                let value = self.string_value()?;
                self.next()?;
                self.file.expr(ExprKind::String(value), pos)
            }
            T::TTrue => {
                self.next()?;
                self.file.expr(ExprKind::True, pos)
            }
            T::TFalse => {
                self.next()?;
                self.file.expr(ExprKind::False, pos)
            }
            T::TNull => {
                self.next()?;
                self.file.expr(ExprKind::Null, pos)
            }
            T::TThis => {
                self.next()?;
                self.file.expr(ExprKind::This, pos)
            }
            T::TOpenParen => {
                self.next()?;
                let inner = self.parse_expr(0)?;
                self.expect(T::TCloseParen)?;
                // Of parentheses within parentheses, the outermost.
                match self.file.parens.last_mut() {
                    Some(last) if last.0 == inner => last.1 = pos,
                    _ => self.file.parens.push((inner, pos)),
                }
                inner
            }
            T::TIdentifier => {
                let name = self.atom(self.lexer.identifier);
                self.next()?;
                self.file.expr(ExprKind::Ident(name), pos)
            }
            T::TOpenBracket => {
                self.next()?;
                let mut items = Vec::new();
                while self.tok() != T::TCloseBracket {
                    items.push(self.parse_expr(1)?);
                    if !self.eat(T::TComma)? {
                        break;
                    }
                }
                self.expect(T::TCloseBracket)?;
                let items = self.file.list(&items);
                self.file.expr(ExprKind::Array(items), pos)
            }
            T::TOpenBrace => {
                self.next()?;
                let mut props = Vec::new();
                while self.tok() != T::TCloseBrace {
                    let pos = self.pos();
                    let key = self.parse_property_name()?;
                    if self.eat(T::TColon)? {
                        let value = self.parse_expr(1)?;
                        props.push(Prop {
                            kind: PropKind::Init,
                            key,
                            value,
                            pos,
                            start: pos,
                        });
                    } else {
                        let name = key.name().ok_or(Error::SyntaxError)?;
                        let value = self.file.expr(ExprKind::Ident(name), pos);
                        props.push(Prop {
                            kind: PropKind::Shorthand,
                            key,
                            value,
                            pos,
                            start: pos,
                        });
                    }
                    if !self.eat(T::TComma)? {
                        break;
                    }
                }
                self.expect(T::TCloseBrace)?;
                let props = self.file.add_props(&props);
                self.file.expr(ExprKind::Object(props), pos)
            }
            _ => return Err(Error::SyntaxError),
        };
        self.parse_member_rest(expr, pos)
    }

    /// `parseCallExpressionRest`: `.a`, `[a]` and `(a)` after `expr`, which starts at `pos`.
    fn parse_member_rest(&mut self, mut expr: ExprId, pos: u32) -> R<ExprId> {
        loop {
            match self.tok() {
                T::TDot => {
                    self.next()?;
                    let name_pos = self.pos();
                    let name = self.ident_or_keyword()?;
                    expr = self.file.expr(
                        ExprKind::Dot {
                            obj: expr,
                            name,
                            name_pos,
                            chain: Chain::No,
                        },
                        pos,
                    );
                }
                T::TOpenBracket => {
                    self.next()?;
                    let index = self.parse_expr(0)?;
                    self.expect(T::TCloseBracket)?;
                    expr = self.file.expr(
                        ExprKind::Index {
                            obj: expr,
                            index,
                            chain: Chain::No,
                        },
                        pos,
                    );
                }
                T::TOpenParen => expr = self.parse_call(expr, IdList::EMPTY, pos)?,
                // Type arguments right before a `(` are those of the call.
                T::TLessThan => {
                    let type_args = self.attempt(|p| {
                        let type_args = p.parse_type_args()?;
                        Ok((p.tok() == T::TOpenParen).then_some(type_args))
                    });
                    let Some(type_args) = type_args else {
                        return Ok(expr);
                    };
                    expr = self.parse_call(expr, type_args, pos)?;
                }
                _ => return Ok(expr),
            }
        }
    }

    // ───────────────────────────── statements ─────────────────────────────

    fn parse_block_of_statements(&mut self, flags: Flags) -> R<IdList<StmtId>> {
        self.enter()?;
        // `parseModuleBlock`: without a `{` there are no statements, and nothing is consumed.
        let has_block = self.tok() == T::TOpenBrace;
        self.expect(T::TOpenBrace)?;
        let mut stmts = Vec::new();
        let outer = (
            self.in_ambient_block,
            self.said_declare,
            self.modifiers_in_error,
        );
        while has_block && !matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
            self.start_statement(flags.contains(Flags::AMBIENT));
            let start = self.pos();
            self.statement_start = start;
            let base = self.statement_modifiers.len();
            let statement = self.parse_statement(flags)?;
            self.finish_statement(statement, start);
            self.take_statement_modifiers(statement, base);
            stmts.push(statement);
        }
        (
            self.in_ambient_block,
            self.said_declare,
            self.modifiers_in_error,
        ) = outer;
        if has_block {
            self.expect(T::TCloseBrace)?;
        }
        self.depth -= 1;
        Ok(self.file.list(&stmts))
    }

    /// `finishNode`, of a statement whose first token is at `start` and whose last token is the one before the current one.
    fn finish_statement(&mut self, statement: StmtId, start: u32) -> StmtId {
        let loc = TextRange {
            pos: self.full_start_of(start),
            end: self.full_start(),
        };
        let stmt = &mut self.file[statement];
        (stmt.start, stmt.loc) = (start, loc);
        statement
    }

    /// `checkGrammarModifiers` stops at the first thing that is wrong with the modifiers of a statement.
    fn statement_modifier_error(&mut self, pos: u32, code: u32) {
        if !std::mem::replace(&mut self.modifiers_in_error, true) {
            self.file.early_errors.push((pos, code));
        }
    }

    /// `nextTokenCanFollowModifier`, at `export`: whether it is a modifier of the declaration that follows. It is not in `export *`,
    /// `export { }`, `export =`, `export as namespace` and `export default e`, which are statements of their own.
    fn is_export_modifier(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next()?;
            if p.tok() == T::TDefault {
                // `nextTokenCanFollowDefaultKeyword`
                p.next()?;
                let follower = match p.tok() {
                    T::TClass | T::TFunction | T::TAt => return Ok(true),
                    T::TIdentifier => match p.lexer.identifier {
                        b"interface" => return Ok(true),
                        b"abstract" => T::TClass,
                        b"async" => T::TFunction,
                        _ => return Ok(false),
                    },
                    _ => return Ok(false),
                };
                p.next()?;
                return Ok(p.tok() == follower && !p.lexer.has_newline_before);
            }
            if p.is_kw(b"type") {
                p.next()?;
            }
            // `canFollowExportModifier`
            Ok(match p.tok() {
                T::TAsterisk | T::TOpenBrace => false,
                T::TAt
                | T::TOpenBracket
                | T::TDotDotDot
                | T::TStringLiteral
                | T::TNumericLiteral
                | T::TBigIntegerLiteral => true,
                _ => p.lexer.is_identifier_or_keyword() && !p.is_kw(b"as"),
            })
        })
        .unwrap_or(false)
    }

    /// `flags` is what the surroundings say of the statement: `AMBIENT`, and `EXPORT` after that keyword.
    fn parse_statement(&mut self, mut flags: Flags) -> R<StmtId> {
        let pos = self.pos();
        while self.tok() == T::TAt {
            self.skip_decorator()?;
        }
        match self.tok() {
            T::TSemicolon => {
                self.next()?;
                Ok(self.file.stmt(StmtKind::Empty, pos))
            }
            T::TExport => {
                let was_module = self.file.has_module_syntax;
                self.file.has_module_syntax |= self.depth == 0;
                let declare = self.said_declare.take();
                let is_modifier = declare.is_some() && self.is_export_modifier();
                self.push_statement_modifier(Flags::EXPORT);
                self.next()?;
                if is_modifier {
                    // `checkGrammarModifiers`: `export` comes first.
                    self.statement_modifier_error(pos, 1029);
                } else if let Some(declare) = declare
                    && !flags.contains(Flags::EXPORT)
                {
                    // `checkExportDeclaration`, `checkExportAssignment`: these take no modifiers. It is said where the first one is.
                    match self.tok() {
                        T::TEquals | T::TDefault => self.statement_modifier_error(declare, 1120),
                        T::TAsterisk | T::TOpenBrace => {
                            self.statement_modifier_error(declare, 1193)
                        }
                        T::TIdentifier if self.lexer.identifier == b"type" => {
                            self.statement_modifier_error(declare, 1193)
                        }
                        _ => {}
                    }
                }
                let statement = self.parse_export(pos, flags)?;
                // `isAnExternalModuleIndicatorNode`
                if matches!(self.file[statement].kind, StmtKind::ExportAsNamespace(_)) {
                    self.file.has_module_syntax = was_module;
                }
                Ok(statement)
            }
            T::TImport => {
                let was_module = self.file.has_module_syntax;
                self.file.has_module_syntax |= self.depth == 0;
                self.next()?;
                let statement = self.parse_import(pos, flags)?;
                // `import a = b.c` gives another name to what is there already: no module for that.
                if let StmtKind::ImportEquals(i) = self.file[statement].kind
                    && !matches!(self.file[i].target, ImportEqualsTarget::Require(_))
                {
                    self.file.has_module_syntax = was_module;
                }
                Ok(statement)
            }
            T::TVar => self.parse_var(pos, VarKind::Var, flags),
            T::TConst => {
                if self.look_ahead(|p| p.next().map(|()| p.tok() == T::TEnum)) == Some(true) {
                    self.push_statement_modifier(Flags::CONST);
                    self.next()?;
                    return self.parse_enum(pos, flags | Flags::CONST);
                }
                self.parse_var(pos, VarKind::Const, flags)
            }
            T::TFunction => self.parse_function(pos, flags),
            T::TClass => self.parse_class(pos, flags),
            T::TEnum => self.parse_enum(pos, flags),
            T::TIdentifier => {
                let word = self.lexer.identifier;
                // `parseStatement`: these words are names unless a declaration follows.
                if !self.is_start_of_declaration() {
                    return self.parse_other_statement(pos);
                }
                match word {
                    b"declare" => {
                        if self.said_declare.is_some() {
                            self.statement_modifier_error(pos, 1030);
                        } else {
                            if self.in_ambient_block {
                                self.statement_modifier_error(pos, 1038);
                            }
                            self.said_declare = Some(pos);
                        }
                        self.push_statement_modifier(Flags::AMBIENT);
                        self.next()?;
                        flags |= Flags::AMBIENT;
                        let statement = self.parse_statement(flags);
                        self.said_declare = None;
                        statement
                    }
                    // `parseDeclaration` takes any modifiers. The checker objects to those that do not fit the declaration.
                    b"public" | b"private" | b"protected" | b"static" | b"readonly"
                    | b"accessor" => {
                        self.push_statement_modifier(match word {
                            b"public" => Flags::PUBLIC,
                            b"private" => Flags::PRIVATE,
                            b"protected" => Flags::PROTECTED,
                            b"static" => Flags::STATIC,
                            b"readonly" => Flags::READONLY,
                            _ => Flags::ACCESSOR,
                        });
                        self.next()?;
                        self.parse_statement(flags)
                    }
                    b"abstract" => {
                        self.push_statement_modifier(Flags::ABSTRACT);
                        self.next()?;
                        if self.tok() != T::TClass {
                            return self.parse_statement(flags);
                        }
                        self.parse_class(pos, flags | Flags::ABSTRACT)
                    }
                    b"async" => {
                        if flags.contains(Flags::AMBIENT) {
                            self.statement_modifier_error(pos, 1040);
                        }
                        self.push_statement_modifier(Flags::ASYNC);
                        self.next()?;
                        if self.tok() != T::TFunction {
                            return self.parse_statement(flags);
                        }
                        self.parse_function(pos, flags | Flags::ASYNC)
                    }
                    b"let" => self.parse_var(pos, VarKind::Let, flags),
                    b"using" => self.parse_var(pos, VarKind::Using, flags),
                    b"await" => {
                        // `parse_var` goes past `using`.
                        self.next()?;
                        self.parse_var(pos, VarKind::AwaitUsing, flags)
                    }
                    b"interface" => self.parse_interface(pos, flags),
                    b"type" => self.parse_alias(pos, flags),
                    b"namespace" | b"module" => {
                        self.next()?;
                        self.parse_module(pos, flags)
                    }
                    b"global" => {
                        let name_pos = self.pos();
                        self.next()?;
                        // `parseAmbientExternalModuleDeclaration`
                        let has_body = self.tok() == T::TOpenBrace;
                        let body = if has_body {
                            self.parse_block_of_statements(flags | Flags::AMBIENT)?
                        } else {
                            self.semicolon()?;
                            IdList::EMPTY
                        };
                        let module = self.file.add_module(Module {
                            name: ModuleName::Global,
                            name_pos,
                            flags: flags | Flags::AMBIENT,
                            body,
                            has_body,
                            stmt: StmtId::NONE,
                        });
                        Ok(self.file.stmt(StmtKind::Module(module), pos))
                    }
                    _ => self.parse_other_statement(pos),
                }
            }
            _ => self.parse_other_statement(pos),
        }
    }

    /// `isStartOfDeclaration` (`scanStartOfDeclaration`)
    fn is_start_of_declaration(&mut self) -> bool {
        self.look_ahead(|p| {
            loop {
                match p.tok() {
                    T::TVar | T::TConst | T::TFunction | T::TClass | T::TEnum => return Ok(true),
                    T::TImport => {
                        p.next()?;
                        return Ok(matches!(
                            p.tok(),
                            T::TStringLiteral | T::TAsterisk | T::TOpenBrace
                        ) || p.lexer.is_identifier_or_keyword());
                    }
                    T::TExport => {
                        p.next()?;
                        if matches!(
                            p.tok(),
                            T::TEquals | T::TAsterisk | T::TOpenBrace | T::TDefault | T::TAt
                        ) || p.is_kw(b"as")
                        {
                            return Ok(true);
                        }
                        if p.is_kw(b"type") {
                            p.next()?;
                            return Ok(matches!(p.tok(), T::TAsterisk | T::TOpenBrace)
                                || p.tok() == T::TIdentifier && !p.lexer.has_newline_before);
                        }
                    }
                    T::TIdentifier => match p.lexer.identifier {
                        b"let" => return Ok(true),
                        // `isUsingDeclaration`
                        b"using" => {
                            p.next()?;
                            return Ok(matches!(p.tok(), T::TIdentifier | T::TOpenBrace)
                                && !p.lexer.has_newline_before);
                        }
                        // `isAwaitUsingDeclaration`
                        b"await" => {
                            p.next()?;
                            if !p.is_kw(b"using") {
                                return Ok(false);
                            }
                            p.next()?;
                            return Ok(matches!(p.tok(), T::TIdentifier | T::TOpenBrace)
                                && !p.lexer.has_newline_before);
                        }
                        b"interface" | b"type" => {
                            p.next()?;
                            return Ok(p.tok() == T::TIdentifier && !p.lexer.has_newline_before);
                        }
                        b"module" | b"namespace" => {
                            p.next()?;
                            return Ok(matches!(p.tok(), T::TIdentifier | T::TStringLiteral)
                                && !p.lexer.has_newline_before);
                        }
                        b"global" => {
                            p.next()?;
                            return Ok(matches!(
                                p.tok(),
                                T::TOpenBrace | T::TIdentifier | T::TExport
                            ));
                        }
                        word @ (b"abstract" | b"accessor" | b"async" | b"declare" | b"private"
                        | b"protected" | b"public" | b"readonly") => {
                            p.next()?;
                            if p.lexer.has_newline_before {
                                return Ok(false);
                            }
                            if word == b"declare" && p.is_kw(b"type") {
                                return Ok(true);
                            }
                        }
                        b"static" => p.next()?,
                        _ => return Ok(false),
                    },
                    _ => return Ok(false),
                }
            }
        })
        .unwrap_or(false)
    }

    /// A statement that is not a declaration. The checker refuses it in an ambient context (1036). One that cannot be read here is
    /// skipped and becomes an empty statement, which the lowering replaces if the parser kept the statement.
    fn parse_other_statement(&mut self, pos: u32) -> R<StmtId> {
        if matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
            return Err(Error::SyntaxError);
        }
        // A token that starts no statement is skipped only if the parser has reported it (1128).
        if !self.tolerant
            && (self.is_skipped_in_recovery()
                || matches!(self.tok(), T::TQuestion | T::TCloseParen | T::TCloseBracket))
        {
            return Err(Error::SyntaxError);
        }
        // `parseExpressionOrLabeledStatement`
        let snapshot = self.lexer.snapshot();
        if self.tok() != T::TOpenBrace
            && let Some(expr) = self.attempt(|p| p.parse_expr(0).map(Some))
        {
            // The parser has reported a missing semicolon before a word.
            let is_at_end = self.lexer.has_newline_before
                || matches!(self.tok(), T::TSemicolon | T::TCloseBrace | T::TEndOfFile)
                || self.tolerant && self.lexer.is_identifier_or_keyword();
            if is_at_end {
                self.eat(T::TSemicolon)?;
                return Ok(self.file.stmt(StmtKind::Expr(expr), pos));
            }
            self.lexer.restore(&snapshot);
        }
        let parsed = self.ambient_statement_at(pos);
        // `parseExpressionOrLabeledStatement`: the parser has gone on from a semicolon that is missing.
        if !self.tolerant
            && let Some((end, parsed)) = parsed
            && matches!(parsed.data, bun_ast::stmt::Data::SExpr(_))
            && !self.can_parse_semicolon_before(pos, end)
        {
            return Err(Error::SyntaxError);
        }
        // In a declaration file this is what notices a syntax error.
        if parsed.is_none() || !self.tolerant {
            self.skip_statement()?;
        }
        let statement = self.file.stmt(StmtKind::Empty, pos);
        if let Some((end, parsed)) = parsed {
            self.seek(end)?;
            self.pending_statements.push((statement, parsed));
        }
        Ok(statement)
    }

    /// `canParseSemicolon` after the statement that the parser read from `pos` on, where the token after it starts at `end`. In doubt
    /// it can.
    fn can_parse_semicolon_before(&self, pos: u32, end: u32) -> bool {
        let text = self.lexer.contents;
        let Some(statement) = text.get(pos as usize..end as usize) else {
            return true;
        };
        let written = statement.trim_ascii_end();
        written.ends_with(b";")
            || written.ends_with(b"*/")
            || bun_core::strings::contains_any(&statement[written.len()..], b"\n\r")
            || matches!(text.get(end as usize), None | Some(b'}'))
    }

    /// The statement the parser read at `pos` in an ambient context, and where the token after it starts. The last of several attempts.
    fn ambient_statement_at(&self, pos: u32) -> Option<(u32, bun_ast::Stmt)> {
        let after = self
            .ambient_statements
            .partition_point(|statement| statement.0 <= pos as i32);
        let &(start, end, statement) = self.ambient_statements.get(after.checked_sub(1)?)?;
        (start == pos as i32 && end > start).then_some((end as u32, statement))
    }

    /// Skips a statement that is not a declaration.
    fn skip_statement(&mut self) -> R<()> {
        self.enter()?;
        let result = self.skip_statement_inner();
        self.depth -= 1;
        result
    }

    fn skip_statement_inner(&mut self) -> R<()> {
        match self.tok() {
            T::TCloseBrace | T::TEndOfFile => Err(Error::SyntaxError),
            T::TSemicolon => self.next(),
            T::TOpenBrace => self.skip_balanced(),
            T::TIf => {
                self.next()?;
                self.skip_group(T::TOpenParen)?;
                self.skip_statement()?;
                if self.eat(T::TElse)? {
                    self.skip_statement()?;
                }
                Ok(())
            }
            T::TWhile | T::TWith | T::TFor => {
                self.next()?;
                self.eat_kw(b"await")?;
                self.skip_group(T::TOpenParen)?;
                self.skip_statement()
            }
            T::TSwitch => {
                self.next()?;
                self.skip_group(T::TOpenParen)?;
                self.skip_group(T::TOpenBrace)
            }
            T::TDo => {
                self.next()?;
                self.skip_statement()?;
                if !self.eat(T::TWhile)? {
                    return Err(Error::SyntaxError);
                }
                self.skip_group(T::TOpenParen)?;
                self.eat(T::TSemicolon)?;
                Ok(())
            }
            T::TTry => {
                self.next()?;
                self.skip_group(T::TOpenBrace)?;
                if self.eat(T::TCatch)? {
                    if self.tok() == T::TOpenParen {
                        self.skip_balanced()?;
                    }
                    self.skip_group(T::TOpenBrace)?;
                }
                if self.eat(T::TFinally)? {
                    self.skip_group(T::TOpenBrace)?;
                }
                Ok(())
            }
            // `return`, `throw`, `break`, `continue`, `debugger`, an expression, or a token that starts no statement.
            _ => {
                let starts_group = matches!(self.tok(), T::TOpenParen | T::TOpenBracket);
                if !starts_group {
                    self.next()?;
                }
                if starts_group || !self.lexer.has_newline_before {
                    self.skip_expression()?;
                }
                self.eat(T::TSemicolon)?;
                Ok(())
            }
        }
    }

    /// Skips the bracketed group that starts with `open`.
    fn skip_group(&mut self, open: T) -> R<()> {
        if self.tok() != open {
            return Err(Error::SyntaxError);
        }
        self.skip_balanced()
    }

    fn parse_var(&mut self, pos: u32, kind: VarKind, flags: Flags) -> R<StmtId> {
        self.next()?;
        let mut decls = Vec::new();
        let mut parsed_initializers = Vec::new();
        // `parseDelimitedList(PCVariableDeclarations, parseVariableDeclaration)`
        loop {
            if self.tolerant
                && !matches!(
                    self.tok(),
                    T::TIdentifier | T::TPrivateIdentifier | T::TOpenBrace | T::TOpenBracket
                )
            {
                break;
            }
            let pat = self.parse_binding()?;
            let mut decl_flags = flags;
            if self.eat(T::TExclamation)? {
                decl_flags |= Flags::DEFINITE;
            }
            let ty = if self.eat(T::TColon)? {
                self.parse_type_or_error()?
            } else {
                TypeNodeId::NONE
            };
            let init = if self.eat(T::TEquals)? {
                self.parse_initializer()?
            } else {
                ExprId::NONE
            };
            // `parse_initializer` skipped it.
            if init.is_some()
                && matches!(self.file[init].kind, ExprKind::Missing)
                && let Some(parsed) = self.ambient_initializer_of(self.file[pat].pos)
            {
                parsed_initializers.push((decls.len(), parsed));
            }
            decls.push(VarDecl {
                pat,
                ty,
                init,
                kind,
                flags: decl_flags,
            });
            if self.eat(T::TComma)? {
                continue;
            }
            // `isListTerminator`. Otherwise the comma is missing and the list goes on.
            let is_at_end = self.lexer.has_newline_before
                || matches!(
                    self.tok(),
                    T::TSemicolon | T::TCloseBrace | T::TEndOfFile | T::TIn | T::TEqualsGreaterThan
                )
                || self.is_kw(b"of");
            if !self.tolerant || is_at_end {
                break;
            }
        }
        self.semicolon()?;
        let decls = self.file.add_var_decls(&decls);
        for (index, initializer) in parsed_initializers {
            self.pending_initializers
                .push((decls.at(index), initializer));
        }
        Ok(self.file.stmt(StmtKind::Var(decls), pos))
    }

    /// The initializer the parser read in an ambient context for the variable whose binding starts at `binding`. The last of several
    /// attempts.
    fn ambient_initializer_of(&self, binding: u32) -> Option<bun_ast::Expr> {
        let after = self
            .ambient_initializers
            .partition_point(|initializer| initializer.0 <= binding as i32);
        let &(start, initializer) = self.ambient_initializers.get(after.checked_sub(1)?)?;
        (start == binding as i32).then_some(initializer)
    }

    fn parse_function(&mut self, pos: u32, mut flags: Flags) -> R<StmtId> {
        self.expect(T::TFunction)?;
        if self.eat(T::TAsterisk)? {
            flags |= Flags::GENERATOR;
        }
        let name_pos = self.pos();
        let name = if self.lexer.is_identifier_or_keyword() {
            self.ident_or_keyword()?
        } else {
            Atom::NONE
        };
        let func = self.signature_fn(FnKind::Decl, flags, name, name_pos, self.statement_start)?;
        self.file[func].pos = pos;
        if self.tok() == T::TOpenBrace {
            if !flags.contains(Flags::AMBIENT) {
                return Err(Error::SyntaxError);
            }
            self.body_if_any(func, true)?;
            // `parseFunctionBlockOrSemicolon`: a `;` after the block is a statement of its own.
            return Ok(self.file.stmt(StmtKind::Fn(func), pos));
        }
        let can_parse_semicolon = self.lexer.has_newline_before
            || matches!(self.tok(), T::TSemicolon | T::TCloseBrace | T::TEndOfFile);
        if self.tolerant && !can_parse_semicolon {
            // `parseFunctionBlockOrSemicolon`: a block whose `{` is missing (1144).
            self.file[func].flags |= Flags::MISSING_BODY;
        } else {
            self.semicolon()?;
        }
        Ok(self.file.stmt(StmtKind::Fn(func), pos))
    }

    /// `isImplementsClause`: `implements` before a name. Before anything else it is the name of the class.
    fn is_implements_clause(&mut self) -> bool {
        self.is_kw(b"implements")
            && self.look_ahead(|p| p.next().map(|()| p.lexer.is_identifier_or_keyword()))
                == Some(true)
    }

    fn parse_class(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        self.expect(T::TClass)?;
        let name_pos = self.pos();
        let name = if self.tok() == T::TIdentifier && !self.is_implements_clause() {
            self.ident_or_keyword()?
        } else {
            Atom::NONE
        };
        let type_params = if self.tok() == T::TLessThan {
            self.parse_type_params()?
        } else {
            Span::EMPTY
        };
        let mut extends = ExprId::NONE;
        let mut extends_args = IdList::EMPTY;
        let mut other_extends = Vec::new();
        let mut implements = Vec::new();
        // `parseHeritageClauses`: any number of clauses, in any order. Only the first of each kind counts.
        let (mut seen_extends, mut seen_implements) = (false, false);
        // `checkGrammarClassDeclarationHeritageClauses`: the clauses are not looked at after an error in the modifiers.
        let mut done_reporting = self.modifiers_in_error;
        loop {
            let keyword = self.pos();
            let is_extends = self.tok() == T::TExtends;
            if !is_extends && !self.is_kw(b"implements") {
                break;
            }
            let mut error = match (is_extends, seen_extends, seen_implements) {
                (true, true, _) => Some((keyword, 1172)),
                (true, false, true) => Some((keyword, 1173)),
                (false, _, true) => Some((keyword, 1175)),
                _ => None,
            };
            // `types.Pos()`
            let list_start = self.lexer.end as u32;
            self.next()?;
            let (mut count, mut trailing_comma) = (0u32, None);
            while self.is_heritage_element() {
                let at = self.pos();
                if is_extends && !seen_extends && count == 0 {
                    extends = self.parse_member_expr()?;
                    // `parseCallExpressionRest`: type arguments right before a `(` are those of the call.
                    while self.tok() == T::TLessThan {
                        let args = self.parse_type_args()?;
                        if self.tok() != T::TOpenParen {
                            extends_args = args;
                            break;
                        }
                        let call = self.parse_call(extends, args, at)?;
                        extends = self.parse_member_rest(call, at)?;
                    }
                } else if !is_extends && !seen_implements {
                    implements.push(self.parse_implemented()?);
                } else {
                    // The checker never looks at it.
                    if is_extends {
                        other_extends.extend(self.attempt(|p| p.parse_member_expr().map(Some)));
                    }
                    self.skip_heritage_expression()?;
                    if is_extends && count == 1 && error.is_none() {
                        error = Some((at, 1174));
                    }
                }
                count += 1;
                trailing_comma = (self.tok() == T::TComma).then(|| self.pos());
                if self.eat(T::TComma)? {
                    continue;
                }
                // `parseDelimitedList`: the list goes on after a missing comma, which the parser reported.
                if !self.tolerant || self.is_end_of_heritage_list() {
                    break;
                }
            }
            if is_extends {
                seen_extends = true;
            } else {
                seen_implements = true;
            }
            if done_reporting {
                continue;
            }
            if let Some(error) = error {
                self.file.early_errors.push(error);
                done_reporting = true;
            } else if let Some(comma) = trailing_comma {
                // `checkGrammarHeritageClause`
                self.file.early_errors.push((comma, 1009));
            } else if count == 0 {
                self.file.early_errors.push((list_start, 1097));
            }
        }
        let implements = self.file.list(&implements);
        let other_extends = self.file.list(&other_extends);
        let outer = std::mem::replace(&mut self.in_abstract_class, flags.contains(Flags::ABSTRACT));
        // `parseClassDeclarationOrExpression`: without the `{` there are no members, and no `}` is looked for.
        let has_body = self.tok() == T::TOpenBrace || !self.tolerant;
        let members = if has_body {
            self.parse_class_members(flags & Flags::AMBIENT)
        } else {
            Ok(Span::EMPTY)
        };
        self.in_abstract_class = outer;
        let members = members?;
        let class = self.file.add_class(Class {
            name,
            name_pos,
            flags,
            type_params,
            extends,
            extends_args,
            other_extends,
            implements,
            members,
            pos,
            start: self.statement_start,
        });
        Ok(self.file.stmt(StmtKind::Class(class), pos))
    }

    /// `isListElement(PCHeritageClauseElement)`
    fn is_heritage_element(&mut self) -> bool {
        match self.tok() {
            // `isValidHeritageClauseObjectLiteral`: `{ }` is the body unless one of these follows it.
            T::TOpenBrace => {
                self.look_ahead(|p| {
                    p.next()?;
                    if p.tok() != T::TCloseBrace {
                        return Ok(true);
                    }
                    p.next()?;
                    Ok(matches!(p.tok(), T::TComma | T::TOpenBrace | T::TExtends)
                        || p.is_kw(b"implements"))
                }) == Some(true)
            }
            T::TIdentifier => !self.is_kw(b"implements"),
            // `isStartOfLeftHandSideExpression`
            T::TThis
            | T::TSuper
            | T::TNull
            | T::TTrue
            | T::TFalse
            | T::TNumericLiteral
            | T::TBigIntegerLiteral
            | T::TStringLiteral
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead
            | T::TOpenParen
            | T::TOpenBracket
            | T::TFunction
            | T::TClass
            | T::TNew
            | T::TSlash
            | T::TSlashEquals => true,
            _ => false,
        }
    }

    /// `parseExpressionWithTypeArguments` after `implements`. `checkClassLikeDeclaration` reports 2500 for what is not `A.B<C>`.
    fn parse_implemented(&mut self) -> R<TypeNodeId> {
        let pos = self.pos();
        // The parser read a type here. It is the whole element unless the expression goes on after it.
        let kept = self.kept.types.get(&(pos as i32)).copied();
        let is_whole = kept.is_some_and(|kept| {
            self.look_ahead(|p| {
                p.seek(kept.end)?;
                Ok(!p.heritage_expression_goes_on())
            }) == Some(true)
        });
        if is_whole {
            return self.parse_type();
        }
        // `A?.B` is still resolved as `A.B`.
        let mut is_optional_chain = false;
        let chain = self.attempt(|p| {
            if p.tok() != T::TIdentifier {
                return Ok(None);
            }
            let mut names = vec![p.ident_or_keyword()?];
            while matches!(p.tok(), T::TDot | T::TQuestionDot) {
                is_optional_chain |= p.tok() == T::TQuestionDot;
                p.next()?;
                names.push(p.ident_or_keyword()?);
            }
            let args = if p.tok() == T::TLessThan {
                p.parse_type_args()?
            } else {
                IdList::EMPTY
            };
            if p.heritage_expression_goes_on() {
                return Ok(None);
            }
            let name = p.file.list(&names);
            Ok(Some(p.file.ty(TypeNodeKind::Ref { name, args }, pos)))
        });
        if chain.is_none() || is_optional_chain {
            self.file.checker_errors.push((pos, 2500));
        }
        if let Some(reference) = chain {
            return Ok(reference);
        }
        self.skip_heritage_expression()?;
        Ok(self.file.ty(TypeNodeKind::Error, pos))
    }

    /// Whether `parseLeftHandSideExpressionOrHigher` goes on with the current token after a name.
    fn heritage_expression_goes_on(&self) -> bool {
        matches!(
            self.tok(),
            T::TOpenParen
                | T::TOpenBracket
                | T::TQuestionDot
                | T::TExclamation
                | T::TNoSubstitutionTemplateLiteral
                | T::TTemplateHead
        )
    }

    fn parse_interface(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        self.next()?;
        let name_pos = self.pos();
        let name = self.ident_or_keyword()?;
        let type_params = if self.tok() == T::TLessThan {
            self.parse_type_params()?
        } else {
            Span::EMPTY
        };
        let extends = self.parse_interface_heritage()?;
        let extends = self.file.list(&extends);
        let members = self.interface_members()?;
        let interface = self.file.add_interface(Interface {
            name,
            name_pos,
            flags,
            type_params,
            extends,
            members,
            stmt: StmtId::NONE,
        });
        Ok(self.file.stmt(StmtKind::Interface(interface), pos))
    }

    /// `parseHeritageClauses` of an interface. Returns the elements of the first `extends` clause (`GetHeritageElements`).
    /// Reports what `checkGrammarInterfaceDeclaration` reports, except 1176, which the checker finds in the text.
    fn parse_interface_heritage(&mut self) -> R<Vec<TypeNodeId>> {
        let mut extends = Vec::new();
        let mut seen_extends = false;
        // `checkInterfaceDeclaration`: the clauses are not looked at after an error in the modifiers.
        let mut done_reporting = self.modifiers_in_error;
        loop {
            let keyword = self.pos();
            let is_extends = self.tok() == T::TExtends;
            if !is_extends && !self.is_kw(b"implements") {
                return Ok(extends);
            }
            let is_first_extends = is_extends && !seen_extends;
            seen_extends |= is_extends;
            if !is_first_extends && !done_reporting {
                done_reporting = true;
                if is_extends {
                    self.file.early_errors.push((keyword, 1172));
                }
            }
            // `types.Pos()`
            let list_start = self.lexer.end as u32;
            self.next()?;
            let (mut is_empty, mut trailing_comma) = (true, None);
            while self.is_heritage_element() {
                let base = self.parse_heritage_element()?;
                if is_first_extends {
                    extends.push(base);
                }
                is_empty = false;
                trailing_comma = (self.tok() == T::TComma).then(|| self.pos());
                if self.eat(T::TComma)? {
                    continue;
                }
                // `parseDelimitedList`: the list goes on after a missing comma, which the parser reported.
                if !self.tolerant || self.is_end_of_heritage_list() {
                    break;
                }
            }
            // `checkGrammarHeritageClause`
            if done_reporting {
                continue;
            }
            if let Some(comma) = trailing_comma {
                self.file.early_errors.push((comma, 1009));
            } else if is_empty {
                self.file.early_errors.push((list_start, 1097));
            }
        }
    }

    /// `isListTerminator(PCHeritageClauseElement)`
    fn is_end_of_heritage_list(&self) -> bool {
        matches!(self.tok(), T::TOpenBrace | T::TExtends) || self.is_kw(b"implements")
    }

    /// `parseExpressionWithTypeArguments`. Anything but `A.B<C>` becomes `TypeNodeKind::Error`, where the checker reports 2499.
    fn parse_heritage_element(&mut self) -> R<TypeNodeId> {
        let at = self.pos();
        let reference = self.attempt(|p| {
            // `IsEntityNameExpression`
            if p.tok() != T::TIdentifier {
                return Ok(None);
            }
            let reference = p.parse_type_reference()?;
            let is_entity_name = !p.heritage_expression_goes_on()
                && matches!(p.file[reference].kind, TypeNodeKind::Ref { .. });
            Ok(is_entity_name.then_some(reference))
        });
        if let Some(reference) = reference {
            return Ok(reference);
        }
        self.skip_heritage_expression()?;
        Ok(self.file.ty(TypeNodeKind::Error, at))
    }

    /// Skips a heritage element that is not `A.B<C>`: up to a `,` or the end of the list, outside of brackets.
    fn skip_heritage_expression(&mut self) -> R<()> {
        // `isValidHeritageClauseObjectLiteral`
        if self.tok() == T::TOpenBrace {
            self.skip_balanced()?;
        }
        while self.tok() != T::TComma
            && self.tok() != T::TEndOfFile
            && !self.is_end_of_heritage_list()
        {
            match self.tok() {
                T::TOpenParen | T::TOpenBracket => self.skip_balanced()?,
                T::TLessThan if self.attempt(|p| p.parse_type_args().map(Some)).is_some() => {}
                _ => self.next()?,
            }
        }
        Ok(())
    }

    fn parse_alias(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        self.next()?;
        let name_pos = self.pos();
        let name = self.ident_or_keyword()?;
        let type_params = if self.tok() == T::TLessThan {
            self.parse_type_params()?
        } else {
            Span::EMPTY
        };
        self.expect(T::TEquals)?;
        // `parseTypeAliasDeclaration`: a keyword right after the `=` only, and not before a dot. Anywhere else it is a name.
        let is_intrinsic = self.is_kw(b"intrinsic")
            && self.look_ahead(|p| p.next().map(|()| p.tok() != T::TDot)) == Some(true);
        let ty = if is_intrinsic {
            let at = self.pos();
            self.keyword(Keyword::Intrinsic, at)?
        } else {
            self.parse_type_or_error()?
        };
        self.semicolon()?;
        let alias = self.file.add_alias(Alias {
            name,
            name_pos,
            flags,
            type_params,
            ty,
            stmt: StmtId::NONE,
        });
        Ok(self.file.stmt(StmtKind::TypeAlias(alias), pos))
    }

    fn parse_enum(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        self.expect(T::TEnum)?;
        let name_pos = self.pos();
        let name = self.ident_or_keyword()?;
        let mut members = Vec::new();
        // `parseEnumDeclaration`: without a `{` there are no members, and nothing is consumed.
        let has_members = self.tok() == T::TOpenBrace;
        self.expect(T::TOpenBrace)?;
        // `parseDelimitedList(PCEnumMembers, parseEnumMember)`
        while has_members && !matches!(self.tok(), T::TCloseBrace | T::TEndOfFile) {
            if self.tolerant && !(self.is_literal_property_name() || self.tok() == T::TOpenBracket)
            {
                // `abortParsingListOrMoveToNextToken` (1132)
                if !(self.is_skipped_in_recovery()
                    || matches!(self.tok(), T::TQuestion | T::TCloseParen | T::TCloseBracket))
                {
                    break;
                }
                self.next()?;
                continue;
            }
            let pos = self.pos();
            let (name, computed_name) = match self.parse_property_name()? {
                PropKey::Name(name) | PropKey::Private(name) => (name, ExprId::NONE),
                // The checker objects to a computed name (1164). The member declares nothing.
                PropKey::Computed(e) => (Atom::NONE, e),
                PropKey::None => (Atom::NONE, ExprId::NONE),
            };
            let init = if self.eat(T::TEquals)? {
                self.parse_initializer()?
            } else {
                ExprId::NONE
            };
            members.push(EnumMember {
                name,
                computed_name,
                init,
                pos,
            });
            // Where the comma is missing (1357) nothing is consumed and the list goes on.
            if !self.eat(T::TComma)? && !self.tolerant {
                break;
            }
        }
        if has_members {
            self.expect(T::TCloseBrace)?;
        }
        let members = self.file.add_enum_members(&members);
        let id = self.file.add_enum(Enum {
            name,
            name_pos,
            flags,
            members,
            stmt: StmtId::NONE,
        });
        Ok(self.file.stmt(StmtKind::Enum(id), pos))
    }

    /// After `namespace` or `module`.
    fn parse_module(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        let name_pos = self.pos();
        if self.tok() == T::TStringLiteral {
            let name = self.string_value()?;
            self.next()?;
            let (body, has_body) = if self.tok() == T::TOpenBrace {
                (
                    self.parse_block_of_statements(flags | Flags::AMBIENT)?,
                    true,
                )
            } else {
                self.semicolon()?;
                (IdList::EMPTY, false)
            };
            let module = self.file.add_module(Module {
                name: ModuleName::String(name),
                name_pos,
                flags,
                body,
                has_body,
                stmt: StmtId::NONE,
            });
            return Ok(self.file.stmt(StmtKind::Module(module), pos));
        }
        let name = self.ident_or_keyword()?;
        let body = if self.eat(T::TDot)? {
            // `namespace A.B { }` is `namespace A { export namespace B { } }`
            let inner_pos = self.pos();
            let inner = self.parse_module(inner_pos, (flags & Flags::AMBIENT) | Flags::EXPORT)?;
            self.finish_statement(inner, inner_pos);
            self.file.list(&[inner])
        } else {
            self.parse_block_of_statements(flags & Flags::AMBIENT)?
        };
        let module = self.file.add_module(Module {
            name: ModuleName::Ident(name),
            name_pos,
            flags,
            body,
            has_body: true,
            stmt: StmtId::NONE,
        });
        Ok(self.file.stmt(StmtKind::Module(module), pos))
    }

    /// The specifier of an import or an export, and the attributes after it. `type_only`: after `import type` or `export type`, the only
    /// statements whose `resolution-mode` counts (`getModeForUsageLocation`).
    fn module_specifier(&mut self, is_import: bool, type_only: bool) -> R<(Atom, ResolutionMode)> {
        if self.tok() != T::TStringLiteral {
            if !self.tolerant {
                return Err(Error::SyntaxError);
            }
            // `parseModuleSpecifier`: any expression. The parser reports 1141, and no module is looked for.
            self.attempt(|p| p.parse_expr(0).map(Some));
            return Ok((Atom::NONE, ResolutionMode::None));
        }
        let pos = self.pos();
        let spec = self.string_value()?;
        // What comes of the specifier is said whatever becomes of the rest.
        self.file.specifier_uses.push(SpecifierUse {
            spec,
            pos,
            kind: SpecifierKind::Import,
            mode: ResolutionMode::None,
        });
        self.next()?;
        let mut mode = ResolutionMode::None;
        // `tryParseImportAttributes`, `parseExportDeclaration`: `with { type: "json" }`. After an import, `with` can be on the next line.
        let is_assert = self.is_kw(b"assert");
        if (is_assert || self.tok() == T::TWith)
            && (!self.lexer.has_newline_before || is_import && !is_assert)
        {
            if is_assert {
                self.file.early_errors.push((self.pos(), 2880));
            }
            self.next()?;
            if self.tok() == T::TOpenBrace {
                if type_only {
                    mode = self.resolution_mode_override();
                }
                // The parser reported a `}` that is missed.
                if self.skip_balanced().is_err() && !self.tolerant {
                    return Err(Error::SyntaxError);
                }
            }
        }
        if let Some(last) = self.file.specifier_uses.last_mut() {
            last.mode = mode;
        }
        Ok((spec, mode))
    }

    /// A name in an import or export clause: an identifier, a keyword, or a string.
    fn clause_name(&mut self) -> R<Atom> {
        if self.tok() == T::TStringLiteral {
            let name = self.string_value()?;
            self.next()?;
            return Ok(name);
        }
        self.ident_or_keyword()
    }

    /// After `import`.
    fn parse_import(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        let mut import = Import {
            spec: Atom::NONE,
            default: Atom::NONE,
            default_pos: 0,
            namespace: Atom::NONE,
            namespace_pos: 0,
            clause_start: self.pos(),
            namespace_start: 0,
            named: Span::EMPTY,
            type_only: false,
            mode: ResolutionMode::None,
        };
        if self.tok() == T::TStringLiteral {
            (import.spec, import.mode) = self.module_specifier(true, false)?;
            if let Some(last) = self.file.specifier_uses.last_mut() {
                last.kind = SpecifierKind::SideEffect;
            }
            self.semicolon()?;
            let id = self.file.add_import(import);
            return Ok(self.file.stmt(StmtKind::Import(id), pos));
        }
        // `import type X from`, `import type { X } from`, `import type * as X from`, `import type X = require()`;
        // but `import type from "x"` imports a default called `type`.
        if self.is_kw(b"type") {
            let is_modifier = self
                .look_ahead(|p| {
                    p.next()?;
                    if matches!(p.tok(), T::TOpenBrace | T::TAsterisk) {
                        return Ok(true);
                    }
                    if !p.lexer.is_identifier_or_keyword() {
                        return Ok(false);
                    }
                    if !p.is_kw(b"from") {
                        return Ok(true);
                    }
                    p.next()?;
                    Ok(p.is_kw(b"from") || p.tok() == T::TEquals)
                })
                .unwrap_or(false);
            if is_modifier {
                self.next()?;
                import.type_only = true;
            }
        }
        // `import defer * as x from`; but `import defer from "x"`, `import defer, ..` and `import defer = ..` import something
        // called `defer`.
        let is_deferred = !import.type_only
            && self.is_kw(b"defer")
            && self.look_ahead(|p| {
                p.next()?;
                if p.is_kw(b"from") {
                    p.next()?;
                    return Ok(p.tok() != T::TStringLiteral);
                }
                Ok(!matches!(p.tok(), T::TComma | T::TEquals))
            }) == Some(true);
        let defer_at = is_deferred.then(|| self.pos());
        if is_deferred {
            self.next()?;
        }
        // `isIdentifier`: a reserved word is no name.
        if self.tok() == T::TIdentifier {
            import.default_pos = self.pos();
            import.default = self.ident_or_keyword()?;
            // `tokenAfterImportedIdentifierDefinitelyProducesImportDeclaration`: before anything else it is `import a = b`.
            if !is_deferred && self.tok() != T::TComma && !self.is_kw(b"from") {
                self.expect(T::TEquals)?;
                let mut flags = flags;
                if import.type_only {
                    flags |= Flags::TYPE_ONLY;
                }
                return self.parse_import_equals(pos, import.default, import.default_pos, flags);
            }
            if !self.eat(T::TComma)? {
                self.expect_kw(b"from")?;
                return self.finish_import(import, defer_at, pos);
            }
        } else if self.tolerant && !matches!(self.tok(), T::TAsterisk | T::TOpenBrace) {
            // `tryParseImportClause`: there is no clause.
            return self.finish_import(import, None, pos);
        }
        if self.tok() == T::TAsterisk {
            // `parseNamespaceImport`
            import.namespace_start = self.pos();
            let mut end_of_last_token = self.lexer.end as u32;
            self.next()?;
            if self.is_kw(b"as") {
                end_of_last_token = self.lexer.end as u32;
            }
            self.expect_kw(b"as")?;
            if self.tok() == T::TIdentifier {
                import.namespace_pos = self.pos();
                import.namespace = self.ident_or_keyword()?;
            } else if self.tolerant {
                // `createMissingNode`
                import.namespace_pos = end_of_last_token;
                import.namespace = known::empty;
            } else {
                return Err(Error::SyntaxError);
            }
        } else if self.tok() == T::TOpenBrace || !self.tolerant {
            // `parseBracketedList`: without the `{` there is no list, and no `}` is looked for.
            self.expect(T::TOpenBrace)?;
            let mut specs = Vec::new();
            while self.is_at_specifier()? {
                let start = self.pos();
                let (first, second, pos, type_only, imported_pos) = self.parse_clause_item()?;
                // `parseImportSpecifier`: a string with no `as` after it names nothing, and nothing is looked up.
                let is_only_a_string = pos == imported_pos
                    && matches!(self.lexer.contents.get(pos as usize), Some(b'"' | b'\''));
                if !is_only_a_string {
                    specs.push(ImportSpec {
                        start,
                        imported: first,
                        local: second,
                        pos,
                        type_only,
                        imported_pos,
                        import: ImportId(self.file.imports.len() as u32),
                    });
                }
                if !self.eat(T::TComma)? && !self.tolerant {
                    break;
                }
            }
            self.expect(T::TCloseBrace)?;
            import.named = self.file.add_import_specs(&specs);
        }
        self.expect_kw(b"from")?;
        self.finish_import(import, defer_at, pos)
    }

    /// The rest of an import declaration, from the module specifier on. `defer_at`: where the modifier `defer` of its clause is.
    fn finish_import(&mut self, mut import: Import, defer_at: Option<u32>, pos: u32) -> R<StmtId> {
        (import.spec, import.mode) = self.module_specifier(true, import.type_only)?;
        self.semicolon()?;
        if import.spec.is_none() && self.depth > 0 {
            // The checker reads the text of a specifier that is written in `declare module "m" { }`.
            return Ok(self.file.stmt(StmtKind::Empty, pos));
        }
        // `checkGrammarImportClause`. `checkImportDeclaration` only gets there if the specifier is a string.
        if let Some(at) = defer_at
            && import.spec.is_some()
        {
            if import.default.is_some() {
                self.file.early_errors.push((at, 18058));
            } else if import.namespace.is_none() {
                self.file.early_errors.push((at, 18059));
            }
        }
        let id = self.file.add_import(import);
        Ok(self.file.stmt(StmtKind::Import(id), pos))
    }

    /// `parseDelimitedList(PCImportOrExportSpecifiers)`: whether another specifier starts here, after the tokens the parser skipped.
    fn is_at_specifier(&mut self) -> R<bool> {
        loop {
            // `isListElement`: `from "mod"` ends a list that is not closed.
            if self.is_kw(b"from")
                && self.look_ahead(|p| p.next().map(|()| p.tok() == T::TStringLiteral))
                    == Some(true)
            {
                return Ok(false);
            }
            if self.lexer.is_identifier_or_keyword() || self.tok() == T::TStringLiteral {
                return Ok(true);
            }
            // `abortParsingListOrMoveToNextToken`: a token that can start a statement ends the list.
            let is_skipped = self.is_skipped_in_recovery()
                || matches!(
                    self.tok(),
                    T::TQuestion | T::TDotDotDot | T::TCloseParen | T::TCloseBracket
                );
            if !self.tolerant || !is_skipped {
                return Ok(false);
            }
            self.next()?;
        }
    }

    /// `a`, `a as b`, `type a`, `type a as b`, and the ways `type` and `as` can be names themselves. Gives the name
    /// before `as`, the one after it, where the latter is, and whether `type` was a modifier.
    /// The first name, the second, where the second is, whether it says `type`, and where the first is.
    fn parse_clause_item(&mut self) -> R<(Atom, Atom, u32, bool, u32)> {
        let mut type_only = false;
        let mut pos = self.pos();
        let mut first = self.clause_name()?;
        let type_atom = self.atom(b"type");
        let can_be_name =
            |p: &Self| p.lexer.is_identifier_or_keyword() || p.tok() == T::TStringLiteral;
        if first == type_atom && can_be_name(self) {
            if self.is_kw(b"as") {
                // `type as` ...
                let as_pos = self.pos();
                self.next()?;
                if self.is_kw(b"as") {
                    // `type as as` ...
                    let second_as_pos = self.pos();
                    self.next()?;
                    if can_be_name(self) {
                        // `type as as x`: the type `as`, as `x`
                        let pos = self.pos();
                        let second = self.clause_name()?;
                        return Ok((self.atoms.intern(b"as"), second, pos, true, as_pos));
                    }
                    // `type as as`: `type`, as `as`
                    return Ok((first, self.atoms.intern(b"as"), second_as_pos, false, pos));
                }
                if can_be_name(self) {
                    // `type as x`: `type`, as `x`
                    let second_pos = self.pos();
                    let second = self.clause_name()?;
                    return Ok((first, second, second_pos, false, pos));
                }
                // `type as`: the type `as`
                let name = self.atoms.intern(b"as");
                return Ok((name, name, as_pos, true, as_pos));
            }
            type_only = true;
            pos = self.pos();
            first = self.clause_name()?;
        }
        if self.is_kw(b"as") {
            let end_of_as = self.lexer.end as u32;
            self.next()?;
            if self.tolerant && !can_be_name(self) {
                // `parseModuleExportName`: a missing name, which the parser reported.
                return Ok((first, known::empty, end_of_as, type_only, pos));
            }
            let second_pos = self.pos();
            let second = self.clause_name()?;
            return Ok((first, second, second_pos, type_only, pos));
        }
        Ok((first, first, pos, type_only, pos))
    }

    /// After `import x =`.
    fn parse_import_equals(
        &mut self,
        pos: u32,
        name: Atom,
        name_pos: u32,
        flags: Flags,
    ) -> R<StmtId> {
        let target = if self.is_kw(b"require")
            && self.look_ahead(|p| p.next().map(|()| p.tok() == T::TOpenParen)) == Some(true)
        {
            self.next()?;
            let argument = self.look_ahead(|p| p.next().map(|()| (p.tok(), p.pos())));
            if let Some((token, at)) = argument
                && token != T::TStringLiteral
            {
                return self.parse_require_of_expression(pos, name, name_pos, flags, token, at);
            }
            self.next()?;
            if self.tok() != T::TStringLiteral {
                return Err(Error::SyntaxError);
            }
            let spec_pos = self.pos();
            let spec = self.string_value()?;
            self.file.specifier_uses.push(SpecifierUse {
                spec,
                pos: spec_pos,
                kind: SpecifierKind::Require,
                mode: ResolutionMode::None,
            });
            self.next()?;
            self.expect(T::TCloseParen)?;
            ImportEqualsTarget::Require(spec)
        } else {
            ImportEqualsTarget::Entity(self.parse_entity_name(false)?)
        };
        self.semicolon()?;
        let id = self.file.add_import_equals(ImportEquals {
            name,
            name_pos,
            target,
            flags,
            stmt: StmtId::NONE,
        });
        Ok(self.file.stmt(StmtKind::ImportEquals(id), pos))
    }

    /// `import x = require(e)`, at the `(`. `parseModuleSpecifier` takes any expression. `first` is its first token, which is at `at`.
    #[cold]
    fn parse_require_of_expression(
        &mut self,
        pos: u32,
        name: Atom,
        name_pos: u32,
        flags: Flags,
        first: T,
        at: u32,
    ) -> R<StmtId> {
        let is_missing = first == T::TCloseParen;
        if is_missing && !self.tolerant {
            return Err(Error::SyntaxError);
        }
        self.skip_balanced()?;
        self.semicolon()?;
        // `checkExternalImportOrExportDeclaration`
        if !is_missing {
            self.file.checker_errors.push((at, 1141));
        }
        if self.depth > 0 {
            // The checker reads the text of a specifier that is written in `declare module "m" { }`.
            return Ok(self.file.stmt(StmtKind::Empty, pos));
        }
        let target = ImportEqualsTarget::Require(Atom::NONE);
        let id = self.file.add_import_equals(ImportEquals {
            name,
            name_pos,
            target,
            flags,
            stmt: StmtId::NONE,
        });
        Ok(self.file.stmt(StmtKind::ImportEquals(id), pos))
    }

    /// After `export`.
    fn parse_export(&mut self, pos: u32, flags: Flags) -> R<StmtId> {
        match self.tok() {
            T::TDefault => {
                self.push_statement_modifier(Flags::DEFAULT);
                self.next()?;
                let flags = flags | Flags::EXPORT | Flags::DEFAULT;
                match self.tok() {
                    T::TFunction => return self.parse_function(pos, flags),
                    T::TClass => return self.parse_class(pos, flags),
                    T::TIdentifier => match { self.lexer.identifier } {
                        b"abstract"
                            if self.look_ahead(|p| p.next().map(|()| p.tok() == T::TClass))
                                == Some(true) =>
                        {
                            self.push_statement_modifier(Flags::ABSTRACT);
                            self.next()?;
                            return self.parse_class(pos, flags | Flags::ABSTRACT);
                        }
                        b"async"
                            if self.look_ahead(|p| p.next().map(|()| p.tok() == T::TFunction))
                                == Some(true) =>
                        {
                            self.push_statement_modifier(Flags::ASYNC);
                            self.next()?;
                            return self.parse_function(pos, flags | Flags::ASYNC);
                        }
                        b"interface"
                            if self
                                .look_ahead(|p| p.next().map(|()| p.tok() == T::TIdentifier))
                                == Some(true) =>
                        {
                            return self.parse_interface(pos, flags);
                        }
                        _ => {}
                    },
                    _ => {}
                }
                let expr = self.parse_expr(1)?;
                self.semicolon()?;
                Ok(self.file.stmt(StmtKind::ExportDefault(expr), pos))
            }
            T::TEquals => {
                self.next()?;
                // Not TypeScript, but some tools write it.
                match self.tok() {
                    T::TFunction => {
                        return self.parse_function(pos, flags | Flags::EXPORT | Flags::DEFAULT);
                    }
                    T::TClass => {
                        return self.parse_class(pos, flags | Flags::EXPORT | Flags::DEFAULT);
                    }
                    _ => {}
                }
                let expr = self.parse_expr(1)?;
                self.semicolon()?;
                Ok(self.file.stmt(StmtKind::ExportAssign(expr), pos))
            }
            T::TAsterisk => self.parse_export_star(pos, false),
            T::TOpenBrace => self.parse_export_clause(pos, false),
            T::TImport => {
                // `parseDeclarationWorker`: there is one import parser, whatever the modifiers.
                self.next()?;
                let stmt = self.parse_import(pos, flags | Flags::EXPORT)?;
                // `checkImportDeclaration`: only `import a = b` takes modifiers.
                if matches!(self.file[stmt].kind, StmtKind::Import(_)) {
                    self.file.early_errors.push((pos, 1191));
                }
                Ok(stmt)
            }
            T::TIdentifier if self.lexer.identifier == b"as" => {
                self.next()?;
                if !self.eat_kw(b"namespace")? {
                    return Err(Error::SyntaxError);
                }
                let name = self.ident_or_keyword()?;
                self.semicolon()?;
                Ok(self.file.stmt(StmtKind::ExportAsNamespace(name), pos))
            }
            T::TIdentifier
                if self.lexer.identifier == b"type"
                    && self.look_ahead(|p| {
                        p.next()
                            .map(|()| matches!(p.tok(), T::TOpenBrace | T::TAsterisk))
                    }) == Some(true) =>
            {
                self.next()?;
                if self.tok() == T::TAsterisk {
                    return self.parse_export_star(pos, true);
                }
                self.parse_export_clause(pos, true)
            }
            _ => {
                // An `export` that starts no declaration has been reported (1128) and skipped.
                if self.tolerant && self.tok() != T::TAt && !self.is_start_of_declaration() {
                    return self.parse_statement(flags);
                }
                let stmt = self.parse_statement(flags | Flags::EXPORT)?;
                self.file[stmt].pos = pos;
                Ok(stmt)
            }
        }
    }

    /// `type_only`: after `export type`.
    fn parse_export_star(&mut self, pos: u32, type_only: bool) -> R<StmtId> {
        let star_pos = self.pos();
        self.expect(T::TAsterisk)?;
        let has_alias = self.eat_kw(b"as")?;
        let alias_pos = self.pos();
        let alias = if has_alias {
            self.clause_name()?
        } else {
            Atom::NONE
        };
        self.expect_kw(b"from")?;
        let (spec, mode) = self.module_specifier(false, type_only)?;
        self.semicolon()?;
        if spec.is_none() {
            // `checkExportDeclaration` looks no further than the specifier that is not a string.
            return Ok(self.file.stmt(StmtKind::Empty, pos));
        }
        Ok(self.file.stmt(
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                mode,
                star_pos,
                alias_pos,
            },
            pos,
        ))
    }

    fn parse_export_clause(&mut self, pos: u32, type_only: bool) -> R<StmtId> {
        self.expect(T::TOpenBrace)?;
        let mut specs = Vec::new();
        while self.is_at_specifier()? {
            let start = self.pos();
            let (local, exported, pos, type_only, local_pos) = self.parse_clause_item()?;
            specs.push(ExportSpec {
                start,
                local,
                exported,
                pos,
                type_only,
                local_pos,
                export: ExportId(self.file.exports.len() as u32),
            });
            if !self.eat(T::TComma)? && !self.tolerant {
                break;
            }
        }
        self.expect(T::TCloseBrace)?;
        // `parseExportDeclaration`: a string on the same line is a specifier whose `from` is missing.
        let has_specifier = self.is_kw(b"from")
            || self.tolerant && self.tok() == T::TStringLiteral && !self.lexer.has_newline_before;
        let (spec, mode) = if has_specifier {
            self.eat_kw(b"from")?;
            self.module_specifier(false, type_only)?
        } else {
            (Atom::NONE, ResolutionMode::None)
        };
        self.semicolon()?;
        if has_specifier && spec.is_none() {
            // `checkExportDeclaration` looks no further than the specifier that is not a string.
            return Ok(self.file.stmt(StmtKind::Empty, pos));
        }
        // `checkModuleExportName`: without `from`, a string before `as` names nothing.
        if !has_specifier {
            for s in &specs {
                if s.pos != s.local_pos
                    && matches!(
                        self.lexer.contents.get(s.local_pos as usize),
                        Some(b'"' | b'\'')
                    )
                {
                    self.file.early_errors.push((s.local_pos, 1003));
                }
            }
        }
        let items = self.file.add_export_specs(&specs);
        let id = self.file.add_export(Export {
            spec,
            items,
            type_only,
            mode,
        });
        Ok(self.file.stmt(StmtKind::ExportNamed(id), pos))
    }
}
