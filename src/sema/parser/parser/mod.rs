//! The state of the parser, and what every part of the grammar uses: tokens, lookahead,
//! speculation, names and lists.

mod class;
mod expr;
mod flow;
mod func;
mod js_syntax;
pub(crate) mod jsdoc;
mod json;
mod jsx;
mod module;
mod pattern;
mod recover;
mod reparse;
mod stmt;
mod ty;

use crate::lexer::{Lexer, Mark};
use crate::token::T;
use crate::{Goal, Options, Parsed, Refusal, Refused, Scratch};
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::*;
use bun_sema::util::SharedSort;
pub(crate) use recover::ListKind;
pub use recover::keyword_suggestion;

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
    /// The node is in a type, in an interface or in a type alias.
    pub(crate) const TYPE: u32 = 1 << 7;
    /// In Flow: `A => B` is no type. The `=>` is that of the arrow function whose return type is `A`.
    pub(crate) const NO_ANONYMOUS_FUNCTION_TYPE: u32 = 1 << 8;
    /// In Flow: `A { }` is no record expression. The `{` is that of the class that extends `A`.
    pub(crate) const NO_RECORD: u32 = 1 << 9;
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
    /// See `note_stray_decorators`: the start and the expression of each that no list of statements
    /// has taken yet.
    stray_decorators: (u32, ExprId),
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
    deferred_import_calls, import_call_type_args, keyword_identifier_positions, comments,
    mentioned, fn_nodes, class_nodes, diagnostics, after_skipped, stray_decorators,
    specifier_expressions, exports_from_expressions,
}

/// The range and the code of an error that the checker reports about the syntax.
pub(crate) type GrammarError = ((u32, u32), u32);

/// Where a speculative parse returns to.
pub(crate) struct Checkpoint {
    mark: Mark,
    file: FileLens,
    stacks: StackLens,
    context: u32,
    lists: u32,
    classes_around: u32,
    has_top_level_await: bool,
    unclaimed_nullable_types: u32,
    jsdoc: jsdoc::Lens,
}

/// `GENERAL`: it can recover from errors and read JSDoc comments, if the options say so. Without it
/// it does neither, and a text without errors pays nothing for the two.
pub(crate) struct Parser<'a, const GENERAL: bool> {
    pub(crate) lx: Lexer<'a>,
    pub(crate) f: FileBuilder,
    pub(crate) s: Stacks,
    /// `ctx`
    pub(crate) context: u32,
    /// How many classes enclose the node.
    pub(crate) classes_around: u32,
    pub(crate) options: Options,
    /// See `recovers()`.
    recovers: bool,
    /// See `reads_jsdoc()`.
    reads_jsdoc: bool,
    pub(crate) jsdoc: jsdoc::State,
    /// `parsingContexts`: a bit for each `ListKind` of which a list is open.
    pub(crate) lists: u32,
    pub(crate) declaration_scan: stmt::DeclarationScan,
    /// The start of the token at which the last error was reported, and how many have been there.
    pub(crate) errors_at: (u32, u32),
    /// `Dialect::ecmascript`, in a JavaScript file.
    pub(crate) is_ecmascript: bool,
    /// `Dialect::flow`, in a JavaScript file.
    pub(crate) is_flow: bool,
    /// A `<` after an expression can start type arguments: not in JavaScript, but in Flow.
    pub(crate) has_type_arguments_in_expressions: bool,
    /// In Flow: where the last expression statement starts.
    pub(crate) flow_statement_start: u32,
    pub(crate) has_top_level_await: bool,
    /// `Parsed::end`
    pub(crate) end: u32,
    /// `statementHasAwaitIdentifier`, as far as recovery asks: see `is_in_some_parsing_context`.
    pub(crate) has_await_in_statement: bool,
    /// A computed name in the top-level statement that is being parsed has an `await`, which was read outside the await
    /// context.
    pub(crate) has_await_in_name: bool,
    /// `reparseTopLevelAwait` parses the statement again, its names too.
    pub(crate) names_are_in_await_context: bool,
    /// It was an `await` that recovery met where no name can be.
    pub(crate) was_await_refused: bool,
    /// That parse has gone past the end of its statement. See `skip_to_element`.
    pub(crate) reparses_rest_of_file: bool,
    /// Where the statement before started, from then on.
    pub(crate) reparsed_at: u32,
    /// Where the `<` of a JSX child is for which the parser has another token: see `rescan_jsx_child`.
    pub(crate) jsx_child_after_other_token: u32,
    /// The `?` of the last parameter that has one.
    pub(crate) question_of_parameter: u32,
    /// See `private_name_before_in`: where the last one is.
    pub(crate) private_name_before_in: u32,
    /// `notParenthesizedArrow`: the positions at which a speculative parse has found that no arrow
    /// function starts, in order.
    pub(crate) not_arrows: Vec<u32>,
    /// See `is_at_parameters_of_function_type`: a position, the context and the answer, in order.
    pub(crate) function_type_starts: Vec<(u32, u32, bool)>,
    /// See `try_type_arguments_in_expression`: the position of a `<` and the context, in order.
    pub(crate) not_type_arguments: Vec<(u32, u32)>,
    /// How many `T?` have been parsed that are not known to be an element of a tuple. Any other is
    /// an error.
    pub(crate) unclaimed_nullable_types: u32,
    /// The `T` of the last one, and its end.
    pub(crate) last_nullable_type: (TypeNodeId, u32),
    /// How many speculative parses are going on.
    speculations: u32,
    /// `report` was called in one of them.
    has_reported: bool,
    /// The token at which `fail` was called last, and its position.
    failed_at: (T, u32),
    /// The last `try_parse` was abandoned because of that call.
    pub(crate) was_abandoned_at: Option<(T, u32)>,
}

