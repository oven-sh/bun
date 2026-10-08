//! The state of the parser, and what every part of the grammar uses: tokens, lookahead,
//! speculation, names and lists.

mod class;
mod expr;
mod func;
mod jsx;
mod module;
mod pattern;
mod stmt;
mod ty;

use crate::lexer::{Lexer, Mark};
use crate::token::T;
use crate::{Options, Parsed, Refusal, Refused, Scratch};
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::*;

/// `ParserContext`, as bits.
pub(crate) mod ctx {
    /// `NodeFlagsYieldContext`
    pub(crate) const YIELD: u32 = 1 << 0;
    /// `NodeFlagsAwaitContext`
    pub(crate) const AWAIT: u32 = 1 << 1;
    /// `NodeFlagsDisallowInContext`
    pub(crate) const DISALLOW_IN: u32 = 1 << 2;
    /// `NodeFlagsDecoratorContext`
    pub(crate) const DECORATOR: u32 = 1 << 3;
    /// `NodeFlagsDisallowConditionalTypesContext`
    pub(crate) const DISALLOW_CONDITIONAL_TYPES: u32 = 1 << 4;
    /// `NodeFlagsAmbient`
    pub(crate) const AMBIENT: u32 = 1 << 5;
    /// No function encloses the node.
    pub(crate) const TOP_LEVEL: u32 = 1 << 6;
}

