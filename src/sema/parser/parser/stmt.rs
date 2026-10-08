//! Statements and declarations.

use super::{Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::Atom;
use bun_sema::hir::*;

/// The first token of a node: its start, and `node.Pos()`.
#[derive(Copy, Clone)]
pub(crate) struct Start {
    pub(crate) pos: u32,
    pub(crate) full: u32,
}

/// `ModifierToFlag`
pub(crate) fn modifier_flag(token: T) -> Flags {
    match token {
        T::Abstract => Flags::ABSTRACT,
        T::Accessor => Flags::ACCESSOR,
        T::Async => Flags::ASYNC,
        T::Const => Flags::CONST,
        T::Declare => Flags::AMBIENT,
        T::Default => Flags::DEFAULT,
        T::Export => Flags::EXPORT,
        T::In => Flags::IN,
        T::Out => Flags::OUT,
        T::Override => Flags::OVERRIDE,
        T::Private => Flags::PRIVATE,
        T::Protected => Flags::PROTECTED,
        T::Public => Flags::PUBLIC,
        T::Readonly => Flags::READONLY,
        T::Static => Flags::STATIC,
        _ => Flags::empty(),
    }
}

impl Parser<'_> {
    #[inline(always)]
    pub(crate) fn start(&self) -> Start {
        Start {
            pos: self.lx.start,
            full: self.lx.full_start,
        }
    }

    /// `finishNode` for a statement that ends with the previous token.
    #[inline]
    pub(crate) fn add_stmt(
        &mut self,
        kind: StmtKind,
        start: Start,
        modifiers: Span<ModifierId>,
    ) -> StmtId {
        let id = StmtId(self.f.stmts.len() as u32);
        self.f.stmts.push(Stmt {
            kind,
            start: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
            modifiers,
        });
        id
    }

    /// `parseStatement`
    pub(crate) fn statement(&mut self) -> StmtId {
        if self.is_too_deep() {
            return StmtId::NONE;
        }
        let start = self.start();
        match self.token() {
            T::Semicolon => {
                self.next();
                self.add_stmt(StmtKind::Empty, start, Span::EMPTY)
            }
            T::OpenBrace => self.block(),
            T::Var | T::Const => self.declaration(),
            T::Let if self.is_let_declaration() => self.declaration(),
            T::Await if self.is_await_using_declaration() => self.declaration(),
            T::Using if self.is_using_declaration() => self.declaration(),
            T::Function | T::Class | T::Enum | T::At => self.declaration(),
            T::If => self.if_statement(),
            T::Do => self.do_statement(),
            T::While => self.while_statement(),
            T::For => self.for_statement(),
            T::Continue | T::Break => self.break_or_continue(),
            T::Return => self.return_statement(),
            T::With => self.with_statement(),
            T::Switch => self.switch_statement(),
            T::Throw => self.throw_statement(),
            T::Try => self.try_statement(),
            T::Debugger => {
                self.next();
                self.semicolon();
                self.add_stmt(StmtKind::Debugger, start, Span::EMPTY)
            }
            // Nothing but `function` follows it in a declaration.
            T::Async if self.is_ecmascript && !self.next_is_function_on_same_line() => {
                self.expression_or_labeled_statement()
            }
            T::Async
            | T::Interface
            | T::Type
            | T::Module
            | T::Namespace
            | T::Declare
            | T::Export
            | T::Import
            | T::Private
            | T::Protected
            | T::Public
            | T::Abstract
            | T::Accessor
            | T::Static
            | T::Readonly
            | T::Global
                if self.is_start_of_declaration() =>
            {
                self.declaration()
            }
            // `isStartOfStatement`: "they may be the start of a class member if an identifier
            // immediately follows. Otherwise they're an identifier in an expression statement."
            T::Private | T::Protected | T::Public | T::Accessor | T::Static | T::Readonly
                if !self.is_ecmascript && self.is_followed_by_word_on_same_line() =>
            {
                self.fail();
                StmtId::NONE
            }
            _ => self.expression_or_labeled_statement(),
        }
    }

    /// `nextTokenIsBindingIdentifierOrStartOfDestructuring`
    fn is_let_declaration(&mut self) -> bool {
        let is_ecmascript = self.is_ecmascript;
        self.look_ahead(|p| {
            p.next();
            match p.token() {
                T::OpenBrace | T::OpenBracket => true,
                // acorn's `isLet`
                T::In | T::InstanceOf if is_ecmascript => false,
                token if is_ecmascript => token.is_identifier_or_keyword(),
                _ => p.is_binding_identifier(),
            }
        })
    }

    /// `parseStatement` where a declaration cannot be: the body of an `if`, of a loop, of a `with`
    /// or of a label. For acorn `let` is a name there, unless a `[` or a name with an escape follows.
    pub(crate) fn embedded_statement(&mut self) -> StmtId {
        if self.token() == T::Let && self.is_ecmascript {
            let is_declaration = self.look_ahead(|p| {
                p.next();
                p.token() == T::OpenBracket || p.token() == T::Identifier && p.lx.has_escape
            });
            if !is_declaration {
                return self.expression_or_labeled_statement();
            }
        }
        let statement = self.statement();
        // The other parser takes these for statements of the file if no block is around them.
        if let Some(Stmt {
            kind: StmtKind::Import(_) | StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. },
            ..
        }) = self.f.stmts.get(statement.idx())
        {
            self.f.has_module_syntax = true;
        }
        statement
    }

    /// `nextTokenIsBindingIdentifierOrStartOfDestructuringOnSameLine`
    fn next_is_binding_on_same_line(&mut self, disallow_of: bool) -> bool {
        self.next();
        if disallow_of && self.token() == T::Of {
            return matches!(self.peek(), T::Equals | T::Semicolon | T::Colon);
        }
        (self.is_binding_identifier() || self.token() == T::OpenBrace) && !self.newline_before()
    }

    fn is_using_declaration(&mut self) -> bool {
        self.look_ahead(|p| p.next_is_binding_on_same_line(false))
    }

    fn is_await_using_declaration(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            // Only acorn asks for `using` on the line of `await`.
            p.token() == T::Using
                && !(p.newline_before() && p.is_ecmascript)
                && p.next_is_binding_on_same_line(false)
        })
    }

    /// `isStartOfDeclaration`
    fn is_start_of_declaration(&mut self) -> bool {
        self.look_ahead(Self::is_declaration)
    }

    /// `isDeclaration`
    fn is_declaration(&mut self) -> bool {
        loop {
            match self.token() {
                T::Var | T::Let | T::Const | T::Function | T::Class | T::Enum => return true,
                T::Using => return self.is_using_declaration(),
                T::Await => return self.is_await_using_declaration(),
                T::Interface | T::Type => {
                    self.next();
                    return self.is_identifier() && !self.newline_before();
                }
                T::Module | T::Namespace => {
                    self.next();
                    return !self.newline_before()
                        && (self.is_identifier() || self.token() == T::String);
                }
                T::Abstract
                | T::Accessor
                | T::Async
                | T::Declare
                | T::Private
                | T::Protected
                | T::Public
                | T::Readonly => {
                    let previous = self.token();
                    self.next();
                    // "ASI takes effect for this modifier."
                    if self.newline_before() {
                        return false;
                    }
                    if previous == T::Declare && self.token() == T::Type {
                        // "If we see 'declare type', then commit to parsing a type alias."
                        return true;
                    }
                }
                T::Global => {
                    self.next();
                    return !self.is_ecmascript
                        && matches!(self.token(), T::OpenBrace | T::Identifier | T::Export);
                }
                T::Import => {
                    self.next();
                    return matches!(self.token(), T::String | T::Asterisk | T::OpenBrace)
                        || self.token().is_identifier_or_keyword();
                }
                T::Export => {
                    self.next();
                    let mut current = self.token();
                    if current == T::Type {
                        current = self.peek();
                    }
                    if matches!(
                        current,
                        T::Equals | T::Asterisk | T::OpenBrace | T::Default | T::As | T::At
                    ) {
                        return true;
                    }
                }
                T::Static => self.next(),
                _ => return false,
            }
        }
    }

    // ───────────────────────────── modifiers ─────────────────────────────

    /// `isLiteralPropertyName`
    #[inline]
    pub(crate) fn is_literal_property_name(&self) -> bool {
        self.token().is_identifier_or_keyword()
            || matches!(self.token(), T::String | T::Number | T::BigInt)
    }

    /// `canFollowModifier`
    fn can_follow_modifier(&self) -> bool {
        matches!(
            self.token(),
            T::OpenBracket | T::OpenBrace | T::Asterisk | T::DotDotDot
        ) || self.is_literal_property_name()
    }

    /// `canFollowExportModifier`
    fn can_follow_export_modifier(&self) -> bool {
        self.token() == T::At
            || !matches!(self.token(), T::Asterisk | T::As | T::OpenBrace)
                && self.can_follow_modifier()
    }

    /// `nextTokenCanFollowDefaultKeyword`
    fn next_can_follow_default_keyword(&mut self) -> bool {
        self.next();
        match self.token() {
            T::Class | T::Function | T::Interface | T::At => true,
            T::Abstract => self.look_ahead(|p| {
                p.next();
                p.token() == T::Class && !p.newline_before()
            }),
            T::Async => self.look_ahead(|p| {
                p.next();
                p.token() == T::Function && !p.newline_before()
            }),
            _ => false,
        }
    }

    /// `nextTokenCanFollowModifier`. It leaves the parser after the modifier.
    fn next_can_follow_modifier(&mut self) -> bool {
        match self.token() {
            // "'const' is only a modifier if followed by 'enum'."
            T::Const => {
                self.next();
                self.token() == T::Enum
            }
            T::Export => {
                self.next();
                match self.token() {
                    T::Default => self.look_ahead(Self::next_can_follow_default_keyword),
                    T::Type => self.look_ahead(|p| {
                        p.next();
                        p.can_follow_export_modifier()
                    }),
                    _ => self.can_follow_export_modifier(),
                }
            }
            T::Default => self.next_can_follow_default_keyword_without_consuming(),
            T::Static | T::Get | T::Set => {
                self.next();
                self.can_follow_modifier()
            }
            _ => {
                self.next();
                !self.newline_before() && self.can_follow_modifier()
            }
        }
    }

    /// `nextTokenCanFollowDefaultKeyword` consumes `default` alone.
    fn next_can_follow_default_keyword_without_consuming(&mut self) -> bool {
        self.next_can_follow_default_keyword()
    }

    /// `parseModifiers`: pushes the modifiers at the token on the stack of modifiers. Returns their
    /// flags. The caller pops them from `base`, the length of the stack before.
    pub(crate) fn modifiers(
        &mut self,
        allow_decorators: bool,
        permit_const: bool,
        stop_on_static_block: bool,
    ) -> Flags {
        let mut flags = Flags::empty();
        loop {
            let token = self.token();
            if token == T::At {
                if !allow_decorators {
                    self.fail();
                    return flags;
                }
                self.decorator();
                continue;
            }
            if !token.is_modifier() {
                return flags;
            }
            let pos = self.pos();
            let mark = self.lx.mark();
            let is_modifier = if token == T::Const && permit_const {
                // "We need to ensure that any subsequent modifiers appear on the same line"
                self.next();
                !self.newline_before() && self.can_follow_modifier()
            } else if token == T::Static
                && (flags.contains(Flags::STATIC)
                    || stop_on_static_block && self.peek() == T::OpenBrace)
            {
                return flags;
            } else {
                self.next_can_follow_modifier()
            };
            if !is_modifier {
                self.lx.reset(mark);
                return flags;
            }
            let flag = modifier_flag(token);
            // The other parser does not go on after `export export`.
            if flags.contains(flag) && flag.intersects(Flags::EXPORT | Flags::DEFAULT) {
                self.report();
            }
            flags |= flag;
            self.s.modifiers.push(Modifier {
                kind: ModifierKind::Keyword(flag),
                pos,
            });
        }
    }

    /// `tryParseDecorator`: pushes it on the stack of modifiers.
    fn decorator(&mut self) {
        let pos = self.pos();
        self.expect(T::At);
        let saved = self.enter_context(ctx::DECORATOR, 0);
        let expression = self.decorator_expression();
        self.context = saved;
        self.s.modifiers.push(Modifier {
            kind: ModifierKind::Decorator(expression),
            pos,
        });
    }

    /// Pops the modifiers from `base` on and makes them a list of the file.
    pub(crate) fn take_modifiers(&mut self, base: usize) -> Span<ModifierId> {
        if self.s.modifiers.len() == base {
            return Span::EMPTY;
        }
        take_span!(self, modifiers, base)
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// `parseDeclaration`
    fn declaration(&mut self) -> StmtId {
        let start = self.start();
        let base = self.s.modifiers.len();
        // The common declarations have no modifier.
        let flags = match self.token() {
            T::Var | T::Let | T::Function | T::Class | T::Enum | T::Import | T::Interface
            | T::Type => Flags::empty(),
            _ => self.modifiers(true, false, false),
        };
        // No other modifier is before a declaration.
        if self.is_ecmascript
            && (flags.intersects(!(Flags::EXPORT | Flags::DEFAULT | Flags::ASYNC))
                || flags.contains(Flags::ASYNC) && self.token() != T::Function)
        {
            self.report();
        }
        if flags.intersects(Flags::IN | Flags::OUT) {
            self.report();
        }

        let saved = self.context;
        if flags.contains(Flags::AMBIENT) {
            self.context |= ctx::AMBIENT;
        }
        let statement = self.declaration_worker(start, base, flags);
        self.context = saved;
        if self.options.is_javascript {
            self.check_js_statement(statement);
        }
        statement
    }

    /// `parseDeclarationWorker`
    fn declaration_worker(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        match self.token() {
            T::Var | T::Let | T::Const | T::Using | T::Await => {
                self.variable_statement(start, base, flags)
            }
            T::Function => self.function_declaration(start, base, flags),
            T::Class => self.class_declaration(start, base, flags),
            T::Interface => self.interface_declaration(start, base, flags),
            T::Type => self.type_alias_declaration(start, base, flags),
            T::Enum => self.enum_declaration(start, base, flags),
            T::Global if self.is_ecmascript => {
                self.fail();
                StmtId::NONE
            }
            T::Global | T::Module | T::Namespace => self.module_declaration(start, base, flags),
            T::Import => self.import_declaration_or_import_equals(start, base, flags),
            T::Export => {
                self.next();
                match self.token() {
                    T::Default | T::Equals => self.export_assignment(start, base),
                    T::As => self.namespace_export_declaration(start, base),
                    _ => self.export_declaration(start, base),
                }
            }
            _ => {
                self.fail();
                StmtId::NONE
            }
        }
    }

    /// `parseVariableStatement`
    fn variable_statement(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        let decls = self.variable_declaration_list(false, flags & Flags::EXPORT);
        self.semicolon();
        let modifiers = self.take_modifiers(base);
        self.add_stmt(StmtKind::Var(decls), start, modifiers)
    }

    /// `parseVariableDeclarationList`
    fn variable_declaration_list(&mut self, is_in_for: bool, flags: Flags) -> Span<VarDeclId> {
        let kind = match self.token() {
            T::Var => VarKind::Var,
            T::Let => VarKind::Let,
            T::Const => VarKind::Const,
            T::Using => VarKind::Using,
            _ => {
                self.note_await();
                self.next();
                VarKind::AwaitUsing
            }
        };
        self.next();
        let flags = flags | self.ambient();
        let saved = match is_in_for {
            true => self.enter_context(ctx::DISALLOW_IN, 0),
            false => self.enter_context(0, ctx::DISALLOW_IN),
        };
        let base = self.s.var_decls.len();
        loop {
            // `parseVariableDeclaration`
            let full = self.full_start();
            let pat = self.identifier_or_pattern();
            let mut flags = flags;
            if !is_in_for
                && self.token() == T::Exclamation
                && !self.newline_before()
                && matches!(self.f.pats.get(pat.idx()), Some(Pat { kind: PatKind::Ident(_), .. }))
            {
                self.next();
                flags |= Flags::DEFINITE;
            }
            let ty = self.type_annotation();
            let init = match self.token() {
                T::Equals => self.initializer(),
                _ => ExprId::NONE,
            };
            self.s.var_decls.push(VarDecl {
                pat,
                ty,
                init,
                kind,
                flags,
                loc: TextRange {
                    pos: full,
                    end: self.prev_end(),
                },
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        take_span!(self, var_decls, base)
    }

    /// `parseInitializer`, at the `=`.
    #[inline]
    pub(crate) fn initializer(&mut self) -> ExprId {
        self.next();
        self.assignment_expression()
    }

    /// `parseInitializer`
    #[inline]
    pub(crate) fn optional_initializer(&mut self) -> ExprId {
        match self.token() {
            T::Equals => self.initializer(),
            _ => ExprId::NONE,
        }
    }

    /// `parseEnumDeclaration`
    fn enum_declaration(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.next();
        let (name, name_pos) = self.identifier();
        self.expect(T::OpenBrace);
        let saved = self.enter_context(0, ctx::YIELD | ctx::AWAIT);
        let members = self.s.enum_members.len();
        while self.is_in_list(T::CloseBrace) {
            // `parseEnumMember`
            let member = self.start();
            // The checker reports a number, a computed name and so on.
            let bigint = (self.token() == T::BigInt).then(|| self.lx.text());
            let (mut key, mut name_kind, _) = self.property_name();
            if let Some(written) = bigint {
                key = PropKey::Name(self.atom(written));
            }
            let (name, computed_name) = match key {
                PropKey::Name(name) | PropKey::Private(name) => (name, ExprId::NONE),
                PropKey::Computed(e) => {
                    name_kind = NameKind::Identifier;
                    (Atom::NONE, e)
                }
                PropKey::None => (Atom::NONE, ExprId::NONE),
            };
            let saved = self.enter_context(0, ctx::DISALLOW_IN);
            let init = self.optional_initializer();
            self.context = saved;
            self.s.enum_members.push(EnumMember {
                name,
                name_kind,
                computed_name,
                init,
                pos: member.pos,
                loc: TextRange {
                    pos: member.full,
                    end: self.prev_end(),
                },
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        self.expect(T::CloseBrace);
        let members = take_span!(self, enum_members, members);
        let declaration = self.f.add_enum(Enum {
            name,
            name_pos,
            flags: self.ambient() | flags & (Flags::CONST | Flags::EXPORT),
            members,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::Enum(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseModuleDeclaration`
    fn module_declaration(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        let flags = self.ambient() | flags & Flags::EXPORT;
        let (name, name_pos, specifies_module);
        match self.token() {
            // `parseAmbientExternalModuleDeclaration`
            T::Global => {
                (name, name_pos, specifies_module) = (ModuleName::Global, self.pos(), false);
                self.next();
            }
            keyword => {
                self.next();
                if self.token() == T::String && keyword == T::Namespace {
                    self.report();
                }
                if self.token() != T::String {
                    let modifiers = self.take_modifiers(base);
                    return self.namespace_declaration(
                        start,
                        modifiers,
                        flags,
                        keyword == T::Module,
                    );
                }
                (name, name_pos) = (ModuleName::String(self.lx.atom), self.pos());
                specifies_module = false;
                self.next();
            }
        }
        let (body, has_body) = match self.token() {
            T::OpenBrace => (self.module_block(), true),
            _ => {
                self.semicolon();
                (IdList::EMPTY, false)
            }
        };
        let declaration = self.f.add_module(Module {
            name,
            name_pos,
            flags,
            body,
            has_body,
            specifies_module,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::Module(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseModuleOrNamespaceDeclaration`, at the name.
    fn namespace_declaration(
        &mut self,
        start: Start,
        modifiers: Span<ModifierId>,
        flags: Flags,
        specifies_module: bool,
    ) -> StmtId {
        if self.is_too_deep() {
            return StmtId::NONE;
        }
        let (name, name_pos) = self.identifier();
        let body = if self.token() == T::Dot {
            self.next();
            // The `b` of `namespace a.b` is exported from `a`, and starts with its name.
            let inner = self.start();
            let flags = flags & Flags::AMBIENT | Flags::EXPORT;
            let inner = self.namespace_declaration(inner, Span::EMPTY, flags, specifies_module);
            if self.options.is_javascript {
                self.check_js_statement(inner);
            }
            self.f.list(&[inner])
        } else {
            self.module_block()
        };
        let declaration = self.f.add_module(Module {
            name: ModuleName::Ident(name),
            name_pos,
            flags,
            body,
            has_body: true,
            specifies_module,
            stmt: StmtId::NONE,
        });
        let statement = self.add_stmt(StmtKind::Module(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseModuleBlock`
    fn module_block(&mut self) -> IdList<StmtId> {
        self.expect(T::OpenBrace);
        let saved = self.enter_context(0, ctx::TOP_LEVEL | ctx::AWAIT | ctx::YIELD);
        let list = self.statements_until_close_brace();
        self.context = saved;
        self.expect(T::CloseBrace);
        list
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// `parseList(PCBlockStatements, parseStatement)`
    #[inline]
    pub(crate) fn statements_until_close_brace(&mut self) -> IdList<StmtId> {
        let base = self.s.ids.len();
        // Only a statement of the file makes it a module.
        let was_module = self.f.has_module_syntax;
        while self.is_in_list(T::CloseBrace) {
            let statement = self.statement();
            self.s.ids.push(statement.0);
        }
        self.f.has_module_syntax = was_module;
        self.take_ids(base)
    }

    /// `parseBlock`
    pub(crate) fn block(&mut self) -> StmtId {
        let start = self.start();
        self.expect(T::OpenBrace);
        let list = self.statements_until_close_brace();
        self.expect(T::CloseBrace);
        self.add_stmt(StmtKind::Block(list), start, Span::EMPTY)
    }

    /// `(` expression `)`
    fn parenthesized_condition(&mut self) -> ExprId {
        self.expect(T::OpenParen);
        let test = self.expression_allowing_in();
        self.expect(T::CloseParen);
        test
    }

    fn if_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let test = self.parenthesized_condition();
        let yes = self.embedded_statement();
        let no = match self.eat(T::Else) {
            true => self.embedded_statement(),
            false => StmtId::NONE,
        };
        self.add_stmt(StmtKind::If { test, yes, no }, start, Span::EMPTY)
    }

    fn do_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let body = self.embedded_statement();
        self.expect(T::While);
        let test = self.parenthesized_condition();
        // "do;while(0)x will have a semicolon inserted before x."
        self.eat(T::Semicolon);
        self.add_stmt(StmtKind::DoWhile { body, test }, start, Span::EMPTY)
    }

    fn while_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let test = self.parenthesized_condition();
        let body = self.embedded_statement();
        self.add_stmt(StmtKind::While { test, body }, start, Span::EMPTY)
    }

    /// `parseWithStatement`: a block of the expression, as a statement, and the body.
    fn with_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        self.expect(T::OpenParen);
        let full = self.full_start();
        let object = self.expression_allowing_in();
        let object = self.add_stmt(StmtKind::Expr(object), start, Span::EMPTY);
        if let Some(statement) = self.f.stmts.get_mut(object.idx()) {
            statement.loc.pos = full;
        }
        let close = self.pos();
        self.expect(T::CloseParen);
        let body = self.embedded_statement();
        let end = self.f.stmts.get(body.idx()).map_or(0, |it| it.loc.end);
        self.f.with_bodies.push((close + 1, end));
        let list = self.f.list(&[object, body]);
        self.add_stmt(StmtKind::Block(list), start, Span::EMPTY)
    }

    /// `parseForOrForInOrForOfStatement`
    fn for_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let is_await = self.token() == T::Await;
        if is_await {
            self.note_await();
            self.next();
        }
        self.expect(T::OpenParen);
        let mut init = StmtId::NONE;
        let mut starts_with_let = false;
        if self.token() != T::Semicolon {
            let at = self.start();
            starts_with_let = self.token() == T::Let;
            let is_declaration = match self.token() {
                T::Let if self.is_ecmascript => self.is_let_declaration(),
                T::Var | T::Let | T::Const => true,
                T::Using => self.look_ahead(|p| p.next_is_binding_on_same_line(true)),
                T::Await => self.is_await_using_declaration(),
                _ => false,
            };
            let kind = if is_declaration {
                StmtKind::Var(self.variable_declaration_list(true, Flags::empty()))
            } else {
                let saved = self.enter_context(ctx::DISALLOW_IN, 0);
                let expression = self.expression();
                self.context = saved;
                StmtKind::Expr(expression)
            };
            init = self.add_stmt(kind, at, Span::EMPTY);
        }
        let kind = if is_await || self.token() == T::Of {
            let is_expression = |it: &Stmt| matches!(it.kind, StmtKind::Expr(_));
            if starts_with_let && self.f.stmts.get(init.idx()).is_some_and(is_expression) {
                self.report();
            }
            self.expect(T::Of);
            let saved = self.enter_context(0, ctx::DISALLOW_IN);
            let expr = self.assignment_expression();
            self.context = saved;
            self.expect(T::CloseParen);
            let body = self.embedded_statement();
            StmtKind::ForOf {
                left: init,
                expr,
                body,
                is_await,
            }
        } else if self.eat(T::In) {
            let expr = self.expression_allowing_in();
            self.expect(T::CloseParen);
            let body = self.embedded_statement();
            StmtKind::ForIn {
                left: init,
                expr,
                body,
            }
        } else {
            self.expect(T::Semicolon);
            let test = match self.token() {
                T::Semicolon | T::CloseParen => ExprId::NONE,
                _ => self.expression_allowing_in(),
            };
            self.expect(T::Semicolon);
            let update = match self.token() {
                T::CloseParen => ExprId::NONE,
                _ => self.expression_allowing_in(),
            };
            self.expect(T::CloseParen);
            let body = self.embedded_statement();
            StmtKind::For {
                init,
                test,
                update,
                body,
            }
        };
        if init.is_none() && !matches!(kind, StmtKind::For { .. }) {
            self.fail();
        }
        self.add_stmt(kind, start, Span::EMPTY)
    }

    fn break_or_continue(&mut self) -> StmtId {
        let start = self.start();
        let is_break = self.token() == T::Break;
        self.next();
        let label = match self.can_parse_semicolon() {
            true => Atom::NONE,
            false => {
                // The reference notes the name at the start of the statement.
                let (label, _) = (self.lx.atom, self.is_identifier() || {
                    self.fail();
                    false
                });
                self.note_identifier(label, start.pos);
                self.next();
                label
            }
        };
        self.semicolon();
        let kind = match is_break {
            true => StmtKind::Break(label),
            false => StmtKind::Continue(label),
        };
        self.add_stmt(kind, start, Span::EMPTY)
    }

    fn return_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let value = match self.can_parse_semicolon() {
            true => ExprId::NONE,
            false => self.expression_allowing_in(),
        };
        self.semicolon();
        self.add_stmt(StmtKind::Return(value), start, Span::EMPTY)
    }

    fn throw_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        if self.newline_before() {
            self.fail();
        }
        let value = self.expression_allowing_in();
        self.semicolon();
        self.add_stmt(StmtKind::Throw(value), start, Span::EMPTY)
    }

    fn switch_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let expr = self.parenthesized_condition();
        self.expect(T::OpenBrace);
        let base = self.s.cases.len();
        let mut defaults = 0;
        while self.is_in_list(T::CloseBrace) {
            let pos = self.pos();
            let test = match self.token() {
                T::Case => {
                    self.next();
                    self.expression_allowing_in()
                }
                T::Default => {
                    defaults += 1;
                    self.next();
                    ExprId::NONE
                }
                _ => {
                    self.fail();
                    break;
                }
            };
            self.expect(T::Colon);
            // `checkSwitchStatement` reports the second one, up to its `:`.
            if defaults == 2 && test.is_none() {
                defaults += 1;
                self.flag(DiagnosticKind::Grammar, 1113, (pos, self.prev_end()), &[]);
            }
            let ids = self.s.ids.len();
            while !matches!(self.token(), T::Case | T::Default | T::CloseBrace | T::Eof) {
                let statement = self.statement();
                self.s.ids.push(statement.0);
            }
            let body = self.take_ids(ids);
            self.s.cases.push(Case {
                test,
                body,
                pos,
                end: self.prev_end(),
            });
        }
        self.expect(T::CloseBrace);
        let cases = take_span!(self, cases, base);
        self.add_stmt(StmtKind::Switch { expr, cases }, start, Span::EMPTY)
    }

    fn try_statement(&mut self) -> StmtId {
        let start = self.start();
        self.next();
        let block = self.block();
        let (mut param, mut handler, mut finalizer) =
            (VarDeclId::NONE, StmtId::NONE, StmtId::NONE);
        if self.eat(T::Catch) {
            if self.eat(T::OpenParen) {
                // `parseVariableDeclaration`
                let full = self.full_start();
                let pat = self.identifier_or_pattern();
                let ty = self.type_annotation();
                if self.token() == T::Equals {
                    self.refuse(Refusal::Reported);
                }
                param = self.f.add_var_decl(VarDecl {
                    pat,
                    ty,
                    init: ExprId::NONE,
                    kind: VarKind::Let,
                    flags: Flags::empty(),
                    loc: TextRange {
                        pos: full,
                        end: self.prev_end(),
                    },
                });
                self.expect(T::CloseParen);
            }
            handler = self.block();
        }
        if self.token() == T::Finally {
            // The block starts at the keyword.
            let keyword = self.start();
            self.next();
            finalizer = self.block();
            if let Some(block) = self.f.stmts.get_mut(finalizer.idx()) {
                block.start = keyword.pos;
            }
        } else if handler.is_none() {
            self.fail();
        }
        let kind = StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        };
        self.add_stmt(kind, start, Span::EMPTY)
    }

    /// `parseExpressionOrLabeledStatement`
    fn expression_or_labeled_statement(&mut self) -> StmtId {
        let start = self.start();
        // TypeScript 5 has `allowInAnd(parseExpression)` here, the native parser has not.
        let expression = match self.options.dialect.typescript_5 || self.is_ecmascript {
            true => self.expression_allowing_in(),
            false => self.expression(),
        };
        if self.token() == T::Colon
            && expression.idx() + 1 == self.f.exprs.len()
            && let Some(&Expr {
                kind: ExprKind::Ident(label),
                pos,
                ..
            }) = self.f.exprs.last()
            && pos == start.pos
        {
            self.f.exprs.pop();
            self.next();
            let body = self.embedded_statement();
            return self.add_stmt(StmtKind::Labeled { label, body }, start, Span::EMPTY);
        }
        self.semicolon();
        self.add_stmt(StmtKind::Expr(expression), start, Span::EMPTY)
    }
}