/// `isAnExternalModuleIndicatorNode`
fn is_an_external_module_indicator(f: &FileBuilder, id: StmtId) -> bool {
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

/// What a parser starts with.
struct Seed<'a> {
    lx: Lexer<'a>,
    file: FileBuilder,
    stacks: Stacks,
    options: Options,
    jsdoc: jsdoc::State,
}

/// What is left of a parser.
struct Harvest<'a> {
    lx: Lexer<'a>,
    file: FileBuilder,
    stacks: Stacks,
    has_top_level_await: bool,
    end: u32,
}

pub(crate) fn run<'a>(
    text: &'a [u8],
    options: Options,
    atoms: Option<&'a dyn Intern>,
    scratch: &'a mut Scratch,
) -> Result<Parsed, Refused> {
    if text.len() >= 1 << 30 {
        return Err(Refused::new(Refusal::TooLarge));
    }
    match atoms {
        Some(atoms) => scratch.names.belong_to(atoms),
        None if options.goal == Goal::File => scratch.names.begin_own(text.len()),
        // What follows the part is not paid for.
        None => scratch.names.begin_own(text.len().min(1 << 12)),
    }
    let jsdoc = jsdoc::State::new(&options, atoms.is_some(), scratch.jsdoc_wanted);
    let atoms = atoms.unwrap_or(&crate::names::NoInterner);
    let mut file = recycled_file(std::mem::take(&mut scratch.recycled));
    let mut stacks = std::mem::take(&mut scratch.stacks);
    stacks.clear();
    let mut lx = Lexer::new(text, atoms, &mut scratch.names);
    lx.is_jsx = options.is_jsx;
    lx.recovers = options.recovers;
    lx.comments = std::mem::take(&mut file.comments);
    let is_ecmascript = options.dialect.ecmascript && options.is_javascript && !options.is_json;
    lx.is_ecmascript = is_ecmascript;
    lx.is_typescript_5 = options.dialect.typescript_5;
    lx.is_babel = options.dialect.babel;
    lx.is_script = is_ecmascript && options.dialect.script;
    let is_general = options.recovers || jsdoc.wanted != 0;
    let seed = Seed {
        lx,
        file,
        stacks,
        options,
        jsdoc,
    };
    let Harvest {
        lx,
        file: mut f,
        stacks,
        has_top_level_await,
        end,
    } = match is_general {
        true => Parser::<true>::new(seed).parse(),
        false => Parser::<false>::new(seed).parse(),
    };
    let (refusal, refused_at) = (lx.refusal, lx.refused_at);
    let (comment_directives, leading_comments) = (lx.comment_directives, lx.leading_comments);
    f.comments = lx.comments;
    scratch.stacks = stacks;
    if let Some(why) = refusal {
        scratch.recycled = f;
        return Err(Refused {
            why,
            at: refused_at.0,
            by: refused_at.1,
            after: lx.refused_after,
        });
    }
    f.comment_directives = comment_directives;
    let names = &mut scratch.names;
    let source = text;
    let mut intern = |it: &[u8]| names.atom(crate::names::Text::elsewhere(source, it), atoms);
    let errors = f.diagnostics.len();
    if !crate::pragmas::process_pragmas_into_fields(
        text,
        &leading_comments,
        options.recovers,
        &mut intern,
        &mut f,
    ) {
        scratch.recycled = f;
        return Err(Refused::new(Refusal::Reported));
    }
    if f.diagnostics.len() > errors {
        if options.dialect == Default::default() {
            f.diagnostics.shared_sort_by_key(|it| (it.start, it.code));
        }
        f.has_parse_diagnostics = true;
    }
    f.mentioned.extend_from_slice(scratch.names.mentioned());
    Ok(Parsed {
        file: f,
        has_top_level_await,
        end,
    })
}