macro_rules! stacks {
    ($($(#[$doc:meta])* $field:ident: $ty:ty,)*) => {
        /// The lists that are being parsed, innermost last: nodes that have to be contiguous are
        /// collected here and appended to the file together.
        #[derive(Default)]
        pub(crate) struct Stacks {
            $($(#[$doc])* pub(crate) $field: Vec<$ty>,)*
        }

        /// The lengths of the stacks.
        #[derive(Copy, Clone)]
        struct StackLens {
            $($field: u32,)*
        }

        impl Stacks {
            fn lens(&self) -> StackLens {
                StackLens { $($field: self.$field.len() as u32,)* }
            }
            fn truncate(&mut self, lens: &StackLens) {
                $(self.$field.truncate(lens.$field as usize);)*
            }
            fn clear(&mut self) {
                $(self.$field.clear();)*
            }
        }
    };
}

stacks! {
    ids: u32,
    var_decls: VarDecl,
    params: Param,
    type_params: TypeParam,
    props: Prop,
    members: Member,
    cases: Case,
    pat_props: PatProp,
    pat_elems: PatElem,
    enum_members: EnumMember,
    import_specs: ImportSpec,
    export_specs: ExportSpec,
    tuple_elems: TupleElem,
    modifiers: Modifier,
    names: (Atom, u32),
    /// By index in `params`, the modifiers of a parameter that has any.
    param_modifiers: (u32, Span<ModifierId>),
    /// By index in `props`, likewise.
    prop_modifiers: (u32, Span<ModifierId>),
    /// By index in `params` or in `members`, a decorator.
    decorators: (u32, ExprId),
}

macro_rules! file_lists {
    ($($field:ident,)*) => {
        /// The lengths of the lists of the file.
        #[derive(Copy, Clone)]
        struct FileLens {
            $($field: u32,)*
        }

        fn file_lens(file: &FileBuilder) -> FileLens {
            FileLens { $($field: file.$field.len() as u32,)* }
        }

        fn truncate_file(file: &mut FileBuilder, lens: &FileLens) {
            $(file.$field.truncate(lens.$field as usize);)*
        }

        /// An empty file with the capacity of the lists of `old`.
        fn recycled_file(mut old: FileBuilder) -> FileBuilder {
            let mut file = FileBuilder::default();
            $(
                old.$field.clear();
                file.$field = old.$field;
            )*
            file
        }
    };
}

file_lists! {
    ids, numbers, exprs, stmts, types, pats, pat_props, pat_elems, fns, params, type_params,
    classes, interfaces, aliases, enums, enum_members, modules, members, props, var_decls, calls,
    cases, jsx, imports, import_specs, import_equals, exports, export_specs, tuple_elems, mapped,
    modifiers, names, parens, non_null_ends, jsx_expressions, body_starts, specifier_uses,
    decorators, modifiers_of_params, modifiers_of_props, with_bodies, import_attributes,
    deferred_import_calls, import_call_type_args, keyword_identifier_positions,
}

/// Where a speculative parse returns to.
pub(crate) struct Checkpoint {
    mark: Mark,
    file: FileLens,
    stacks: StackLens,
    context: u32,
    classes_around: u32,
    has_top_level_await: bool,
    unclaimed_nullable_types: u32,
}

pub(crate) struct Parser<'a> {
    pub(crate) lx: Lexer<'a>,
    pub(crate) f: FileBuilder,
    pub(crate) s: Stacks,
    /// `ctx`
    pub(crate) context: u32,
    /// How many classes enclose the node.
    pub(crate) classes_around: u32,
    pub(crate) options: Options,
    pub(crate) has_top_level_await: bool,
    /// `notParenthesizedArrow`: the positions at which a speculative parse has found that no arrow
    /// function starts.
    pub(crate) not_arrows: Vec<u32>,
    /// How many `T?` have been parsed that are not known to be an element of a tuple. Any other is
    /// an error.
    pub(crate) unclaimed_nullable_types: u32,
    /// The `T` of the last one, and its end.
    pub(crate) last_nullable_type: (TypeNodeId, u32),
    /// How many speculative parses are going on.
    speculations: u32,
    /// `report` was called in one of them.
    has_reported: bool,
    stack_check: bun_core::StackCheck,
}

impl<'a> Parser<'a> {
    pub(crate) fn run(
        text: &'a [u8],
        options: Options,
        atoms: &'a dyn Intern,
        scratch: &'a mut Scratch,
    ) -> Result<Parsed, Refused> {
        if text.len() >= 1 << 30 {
            return Err(Refused::new(Refusal::TooLarge));
        }
        scratch.names.belong_to(atoms);
        let file = recycled_file(std::mem::take(&mut scratch.recycled));
        let mut stacks = std::mem::take(&mut scratch.stacks);
        stacks.clear();
        let mut lx = Lexer::new(text, atoms, &mut scratch.names);
        lx.is_jsx = options.is_jsx;
        let mut context = ctx::TOP_LEVEL;
        if options.is_declaration_file {
            context |= ctx::AMBIENT;
        } else if !options.await_is_a_name {
            context |= ctx::AWAIT;
        }
        let mut this = Parser {
            lx,
            f: file,
            s: stacks,
            context,
            classes_around: 0,
            options,
            has_top_level_await: false,
            not_arrows: Vec::new(),
            unclaimed_nullable_types: 0,
            last_nullable_type: (TypeNodeId::NONE, 0),
            speculations: 0,
            has_reported: false,
            stack_check: bun_core::StackCheck::init(),
        };
        this.source_file();
        let refusal = this.lx.refusal;
        let refused_at = this.lx.refused_at;
        let comment_directives = std::mem::take(&mut this.lx.comment_directives);
        let leading_comments = std::mem::take(&mut this.lx.leading_comments);
        let Parser {
            mut f,
            s,
            has_top_level_await,
            ..
        } = this;
        scratch.stacks = s;
        if let Some(why) = refusal {
            scratch.recycled = f;
            return Err(Refused {
                why,
                at: refused_at.0,
                by: refused_at.1,
            });
        }
        f.comment_directives = comment_directives;
        if !crate::pragmas::process_pragmas_into_fields(text, &leading_comments, atoms, &mut f) {
            scratch.recycled = f;
            return Err(Refused::new(Refusal::Reported));
        }
        Ok(Parsed {
            file: f,
            has_top_level_await,
        })
    }

    /// `parseSourceFileWorker`
    fn source_file(&mut self) {
        self.f.source_len = self.lx.src.len() as u32;
        self.f.kind = if self.options.is_declaration_file {
            FileKind::Declaration
        } else if self.options.is_jsx {
            FileKind::Tsx
        } else {
            FileKind::Ts
        };
        self.f.is_js = self.options.is_javascript;
        self.next();
        let base = self.s.ids.len();
        while self.token() != T::Eof {
            let statement = self.statement();
            if self.is_an_external_module_indicator(statement) {
                self.f.has_module_syntax = true;
            }
            self.s.ids.push(statement.0);
        }
        self.f.body = self.take_ids(base);
        if self.unclaimed_nullable_types > 0 {
            self.refuse(Refusal::Reported);
        }
        if !self.f.body_starts.is_sorted_by_key(|body| body.0.0) {
            self.f.body_starts.sort_unstable_by_key(|body| body.0.0);
        }
        if !self.f.parens.is_sorted_by_key(|it| it.0.0) {
            self.f.parens.sort_by_key(|it| it.0.0);
        }
        if !self.f.jsx_expressions.is_sorted_by_key(|it| it.0.0) {
            self.f.jsx_expressions.sort_unstable_by_key(|it| it.0.0);
        }
        if !self.f.modifiers_of_props.is_sorted_by_key(|it| it.0.0) {
            self.f.modifiers_of_props.sort_unstable_by_key(|it| it.0.0);
        }
    }

    /// `isAnExternalModuleIndicatorNode`
    fn is_an_external_module_indicator(&self, id: StmtId) -> bool {
        let f = &self.f;
        let Some(statement) = f.stmts.get(id.idx()) else {
            return false;
        };
        let flags = match statement.kind {
            StmtKind::Var(_) => f.modifiers_to_flags(statement.modifiers),
            StmtKind::Fn(x) => f[x].flags,
            StmtKind::Class(x) => f[x].flags,
            StmtKind::Interface(x) => f[x].flags,
            StmtKind::TypeAlias(x) => f[x].flags,
            StmtKind::Enum(x) => f[x].flags,
            StmtKind::Module(x) => f[x].flags,
            // `import a = b.c` aliases an existing entity. It does not make the file a module.
            StmtKind::ImportEquals(x) if !matches!(f[x].target, ImportEqualsTarget::Require(_)) => {
                f[x].flags
            }
            StmtKind::ImportEquals(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_) => return true,
            _ => Flags::empty(),
        };
        flags.contains(Flags::EXPORT)
    }

    // ───────────────────────────── tokens ─────────────────────────────

    #[inline(always)]
    pub(crate) fn token(&self) -> T {
        self.lx.token
    }

    #[inline(always)]
    pub(crate) fn next(&mut self) {
        self.lx.next();
    }

    /// The start of the token.
    #[inline(always)]
    pub(crate) fn pos(&self) -> u32 {
        self.lx.start
    }

    /// `nodePos()`: the end of the previous token, which is also `node.End()` of a node that ends
    /// with that token.
    #[inline(always)]
    pub(crate) fn full_start(&self) -> u32 {
        self.lx.full_start
    }

    /// The same, where it is read as the end of a node.
    #[inline(always)]
    pub(crate) fn prev_end(&self) -> u32 {
        self.lx.full_start
    }

    #[inline(always)]
    pub(crate) fn newline_before(&self) -> bool {
        self.lx.newline_before
    }

    /// A token that the grammar does not allow here.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn fail(&mut self) {
        self.lx.refuse(Refusal::Syntax);
    }

    /// Gives up on the file, in a speculative parse too.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn refuse(&mut self, why: Refusal) {
        // It replaces the reason that only ends a speculation.
        if self.lx.refusal == Some(Refusal::Syntax) {
            self.lx.refusal = None;
        }
        self.lx.refuse(why);
    }

    /// TypeScript reports an error here and goes on. So does a speculative parse, whose errors do
    /// not count if it is abandoned.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn report(&mut self) {
        match self.speculations {
            0 => self.refuse(Refusal::Reported),
            _ => self.has_reported = true,
        }
    }

    #[inline(always)]
    pub(crate) fn has_failed(&self) -> bool {
        self.lx.refusal.is_some()
    }

    /// `parseOptional`
    #[inline(always)]
    pub(crate) fn eat(&mut self, token: T) -> bool {
        if self.lx.token == token {
            self.lx.next();
            return true;
        }
        false
    }

    /// `parseExpected`
    #[inline(always)]
    #[track_caller]
    pub(crate) fn expect(&mut self, token: T) {
        if self.lx.token == token {
            self.lx.next();
        } else {
            self.fail();
        }
    }

    /// `canParseSemicolon`
    #[inline(always)]
    pub(crate) fn can_parse_semicolon(&self) -> bool {
        matches!(self.lx.token, T::Semicolon | T::CloseBrace | T::Eof) || self.lx.newline_before
    }

    /// `parseSemicolon`
    #[inline(always)]
    #[track_caller]
    pub(crate) fn semicolon(&mut self) {
        if self.lx.token == T::Semicolon {
            self.lx.next();
        } else if !(matches!(self.lx.token, T::CloseBrace | T::Eof) || self.lx.newline_before) {
            self.fail();
        }
    }

    /// Whether a list that `close` ends goes on.
    #[inline(always)]
    pub(crate) fn is_in_list(&self, close: T) -> bool {
        self.lx.token != close && self.lx.token != T::Eof
    }

    /// Every recursive path of the parser passes through a function that asks this.
    #[inline(always)]
    pub(crate) fn is_too_deep(&mut self) -> bool {
        if self.stack_check.is_safe_to_recurse() {
            return false;
        }
        self.refuse(Refusal::TooDeep);
        true
    }

    // ───────────────────────────── context ─────────────────────────────

    #[inline(always)]
    pub(crate) fn has_context(&self, flag: u32) -> bool {
        self.context & flag != 0
    }

    /// Sets the bits `set` and clears the bits `clear`. Returns the context to restore.
    #[inline(always)]
    pub(crate) fn enter_context(&mut self, set: u32, clear: u32) -> u32 {
        let saved = self.context;
        self.context = saved & !clear | set;
        saved
    }

    /// `NodeFlagsAmbient`, as a flag of a declaration.
    #[inline(always)]
    pub(crate) fn ambient(&self) -> Flags {
        if self.context & ctx::AMBIENT != 0 {
            Flags::AMBIENT
        } else {
            Flags::empty()
        }
    }

    // ───────────────────────────── lookahead ─────────────────────────────

    /// `lookAhead` for a test that only reads tokens.
    #[inline]
    pub(crate) fn look_ahead<R>(&mut self, test: impl FnOnce(&mut Self) -> R) -> R {
        let mark = self.lx.mark();
        let had_failed = self.lx.refusal;
        let result = test(self);
        // What the scanner refuses ahead it refuses again when the parser gets there.
        self.lx.refusal = had_failed;
        self.lx.reset(mark);
        result
    }

    /// The kind of the token after this one.
    #[inline]
    pub(crate) fn peek(&mut self) -> T {
        self.look_ahead(|p| {
            p.next();
            p.token()
        })
    }

    pub(crate) fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            mark: self.lx.mark(),
            file: file_lens(&self.f),
            stacks: self.s.lens(),
            context: self.context,
            classes_around: self.classes_around,
            has_top_level_await: self.has_top_level_await,
            unclaimed_nullable_types: self.unclaimed_nullable_types,
        }
    }

    pub(crate) fn rollback(&mut self, to: &Checkpoint) {
        self.lx.reset(to.mark);
        truncate_file(&mut self.f, &to.file);
        self.s.truncate(&to.stacks);
        self.context = to.context;
        self.classes_around = to.classes_around;
        self.has_top_level_await = to.has_top_level_await;
        self.unclaimed_nullable_types = to.unclaimed_nullable_types;
    }

    /// `tryParse`: what `parse` built is kept if it returns `Some` and met no syntax error.
    pub(crate) fn try_parse<R>(&mut self, parse: impl FnOnce(&mut Self) -> Option<R>) -> Option<R> {
        if self.has_failed() {
            return None;
        }
        let checkpoint = self.checkpoint();
        let had_reported = self.has_reported;
        self.speculations += 1;
        let result = parse(self);
        self.speculations -= 1;
        match self.lx.refusal {
            None if result.is_some() => {
                // What it reported counts.
                if self.has_reported && self.speculations == 0 {
                    self.has_reported = false;
                    self.refuse(Refusal::Reported);
                }
                return result;
            }
            None => {}
            Some(Refusal::Syntax) => self.lx.refusal = None,
            // The file is given up.
            Some(_) => return None,
        }
        self.has_reported = had_reported;
        self.rollback(&checkpoint);
        None
    }

    /// `lookAhead` for a test that parses: nothing of what it built is kept.
    pub(crate) fn look_ahead_parsing(&mut self, test: impl FnOnce(&mut Self) -> bool) -> bool {
        if self.has_failed() {
            return false;
        }
        let checkpoint = self.checkpoint();
        let had_reported = self.has_reported;
        self.speculations += 1;
        let result = test(self);
        self.speculations -= 1;
        self.has_reported = had_reported;
        let result = match self.lx.refusal {
            None => result,
            Some(Refusal::Syntax) => {
                self.lx.refusal = None;
                false
            }
            Some(_) => return false,
        };
        self.rollback(&checkpoint);
        result
    }

    // ───────────────────────────── names ─────────────────────────────

    /// `atom` is the text of the `Identifier` at `pos`.
    #[inline(always)]
    pub(crate) fn note_identifier(&mut self, atom: Atom, pos: u32) -> Atom {
        if atom.is_keyword_identifier() {
            self.f.keyword_identifier_positions.push(pos);
        }
        atom
    }

    /// `isIdentifier`
    #[inline(always)]
    pub(crate) fn is_identifier(&self) -> bool {
        let token = self.lx.token;
        if token == T::Identifier {
            return true;
        }
        if token <= T::With {
            return false;
        }
        // "If we have a 'yield' keyword, and we're in the [yield] context, then 'yield' is
        // considered a keyword and is not an identifier."
        !(token == T::Yield && self.context & ctx::YIELD != 0
            || token == T::Await && self.context & ctx::AWAIT != 0)
    }

    /// `isBindingIdentifier`
    #[inline(always)]
    pub(crate) fn is_binding_identifier(&self) -> bool {
        self.lx.token == T::Identifier || self.lx.token > T::With
    }

    /// `parseIdentifier`: the name and its position.
    #[inline]
    pub(crate) fn identifier(&mut self) -> (Atom, u32) {
        if !self.is_identifier() {
            self.fail();
            return (Atom::NONE, self.pos());
        }
        let (atom, pos) = (self.lx.atom, self.lx.start);
        self.note_identifier(atom, pos);
        self.next();
        (atom, pos)
    }

    /// `parseIdentifierName`: any word.
    #[inline]
    pub(crate) fn identifier_name(&mut self) -> (Atom, u32) {
        if !self.lx.token.is_identifier_or_keyword() || self.lx.token == T::PrivateIdentifier {
            self.fail();
            return (Atom::NONE, self.pos());
        }
        let (atom, pos) = (self.lx.atom, self.lx.start);
        self.next();
        (atom, pos)
    }

    pub(crate) fn atom(&mut self, text: &[u8]) -> Atom {
        self.lx.names.atom(text, self.lx.atoms)
    }

    /// `String(n)` as a name.
    pub(crate) fn number_name(&mut self, n: f64) -> Atom {
        let text = bun_sema::atom::number_to_string(n);
        self.atom(&text)
    }

    // ───────────────────────────── lists ─────────────────────────────

    /// Builds a list from the entries of the stack of ids from `base` on, and pops them.
    #[inline]
    pub(crate) fn take_ids<I>(&mut self, base: usize) -> IdList<I> {
        let start = self.f.ids.len() as u32;
        let items = self.s.ids.get(base..).unwrap_or_default();
        let len = items.len() as u32;
        self.f.ids.extend_from_slice(items);
        self.s.ids.truncate(base);
        IdList::new(start, len)
    }
}

/// Appends the entries of a stack from `base` on to the list of the file with the same name, and
/// pops them. The value is their `Span`.
macro_rules! take_span {
    ($p:expr, $field:ident, $base:expr) => {{
        let base: usize = $base;
        let start = $p.f.$field.len() as u32;
        let items = $p.s.$field.get(base..).unwrap_or_default();
        let len = items.len() as u32;
        $p.f.$field.extend_from_slice(items);
        $p.s.$field.truncate(base);
        bun_sema::hir::Span::new(start, len)
    }};
}
pub(crate) use take_span;