impl<'a, const GENERAL: bool> Parser<'a, GENERAL> {
    #[inline(always)]
    fn new(seed: Seed<'a>) -> Self {
        let Seed {
            lx,
            file,
            stacks,
            options,
            jsdoc,
        } = seed;
        let is_script = options.is_javascript && !options.is_json;
        let is_ecmascript = options.dialect.ecmascript && is_script;
        let is_flow = options.dialect.flow && is_script;
        let mut context = ctx::TOP_LEVEL;
        if options.is_declaration_file {
            context |= ctx::AMBIENT;
        } else if !options.await_is_a_name {
            context |= ctx::AWAIT;
        }
        Parser {
            lx,
            f: file,
            s: stacks,
            context,
            classes_around: 0,
            options,
            recovers: options.recovers,
            reads_jsdoc: jsdoc.wanted != 0,
            jsdoc,
            lists: 0,
            // No token is in it.
            declaration_scan: stmt::DeclarationScan {
                from: 1,
                to: 0,
                context: 0,
                answer: false,
            },
            errors_at: (u32::MAX, 0),
            is_ecmascript,
            is_flow,
            has_type_arguments_in_expressions: is_flow || !options.is_javascript,
            flow_statement_start: u32::MAX,
            has_top_level_await: false,
            end: 0,
            has_await_in_statement: false,
            has_await_in_name: false,
            names_are_in_await_context: false,
            was_await_refused: false,
            reparses_rest_of_file: false,
            reparsed_at: u32::MAX,
            jsx_child_after_other_token: u32::MAX,
            question_of_parameter: 0,
            private_name_before_in: u32::MAX,
            not_arrows: Vec::new(),
            function_type_starts: Vec::new(),
            not_type_arguments: Vec::new(),
            unclaimed_nullable_types: 0,
            last_nullable_type: (TypeNodeId::NONE, 0),
            speculations: 0,
            has_reported: false,
            failed_at: (T::Eof, 0),
            was_abandoned_at: None,
        }
    }

    fn parse(mut self) -> Harvest<'a> {
        self.source_file();
        self.report_what_the_scanner_flagged();
        Harvest {
            lx: self.lx,
            file: self.f,
            stacks: self.s,
            has_top_level_await: self.has_top_level_await,
            end: self.end,
        }
    }

    /// `Options::recovers`
    #[inline(always)]
    pub(crate) fn recovers(&self) -> bool {
        GENERAL && self.recovers
    }

    /// `Options::reads_jsdoc`, in a file of which comments are read.
    #[inline(always)]
    pub(crate) fn reads_jsdoc(&self) -> bool {
        GENERAL && self.reads_jsdoc
    }

    /// `parseSourceFileWorker`
    fn source_file(&mut self) {
        self.f.source_len = self.lx.src.len() as u32;
        self.end = self.f.source_len;
        self.f.kind = if self.options.is_json {
            FileKind::Json
        } else if self.options.is_declaration_file {
            FileKind::Declaration
        } else if self.options.is_jsx {
            FileKind::Tsx
        } else {
            FileKind::Ts
        };
        self.f.is_js = self.options.is_javascript && !self.options.is_json;
        self.f.is_flow = self.is_flow;
        self.next();
        let base = self.s.ids.len();
        self.lists = 1 << ListKind::SourceElements as u32;
        if self.options.is_json {
            let value = self.json_text();
            self.f.has_module_syntax = true;
            self.s.ids.push(value.0);
        }
        if self.options.goal != Goal::File {
            let part = self.part(self.options.goal);
            self.s.ids.push(part.0);
        }
        let reparsed = self.jsdoc.reparsed.len();
        while self.token() != T::Eof && self.is_at_element(ListKind::SourceElements) {
            let statement = match self.recovers() {
                true => self.top_level_statement(),
                false => self.statement(),
            };
            self.take_stray_decorators(0);
            if is_an_external_module_indicator(&self.f, statement) {
                self.f.has_module_syntax = true;
            }
            if self.reads_jsdoc() {
                self.statement_jsdoc(statement);
                self.list_reparsed(reparsed);
            }
            self.s.ids.push(statement.0);
        }
        if self.reads_jsdoc() {
            self.end_of_file_jsdoc(reparsed);
        }
        self.f.body = self.take_ids(base);
        self.take_errors_of_scanner();
        if self.reads_jsdoc() {
            self.finish_jsdoc();
        }
        if self.f.diagnostics.iter().any(|it| it.code == 1141) {
            self.forget_specifiers_of_misplaced_declarations();
        }
        if self.unclaimed_nullable_types > 0 {
            self.refuse(Refusal::Reported);
        }
        if self.is_ecmascript && !self.is_flow && !self.has_failed() {
            bun_sema::ecmascript::report_syntax_of_typescript(&mut self.f, self.lx.src);
        }
        // typescript-estree, acorn and Babel throw the error that is reported first, which is not the first in the
        // text: the scanner reports what is wrong in a token before the parser says that it expected another.
        if self.f.diagnostics.len() > 1 && self.options.dialect == Default::default() {
            self.f
                .diagnostics
                .shared_sort_by_key(|it| (it.start, it.code));
        }
        let is_of_parser = |it: &Diagnostic| it.kind == DiagnosticKind::Parse;
        self.f.has_parse_diagnostics =
            self.recovers() && self.f.diagnostics.iter().any(is_of_parser);
        if !self.f.body_starts.is_sorted_by_key(|body| body.0.0) {
            self.f
                .body_starts
                .shared_sort_unstable_by_key(|body| body.0.0);
        }
        if !self.f.parens.is_sorted_by_key(|it| it.0.0) {
            self.f.parens.shared_sort_by_key(|it| it.0.0);
        }
        if !self.f.jsx_expressions.is_sorted_by_key(|it| it.0.0) {
            self.f
                .jsx_expressions
                .shared_sort_unstable_by_key(|it| it.0.0);
        }
        if !self.f.modifiers_of_props.is_sorted_by_key(|it| it.0.0) {
            self.f
                .modifiers_of_props
                .shared_sort_unstable_by_key(|it| it.0.0);
        }
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

    /// `nextTokenWithoutCheck`: goes on from a word that is taken as a name.
    #[inline(always)]
    pub(crate) fn next_after_name(&mut self) {
        self.take_as_name();
        self.lx.next();
    }

    /// The token, a word, is taken as a name.
    #[inline(always)]
    pub(crate) fn take_as_name(&mut self) {
        if GENERAL && self.lx.has_escape {
            self.forget_escaped_keyword();
        }
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
        // Where going on is not written yet. A speculative parse would go on too.
        if self.recovers() {
            return self.refuse(Refusal::Unsupported);
        }
        if !self.has_failed() {
            self.failed_at = (self.lx.token, self.lx.start);
        }
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

    /// The bit of the context in which `in` is no operator, if brackets, braces, and the parameters
    /// and the bodies of functions leave that context. TypeScript's parser stays in it.
    #[inline(always)]
    pub(crate) fn disallow_in_if_brackets_end_it(&self) -> u32 {
        match self.is_ecmascript {
            true => ctx::DISALLOW_IN,
            false => 0,
        }
    }

    /// `Lexer::flagged` as diagnostics.
    fn report_what_the_scanner_flagged(&mut self) {
        for (code, start, end) in std::mem::take(&mut self.lx.flagged) {
            let written = self
                .lx
                .src
                .get(start as usize..end as usize)
                .unwrap_or_default();
            let digits =
                |from: usize| core::str::from_utf8(written.get(from..).unwrap_or_default());
            let octal = |from: usize| {
                digits(from)
                    .ok()
                    .and_then(|it| u64::from_str_radix(it, 8).ok())
            };
            let argument = match code {
                // `\1`
                1487 => format!("\\x{:02x}", octal(1).unwrap_or(0)).into_bytes(),
                // `\8`
                1488 => written.to_vec(),
                // `010`, `-010`
                1121 => match written.first() {
                    Some(b'-') => format!("-0o{:o}", octal(1).unwrap_or(0)).into_bytes(),
                    _ => format!("0o{:o}", octal(0).unwrap_or(0)).into_bytes(),
                },
                _ => Vec::new(),
            };
            match argument.is_empty() {
                true => self.flag(DiagnosticKind::Grammar, code, (start, end), &[]),
                false => self.flag(DiagnosticKind::Grammar, code, (start, end), &[&argument]),
            }
        }
    }

    /// TypeScript reports an error that is not about the syntax: the tree is the same without it.
    #[cold]
    #[inline(never)]
    pub(crate) fn flag(&mut self, kind: DiagnosticKind, code: u32, at: (u32, u32), args: &[&[u8]]) {
        self.f
            .diagnostics
            .push(Diagnostic::new(kind, at, code, args));
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
    pub(crate) fn expect(&mut self, token: T) -> bool {
        if self.lx.token == token {
            self.lx.next();
            return true;
        }
        self.expected(token);
        false
    }

    /// `parseExpectedMatchingBrackets`. `open_at`: where `open` is, if it is there.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn expect_matching(&mut self, (open, close): (T, T), open_at: Option<u32>) {
        if self.lx.token == close {
            self.lx.next();
        } else {
            self.unmatched((open, close), open_at);
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
            self.expected(T::Semicolon);
        }
    }

    /// Whether a list that `close` ends goes on.
    #[inline(always)]
    pub(crate) fn is_in_list(&self, close: T) -> bool {
        self.lx.token != close && self.lx.token != T::Eof
    }

    /// Every recursive path of the parser passes through a function that asks this before it calls
    /// anything on that path: `test/internal/source-lints/sema-parser-recursion.test.ts` looks for
    /// one that does not.
    #[inline(always)]
    pub(crate) fn is_too_deep(&mut self) -> bool {
        if self.lx.stack_check.is_safe_to_recurse() {
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

    pub(crate) fn checkpoint(&mut self) -> Checkpoint {
        // What is taken after this would be forgotten by `rollback`, and it is not scanned again.
        self.take_errors_of_scanner();
        // First: a call after the others would have all of them wait on the stack.
        let jsdoc = self.jsdoc_lens();
        Checkpoint {
            mark: self.lx.mark(),
            file: file_lens(&self.f),
            stacks: self.s.lens(),
            context: self.context,
            lists: self.lists,
            classes_around: self.classes_around,
            has_top_level_await: self.has_top_level_await,
            unclaimed_nullable_types: self.unclaimed_nullable_types,
            jsdoc,
        }
    }

    pub(crate) fn rollback(&mut self, to: &Checkpoint) {
        self.lx.reset(to.mark);
        truncate_file(&mut self.f, &to.file);
        self.s.truncate(&to.stacks);
        self.context = to.context;
        self.lists = to.lists;
        self.classes_around = to.classes_around;
        self.has_top_level_await = to.has_top_level_await;
        self.unclaimed_nullable_types = to.unclaimed_nullable_types;
        if self.reads_jsdoc() {
            self.rollback_jsdoc(to);
        }
    }

    /// Forgets the nodes that were built since `since`, for which the tree has no place. The tokens
    /// stay consumed, and what was said about the text stays said.
    #[cold]
    #[inline(never)]
    pub(crate) fn forget_nodes(&mut self, since: &Checkpoint) {
        let now = file_lens(&self.f);
        let lens = FileLens {
            specifier_uses: now.specifier_uses,
            keyword_identifier_positions: now.keyword_identifier_positions,
            diagnostics: now.diagnostics,
            after_skipped: now.after_skipped,
            ..since.file
        };
        truncate_file(&mut self.f, &lens);
        let strays = since.stacks.stray_decorators as usize;
        self.s.stray_decorators.truncate(strays);
        if self.reads_jsdoc() {
            self.rollback_jsdoc(since);
        }
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
            None => self.was_abandoned_at = None,
            Some(Refusal::Syntax) => {
                self.lx.refusal = None;
                self.was_abandoned_at = Some(self.failed_at);
            }
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
            return self.missing_identifier(0, 0);
        }
        let (atom, pos) = (self.lx.atom, self.lx.start);
        self.note_identifier(atom, pos);
        self.next_after_name();
        (atom, pos)
    }

    /// `parseIdentifierName`: any word. A private name is one for `tokenIsIdentifierOrKeyword`.
    #[inline]
    pub(crate) fn identifier_name(&mut self) -> (Atom, u32) {
        if !self.lx.token.is_identifier_or_keyword() {
            return self.missing_identifier(0, 0);
        }
        if self.lx.token == T::PrivateIdentifier && !self.recovers() {
            self.fail();
            return (Atom::NONE, self.pos());
        }
        let (atom, pos) = (self.lx.atom, self.lx.start);
        self.next_after_name();
        (atom, pos)
    }

    pub(crate) fn atom(&mut self, text: &[u8]) -> Atom {
        let text = crate::names::Text::elsewhere(self.lx.src, text);
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

    /// The decorators among the modifiers from `base` on are those of a `MissingDeclaration` or of
    /// a `this` parameter, which `checkDecorators` does not visit: see `File::stray_decorators`.
    /// Pops the modifiers. `end`: where what follows the decorators starts.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn note_stray_decorators(&mut self, base: usize, end: u32) {
        if !self.recovers() {
            return self.fail();
        }
        // Only the list of the file takes them.
        if self.lists & 1 << ListKind::BlockStatements as u32 != 0 {
            return self.refuse(Refusal::Unsupported);
        }
        for index in base..self.s.modifiers.len() {
            if let Some(&Modifier {
                kind: ModifierKind::Decorator(decorator),
                ..
            }) = self.s.modifiers.get(index)
            {
                let start = self.first_operand_pos(decorator);
                self.f.stray_decorators.push((start, end));
                self.s.stray_decorators.push((start, decorator));
            }
        }
        self.s.modifiers.truncate(base);
    }

    /// After a statement of a list, before it is pushed on the stack of ids: pushes the decorators
    /// that `note_stray_decorators` has saved in it, which are statements before it. `base`: how
    /// many were saved when the list began.
    #[inline(always)]
    pub(crate) fn take_stray_decorators(&mut self, base: usize) {
        if GENERAL && self.s.stray_decorators.len() > base {
            self.take_stray_decorators_slowly(base);
        }
    }

    #[cold]
    #[inline(never)]
    fn take_stray_decorators_slowly(&mut self, base: usize) {
        for index in base..self.s.stray_decorators.len() {
            let Some(&(start, decorator)) = self.s.stray_decorators.get(index) else {
                break;
            };
            self.s.ids.push(self.f.stmts.len() as u32);
            self.f.stmts.push(Stmt {
                kind: StmtKind::Expr(decorator),
                start,
                loc: TextRange::default(),
                modifiers: Span::EMPTY,
            });
        }
        self.s.stray_decorators.truncate(base);
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
