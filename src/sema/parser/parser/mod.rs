//! Parser state, plus the helpers every part of the grammar shares: tokens, lookahead, speculation, names and lists.

mod class;
mod comments;
mod declared;
mod expr;
mod flow;
mod func;
mod js_syntax;
pub(crate) mod jsdoc;
mod json;
mod jsx;
mod module;
mod oxc;
mod pattern;
mod recover;
mod reparse;
mod stmt;
mod ty;

use crate::lexer::{Lexer, Mark};
use crate::token::T;
use crate::{Options, Parsed, Rejected, Rejection, Scratch};
use bun_sema::atom::{Atom, Intern, known};
use bun_sema::hir::*;
use bun_sema::util::SharedSort;
pub(crate) use declared::Declared;
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
    /// The node isn't inside a function.
    pub(crate) const TOP_LEVEL: u32 = 1 << 6;
    /// The node is in a type, an interface or a type alias.
    pub(crate) const TYPE: u32 = 1 << 7;
    /// In Flow: `A => B` isn't a type here. The `=>` belongs to the arrow function whose return type is `A`.
    pub(crate) const NO_ANONYMOUS_FUNCTION_TYPE: u32 = 1 << 8;
    /// In Flow: `A { }` isn't a record expression here. The `{` opens the body of the class that extends `A`.
    pub(crate) const NO_RECORD: u32 = 1 << 9;
    /// The node is in the `extends` clause of a conditional type.
    pub(crate) const CONDITIONAL_EXTENDS: u32 = 1 << 10;
    /// The node is in the signature of a class method, accessor or constructor.
    pub(crate) const CLASS_MEMBER: u32 = 1 << 11;
    /// The node is in a loop body within the enclosing function.
    pub(crate) const IN_LOOP: u32 = 1 << 12;
    /// The node is in a `switch` within the enclosing function.
    pub(crate) const IN_SWITCH: u32 = 1 << 13;
    /// The node is in a namespace body.
    pub(crate) const IN_NAMESPACE: u32 = 1 << 14;
    /// The node isn't inside a function body. It can still be in a function's parameters or return type, or in a class.
    pub(crate) const OUTSIDE_BODIES: u32 = 1 << 15;
}

macro_rules! stacks {
    ($($(#[$doc:meta])* $field:ident: $ty:ty,)*) => {
        /// The lists being parsed, innermost last. Nodes that must be contiguous are collected here and
        /// appended to the file together.
        #[derive(Default)]
        pub(crate) struct Stacks {
            $($(#[$doc])* pub(crate) $field: Vec<$ty>,)*
        }

        /// The length of each stack.
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
    /// The modifiers of each parameter that has any, keyed by its index in `params`.
    param_modifiers: (u32, Span<ModifierId>),
    /// The same for properties, keyed by index in `props`.
    prop_modifiers: (u32, Span<ModifierId>),
    /// A decorator, keyed by the index in `params` or `members` of what it decorates.
    decorators: (u32, ExprId),
    /// See `note_stray_decorators`. The start and expression of each stray decorator that no statement list has
    /// picked up yet.
    stray_decorators: (u32, ExprId),
}

macro_rules! file_lists {
    ($($field:ident,)*) => {
        /// The length of each of the file's lists.
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

        /// Returns an empty file that reuses the list allocations of `old`, which loses them.
        fn recycled_file(old: &mut FileBuilder) -> FileBuilder {
            let mut file = FileBuilder::default();
            $(
                old.$field.clear();
                file.$field = std::mem::take(&mut old.$field);
            )*
            file
        }
    };
}

file_lists! {
    ids, numbers, exprs, stmts, types, pats, pat_props, pat_elems, fns, params, type_params,
    classes, interfaces, aliases, enums, enum_members, modules, members, props, var_decls, calls,
    cases, jsx, imports, import_specs, import_equals, exports, export_specs, tuple_elems, mapped,
    modifiers, names, parens, non_null_ends, far_names, tagged_templates,
    jsx_expressions, body_starts, specifier_uses,
    decorators, modifiers_of_params, modifiers_of_stmts, modifiers_of_props, with_bodies, detached_semicolons,
    import_attributes,
    deferred_import_calls, import_call_type_args, keyword_identifier_positions, comments,
    mentioned, diagnostics, after_skipped, stray_decorators,
    specifier_expressions, exports_from_expressions,
}

/// The range and code of a syntax error that the checker reports.
pub(crate) type GrammarError = ((u32, u32), u32);

/// The state a speculative parse rolls back to.
pub(crate) struct Checkpoint {
    mark: Mark,
    file: FileLens,
    stacks: StackLens,
    context: u32,
    lists: u32,
    class_depth: u32,
    has_top_level_await: bool,
    declared: declared::Mark,
    jsdoc: jsdoc::Lens,
    comments: comments::CommentCheckpoint,
}

/// `GENERAL`: the parser can recover from errors, read JSDoc comments and read Flow when the options enable them.
/// When it's false that code is compiled out, so parsing an error-free file doesn't pay for it.
///
/// `COMMENTS`: the parser finds the nodes around each comment when the options enable it. See [`comments`]. When it's
/// false that code is compiled out, so `bun check` and `bun lint`, which don't need those nodes, don't pay for it.
pub(crate) struct Parser<'a, const GENERAL: bool, const COMMENTS: bool> {
    pub(crate) lx: Lexer<'a>,
    pub(crate) f: FileBuilder,
    pub(crate) s: Stacks,
    /// `ctx`
    pub(crate) context: u32,
    /// Number of enclosing classes.
    pub(crate) class_depth: u32,
    pub(crate) options: Options,
    /// See `recovers()`.
    recovers: bool,
    /// See `reads_jsdoc()`.
    reads_jsdoc: bool,
    pub(crate) jsdoc: jsdoc::State,
    comments: comments::CommentTracker,
    /// `parsingContexts`: one bit for each `ListKind` that has an open list.
    pub(crate) lists: u32,
    pub(crate) declaration_scan: stmt::DeclarationScan,
    /// The start of the token where the last error was reported, and how many errors were reported there.
    pub(crate) errors_at: (u32, u32),
    /// `Dialect::ecmascript`, in a JavaScript file.
    pub(crate) is_ecmascript: bool,
    /// `Dialect::flow`, in a JavaScript file.
    flow: bool,
    /// True if a `<` after an expression can start type arguments. False in JavaScript, except for Flow.
    pub(crate) has_type_arguments_in_expressions: bool,
    /// In Flow: the start of the last expression statement.
    pub(crate) flow_statement_start: u32,
    /// `TypeExcludesFlags`: the context bits cleared inside a type, an enum's members and a top-level namespace. oxc
    /// keeps the enclosing code's await and yield context there.
    pub(crate) cleared_in_types: u32,
    /// Number of `await` and `yield` expressions created so far.
    pub(crate) suspensions: u32,
    /// `Dialect::oxc`, in a TypeScript file. See `oxc.rs`.
    is_typescript_for_oxc: bool,
    /// True while parsing a class's `implements` clause for oxc, which accepts any word as a name there.
    pub(crate) is_in_implements_for_oxc: bool,
    /// True while parsing an interface's `extends` clause for oxc, which parses expressions there.
    pub(crate) is_in_interface_extends_for_oxc: bool,
    /// With `reports_like_oxc`: the class being parsed has an abstract member or a method without a body.
    pub(crate) has_odd_members: bool,
    /// For `rare::NESTED_MODULE_SYNTAX`, in a JavaScript file for oxc: how many `import` and `export` statements were
    /// parsed at any depth, and how many of the file's top-level statements are one.
    pub(crate) module_statements: (u32, u32),
    /// Number of parameters so far with a modifier, a `?` or `...`. It only grows.
    pub(crate) odd_parameters: u32,
    /// The private names the enclosing classes have declared so far.
    pub(crate) declared_private_names: Vec<Atom>,
    pub(crate) declared: Declared,
    /// See [`Parsed::end`].
    pub(crate) end: (u32, u32),
    pub(crate) has_top_level_await: bool,
    /// True if some top-level `await` is unambiguous: `await a`, `for await`, `await using`. `await (a)` doesn't count,
    /// because in a script it calls a function named `await`.
    pub(crate) has_plain_top_level_await: bool,
    /// `statementHasAwaitIdentifier`, as error recovery uses it. See `is_in_some_parsing_context`.
    pub(crate) has_await_in_statement: bool,
    /// True if the current top-level statement has an `await` that was parsed outside the await context, either in a
    /// computed name or as the first parameter of an arrow function.
    pub(crate) has_await_in_name: bool,
    /// `statementHasAwaitIdentifier`: a top-level `await` is a name unless the context makes it a keyword.
    pub(crate) has_await_identifier: bool,
    /// True if property names are parsed in the await context too, as when `reparseTopLevelAwait` reparses a statement.
    pub(crate) names_are_in_await_context: bool,
    /// True if error recovery hit an `await` in this statement where a name isn't allowed.
    pub(crate) recovery_hit_await: bool,
    /// True once the `reparseTopLevelAwait` reparse has run past the end of its statement. See `skip_to_element`.
    pub(crate) reparses_rest_of_file: bool,
    /// While `reparses_rest_of_file` is set, the start of the previous statement.
    pub(crate) reparsed_at: u32,
    /// The position of a JSX child's `<` for which the native parser still has the token from before the rescan. See
    /// `rescan_jsx_child`.
    pub(crate) jsx_child_with_stale_token: u32,
    /// The position of the `?` of the last optional parameter.
    pub(crate) parameter_question_pos: u32,
    /// See `private_name_before_in`. The position of the last one.
    pub(crate) private_name_before_in: u32,
    /// `notParenthesizedArrow`: the sorted positions where a speculative parse found that no arrow function starts.
    pub(crate) not_arrows: Vec<u32>,
    /// See `is_at_parameters_of_function_type`. Each entry is a position, the context and the answer, sorted by
    /// position.
    pub(crate) function_type_starts: Vec<(u32, u32, bool)>,
    /// See `try_type_arguments_in_expression`. Each entry is the position of a `<` and the context. Sorted.
    pub(crate) not_type_arguments: Vec<(u32, u32)>,
    /// The last `T?` node and its end.
    pub(crate) last_nullable_type: (TypeNodeId, u32),
    /// Number of speculative parses in progress.
    speculations: u32,
    /// True if `report` was called during one of them.
    has_reported: bool,
    /// The token where `fail` was last called, and its position.
    failed_at: (T, u32),
    /// `failed_at`, if that call is why the last `try_parse` rolled back.
    pub(crate) was_abandoned_at: Option<(T, u32)>,
}

/// `isAnExternalModuleIndicatorNode`
fn is_an_external_module_indicator(f: &FileBuilder, id: StmtId) -> bool {
    let Some(statement) = f.stmts.get(id.idx()) else {
        return false;
    };
    let flags = match statement.kind {
        StmtKind::Var(_) => f.modifiers_to_flags(f.stmt_modifiers(id)),
        StmtKind::Fn(x) => f[x].flags,
        StmtKind::Class(x) => f[x].flags,
        StmtKind::Interface(x) => f[x].flags,
        StmtKind::TypeAlias(x) => f[x].flags,
        StmtKind::Enum(x) => f[x].flags,
        StmtKind::Module(x) => f[x].flags,
        // `import a = b.c` aliases an existing entity. It doesn't make the file a module.
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

/// A parser's inputs.
struct Seed<'a> {
    lx: Lexer<'a>,
    file: FileBuilder,
    stacks: Stacks,
    declared: Declared,
    options: Options,
    jsdoc: jsdoc::State,
}

/// What a finished parser hands back, besides the file.
struct Harvest<'a> {
    lx: Lexer<'a>,
    stacks: Stacks,
    declared: Declared,
    end: (u32, u32),
    has_top_level_await: bool,
    has_plain_top_level_await: bool,
}

pub(crate) fn run<'a>(
    text: &'a [u8],
    options: Options,
    atoms: Option<&'a dyn Intern>,
    scratch: &'a mut Scratch,
) -> Result<Parsed, Rejected> {
    if text.len() >= 1 << 30 {
        return Err(Rejected::new(Rejection::TooLarge));
    }
    match (atoms, options.part) {
        (Some(atoms), _) => scratch.names.use_interner(atoms),
        (None, None) => scratch.names.begin_own(text.len()),
        // Size the table for the part, not for the whole text.
        (None, Some(part)) => {
            let len = part.until.saturating_sub(part.from) as usize;
            scratch.names.begin_own(len.min(1 << 12));
        }
    }
    let jsdoc = jsdoc::State::new(&options, atoms.is_some(), scratch.jsdoc_wanted);
    let atoms = atoms.unwrap_or(&crate::names::NoInterner);
    let mut f = scratch.recycled.take().unwrap_or_default();
    let mut file = recycled_file(&mut f);
    let mut stacks = std::mem::take(&mut scratch.stacks);
    stacks.clear();
    let mut declared = std::mem::take(&mut scratch.declared);
    declared.begin(
        text.len(),
        options.dialect.oxc_names,
        options.dialect.oxc && options.is_javascript,
        options.is_javascript,
    );
    let stops = scratch.stops.find_again(text);
    let mut lx = Lexer::new(text, stops, atoms, &mut scratch.names);
    if let Some(part) = options.part {
        lx.start_at(part.from);
        lx.set_src(text.get(..part.until as usize).unwrap_or(text));
    }
    lx.is_jsx = options.is_jsx;
    lx.recovers = options.recovers;
    lx.comments = std::mem::take(&mut file.comments);
    lx.attach_comments = options.attach_comments;
    let is_ecmascript = options.dialect.ecmascript && options.is_javascript && !options.is_json;
    lx.is_ecmascript = is_ecmascript;
    lx.is_typescript_5 = options.dialect.typescript_5;
    lx.is_babel = options.dialect.babel;
    lx.is_oxc = options.dialect.oxc;
    lx.is_script = (is_ecmascript || options.dialect.oxc) && options.dialect.script;
    lx.records_html_opens =
        options.dialect.oxc || is_ecmascript && options.dialect.module_or_script;
    let is_flow = options.dialect.flow && options.is_javascript && !options.is_json;
    let is_general = options.recovers || jsdoc.wanted != 0 || is_flow;
    let seed = Seed {
        lx,
        file,
        stacks,
        declared,
        options,
        jsdoc,
    };
    let Harvest {
        lx,
        stacks,
        declared,
        end,
        has_top_level_await,
        has_plain_top_level_await,
    } = match (is_general, options.attach_comments) {
        (true, _) => Parser::<true, true>::new(seed).parse_into(&mut f),
        (false, true) => Parser::<false, true>::new(seed).parse_into(&mut f),
        (false, false) => Parser::<false, false>::new(seed).parse_into(&mut f),
    };
    let (rejection, rejected_at) = (lx.rejection, lx.rejected_at);
    let (comment_directives, leading_comments) = (lx.comment_directives, lx.leading_comments);
    f.comments = lx.comments;
    scratch.stacks = stacks;
    scratch.declared = declared;
    scratch.html_opens = lx.html_opens;
    scratch.has_only_ambiguous_awaits = has_top_level_await && !has_plain_top_level_await;
    if let Some(why) = rejection {
        scratch.recycled = Some(f);
        return Err(Rejected {
            why,
            at: rejected_at.0,
            by: rejected_at.1,
            after: lx.rejected_after,
        });
    }
    if !f.has_room_for_handles() {
        scratch.recycled = Some(f);
        return Err(Rejected::new(Rejection::TooLarge));
    }
    f.comment_directives = comment_directives;
    let names = &mut scratch.names;
    let source = text;
    let mut intern = |it: &[u8]| names.atom(crate::names::Text::not_in_source(source, it), atoms);
    let errors = f.diagnostics.len();
    if !crate::pragmas::process_pragmas_into_fields(
        text,
        &leading_comments,
        options.recovers,
        &mut intern,
        &mut f,
    ) {
        scratch.recycled = Some(f);
        return Err(Rejected::new(Rejection::Reported));
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

impl<'a, const GENERAL: bool, const COMMENTS: bool> Parser<'a, GENERAL, COMMENTS> {
    #[inline(always)]
    fn new(seed: Seed<'a>) -> Self {
        let Seed {
            lx,
            file,
            stacks,
            declared,
            options,
            jsdoc,
        } = seed;
        let is_script = options.is_javascript && !options.is_json;
        let is_ecmascript = options.dialect.ecmascript && is_script;
        let is_flow = options.dialect.flow && is_script;
        let mut context = ctx::TOP_LEVEL | ctx::OUTSIDE_BODIES;
        if options.is_declaration_file {
            context |= ctx::AMBIENT;
        }
        // oxc parses a declaration file like any other file.
        if !options.await_is_a_name && (!options.is_declaration_file || options.dialect.oxc) {
            context |= ctx::AWAIT;
        }
        Parser {
            lx,
            f: file,
            s: stacks,
            context,
            class_depth: 0,
            options,
            recovers: options.recovers,
            reads_jsdoc: jsdoc.wanted != 0,
            jsdoc,
            comments: comments::CommentTracker::default(),
            lists: 0,
            // An empty range, so it contains no token.
            declaration_scan: stmt::DeclarationScan {
                from: 1,
                to: 0,
                context: 0,
                answer: false,
            },
            errors_at: (u32::MAX, 0),
            is_ecmascript,
            flow: is_flow,
            has_type_arguments_in_expressions: is_flow || !options.is_javascript,
            flow_statement_start: u32::MAX,
            cleared_in_types: match options.dialect.oxc {
                true => 0,
                false => ctx::YIELD | ctx::AWAIT,
            },
            suspensions: 0,
            is_typescript_for_oxc: options.dialect.oxc && !options.is_javascript,
            is_in_implements_for_oxc: false,
            is_in_interface_extends_for_oxc: false,
            has_odd_members: false,
            module_statements: (0, 0),
            odd_parameters: 0,
            declared_private_names: Vec::new(),
            declared,
            end: (0, 0),
            has_top_level_await: false,
            has_plain_top_level_await: false,
            has_await_in_statement: false,
            has_await_in_name: false,
            has_await_identifier: false,
            names_are_in_await_context: false,
            recovery_hit_await: false,
            reparses_rest_of_file: false,
            reparsed_at: u32::MAX,
            jsx_child_with_stale_token: u32::MAX,
            parameter_question_pos: 0,
            private_name_before_in: u32::MAX,
            not_arrows: Vec::new(),
            function_type_starts: Vec::new(),
            not_type_arguments: Vec::new(),
            last_nullable_type: (TypeNodeId::NONE, 0),
            speculations: 0,
            has_reported: false,
            failed_at: (T::Eof, 0),
            was_abandoned_at: None,
        }
    }

    /// Parses the source and stores the result in `file`.
    fn parse_into(mut self, file: &mut FileBuilder) -> Harvest<'a> {
        self.source_file();
        self.resolve_top_level_comments();
        self.report_scanner_flagged_errors();
        if !self.lx.private_names.is_empty() {
            self.f.rare_syntax |= rare::ODD_PRIVATE_NAME;
        }
        if self.has_top_level_await {
            self.f.rare_syntax |= rare::TOP_LEVEL_AWAIT;
        }
        self.note_odd_exports();
        *file = self.f;
        Harvest {
            lx: self.lx,
            stacks: self.s,
            declared: self.declared,
            end: self.end,
            has_top_level_await: self.has_top_level_await,
            has_plain_top_level_await: self.has_plain_top_level_await,
        }
    }

    /// `Options::recovers`
    #[inline(always)]
    pub(crate) fn recovers(&self) -> bool {
        GENERAL && self.recovers
    }

    /// `Dialect::flow`, in a JavaScript file. Only the general parser reads Flow.
    #[inline(always)]
    pub(crate) fn is_flow(&self) -> bool {
        GENERAL && self.flow
    }

    /// `Options::reads_jsdoc`, in a file whose comments are read.
    #[inline(always)]
    pub(crate) fn reads_jsdoc(&self) -> bool {
        GENERAL && self.reads_jsdoc
    }

    /// `parseSourceFileWorker`
    fn source_file(&mut self) {
        self.f.source_len = self.lx.src.len() as u32;
        self.end = (self.f.source_len, self.f.source_len);
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
        self.f.is_flow = self.is_flow();
        self.next();
        let base = self.s.ids.len();
        self.lists = 1 << ListKind::SourceElements as u32;
        if self.options.is_json {
            let value = self.json_text();
            self.f.has_module_syntax = true;
            self.s.ids.push(value.0);
        }
        if let Some(part) = self.options.part {
            let part = self.part(part.goal);
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
                self.module_statements.1 += 1;
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
        // A statement that was parsed twice is counted twice, so the flag only means "maybe".
        if self.module_statements.0 > self.module_statements.1 {
            self.f.rare_syntax |= rare::NESTED_MODULE_SYNTAX;
        }
        if self.options.is_declaration_file && self.reports_like_oxc() {
            let body = self.f.body;
            oxc::statements_in_ambient_context(&mut self.f, self.lx.src, body);
        }
        self.take_scanner_errors();
        if self.reads_jsdoc() {
            self.finish_jsdoc();
        }
        if self.f.diagnostics.iter().any(|it| it.code == 1141) {
            self.drop_specifier_errors_in_misplaced_declarations();
        }
        if self.is_ecmascript && !self.is_flow() && !self.has_failed() {
            bun_sema::ecmascript::report_typescript_only_syntax(&mut self.f, self.lx.src);
        }
        // typescript-estree, acorn and Babel throw the first error reported, which isn't always the first in the text.
        // The scanner reports a malformed token before the parser reports that it expected a different one.
        if self.f.diagnostics.len() > 1 && self.options.dialect == Default::default() {
            self.f
                .diagnostics
                .shared_sort_by_key(|it| (it.start, it.code));
        }
        let is_parse_error = |it: &Diagnostic| it.kind == DiagnosticKind::Parse;
        self.f.has_parse_diagnostics =
            self.recovers() && self.f.diagnostics.iter().any(is_parse_error);
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
        // A `with` clause nested in an import type's options is pushed before the outer one.
        if !self.f.import_attributes.is_sorted_by_key(|it| it.0) {
            self.f
                .import_attributes
                .shared_sort_unstable_by_key(|it| it.0);
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

    /// `nextTokenWithoutCheck`: advances past a word that's used as a name.
    #[inline(always)]
    pub(crate) fn next_after_name(&mut self) {
        self.take_as_name();
        let (pos, end) = (self.lx.start, self.lx.end);
        self.lx.next();
        self.finish_name(pos, end);
    }

    /// Advances past a string literal that's a field of its node here but a `Literal` node in ESTree: `module "a" {}`.
    #[inline(always)]
    pub(crate) fn next_after_string(&mut self) {
        let (pos, end) = (self.lx.start, self.lx.end);
        self.next();
        self.finish_name(pos, end);
    }

    /// Marks the current token, a word, as used as a name.
    #[inline(always)]
    pub(crate) fn take_as_name(&mut self) {
        if GENERAL && self.lx.has_escape {
            self.discard_escaped_keyword_error();
        }
    }

    /// The current token's start.
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

    /// The same value as `full_start`, for callers that use it as a node's end.
    #[inline(always)]
    pub(crate) fn prev_end(&self) -> u32 {
        self.lx.full_start
    }

    #[inline(always)]
    pub(crate) fn newline_before(&self) -> bool {
        self.lx.newline_before
    }

    /// Called at a token the grammar doesn't allow here.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn fail(&mut self) {
        // Recovery isn't implemented here yet. TypeScript continues even in a speculative parse, so give up on the
        // file.
        if self.recovers() {
            return self.reject(Rejection::Unsupported);
        }
        if !self.has_failed() {
            self.failed_at = (self.lx.token, self.lx.start);
        }
        self.lx.reject(Rejection::Syntax);
    }

    /// Gives up on the file, even during a speculative parse.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn reject(&mut self, why: Rejection) {
        // `Syntax` only ends a speculation, so `why` replaces it.
        if self.lx.rejection == Some(Rejection::Syntax) {
            self.lx.rejection = None;
        }
        self.lx.reject(why);
    }

    /// Called where TypeScript reports an error and continues. A speculative parse continues too, and its errors are
    /// dropped if it's rolled back.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn report(&mut self) {
        match self.speculations {
            0 => self.reject(Rejection::Reported),
            _ => self.has_reported = true,
        }
    }

    /// Returns `ctx::DISALLOW_IN` if brackets, braces, and function parameters and bodies clear it, otherwise 0.
    /// TypeScript's parser doesn't clear it there.
    #[inline(always)]
    pub(crate) fn disallow_in_if_cleared_by_brackets(&self) -> u32 {
        match self.is_ecmascript {
            true => ctx::DISALLOW_IN,
            false => 0,
        }
    }

    /// Turns `Lexer::flagged` into diagnostics.
    fn report_scanner_flagged_errors(&mut self) {
        for (code, start, end) in std::mem::take(&mut self.lx.flagged) {
            let raw = self
                .lx
                .src
                .get(start as usize..end as usize)
                .unwrap_or_default();
            let digits = |from: usize| core::str::from_utf8(raw.get(from..).unwrap_or_default());
            let octal = |from: usize| {
                digits(from)
                    .ok()
                    .and_then(|it| u64::from_str_radix(it, 8).ok())
            };
            let argument = match code {
                // `\1`
                1487 => format!("\\x{:02x}", octal(1).unwrap_or(0)).into_bytes(),
                // `\8`
                1488 => raw.to_vec(),
                // `010`, `-010`
                1121 => match raw.first() {
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

    /// Records an error that isn't a parse error. TypeScript builds the same tree with or without it.
    #[cold]
    #[inline(never)]
    pub(crate) fn flag(&mut self, kind: DiagnosticKind, code: u32, at: (u32, u32), args: &[&[u8]]) {
        self.f
            .diagnostics
            .push(Diagnostic::new(kind, at, code, args));
    }

    #[inline(always)]
    pub(crate) fn has_failed(&self) -> bool {
        self.lx.rejection.is_some()
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

    /// `parseExpectedMatchingBrackets`. `open_at` is the position of `open`, if it was present.
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

    /// Consumes a `;` that terminates a statement or a class member, if the current token is one.
    #[inline(always)]
    pub(crate) fn eat_semicolon(&mut self) -> bool {
        if self.lx.token != T::Semicolon {
            return false;
        }
        if COMMENTS && self.lx.full_start != self.lx.start {
            self.record_detached_semicolon();
        }
        self.lx.next();
        true
    }

    #[cold]
    #[inline(never)]
    fn record_detached_semicolon(&mut self) {
        if self.options.attach_comments {
            (self.f.detached_semicolons).push((self.lx.start, self.lx.full_start));
        }
    }

    /// `parseSemicolon`
    #[inline(always)]
    #[track_caller]
    pub(crate) fn semicolon(&mut self) {
        if !self.eat_semicolon()
            && !(matches!(self.lx.token, T::CloseBrace | T::Eof) || self.lx.newline_before)
        {
            self.expected(T::Semicolon);
        }
    }

    /// True if the list that `close` terminates continues.
    #[inline(always)]
    pub(crate) fn is_in_list(&self, close: T) -> bool {
        self.lx.token != close && self.lx.token != T::Eof
    }

    /// Every recursive path in the parser goes through a function that calls this before anything else on that path.
    /// `test/internal/source-lints/sema-parser-recursion.test.ts` looks for paths that don't.
    #[inline(always)]
    pub(crate) fn is_too_deep(&mut self) -> bool {
        if self.lx.stack_check.is_safe_to_recurse() {
            return false;
        }
        self.reject(Rejection::TooDeep);
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

    /// `NodeFlagsAmbient`, as a declaration flag.
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
        let had_failed = self.lx.rejection;
        let result = test(self);
        // Whatever the scanner rejects during lookahead, it rejects again when the parser gets there.
        self.lx.rejection = had_failed;
        self.lx.reset(mark);
        result
    }

    /// True if `text` immediately follows the current token.
    #[inline]
    pub(crate) fn is_followed_by(&self, text: &[u8]) -> bool {
        let rest = self.lx.src.get(self.lx.end as usize..);
        rest.is_some_and(|rest| rest.starts_with(text))
    }

    /// Returns the next token's kind.
    #[inline]
    pub(crate) fn peek(&mut self) -> T {
        self.look_ahead(|p| {
            p.next();
            p.token()
        })
    }

    pub(crate) fn checkpoint(&mut self) -> Checkpoint {
        // `rollback` would drop scanner errors taken after this point, and their tokens aren't scanned again.
        self.take_scanner_errors();
        // Call this first. After the others, it would keep all their results on the stack during the call.
        let jsdoc = self.jsdoc_lens();
        Checkpoint {
            mark: self.lx.mark(),
            file: file_lens(&self.f),
            stacks: self.s.lens(),
            context: self.context,
            lists: self.lists,
            class_depth: self.class_depth,
            has_top_level_await: self.has_top_level_await,
            declared: self.declared.mark(),
            jsdoc,
            comments: self.comment_checkpoint(),
        }
    }

    pub(crate) fn rollback(&mut self, to: &Checkpoint) {
        self.lx.reset(to.mark);
        truncate_file(&mut self.f, &to.file);
        self.s.truncate(&to.stacks);
        self.context = to.context;
        self.lists = to.lists;
        self.class_depth = to.class_depth;
        self.has_top_level_await = to.has_top_level_await;
        self.declared.rollback(to.declared);
        if self.reads_jsdoc() {
            self.rollback_jsdoc(to);
        }
        self.rollback_comments(to);
    }

    /// Discards the nodes built since `since`, which don't belong anywhere in the tree. The tokens stay consumed, and
    /// diagnostics and other records about the text are kept.
    #[cold]
    #[inline(never)]
    pub(crate) fn discard_nodes(&mut self, since: &Checkpoint) {
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

    /// `tryParse`: keeps what `parse` built if it returns `Some` and hit no syntax error. Otherwise rolls back.
    pub(crate) fn try_parse<R>(&mut self, parse: impl FnOnce(&mut Self) -> Option<R>) -> Option<R> {
        if self.has_failed() {
            return None;
        }
        let checkpoint = self.checkpoint();
        let had_reported = self.has_reported;
        self.speculations += 1;
        let result = parse(self);
        self.speculations -= 1;
        match self.lx.rejection {
            None if result.is_some() => {
                // The parse is kept, so the errors it reported count.
                if self.has_reported && self.speculations == 0 {
                    self.has_reported = false;
                    self.reject(Rejection::Reported);
                }
                return result;
            }
            None => self.was_abandoned_at = None,
            Some(Rejection::Syntax) => {
                self.lx.rejection = None;
                self.was_abandoned_at = Some(self.failed_at);
            }
            // The parser gave up on the file.
            Some(_) => return None,
        }
        self.has_reported = had_reported;
        self.rollback(&checkpoint);
        None
    }

    /// `lookAhead` for a test that parses. Everything it built is discarded.
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
        let result = match self.lx.rejection {
            None => result,
            Some(Rejection::Syntax) => {
                self.lx.rejection = None;
                false
            }
            Some(_) => return false,
        };
        self.rollback(&checkpoint);
        result
    }

    // ───────────────────────────── names ─────────────────────────────

    /// Records the `Identifier` at `pos`, whose text is `atom`.
    #[inline(always)]
    pub(crate) fn note_identifier(&mut self, atom: Atom, pos: u32) -> Atom {
        if atom.is_keyword_identifier() {
            self.note_keyword_identifier(atom, pos);
        }
        atom
    }

    /// [`Parser::note_identifier`] for a name referenced in a type. oxc's parser accepts any word there.
    #[inline(always)]
    pub(crate) fn note_name_in_type(&mut self, atom: Atom, pos: u32) {
        if atom.is_keyword_identifier() {
            self.f.keyword_identifier_positions.push(pos);
            if atom == known::r#await {
                self.note_await_as_a_name();
            }
        }
    }

    /// oxc's parser reports `await` and `yield` used as names in a context where they're keywords. At the top level, a
    /// file is in the await context from its first `import` or `export` on, or because of its file name, which isn't
    /// known here.
    #[cold]
    #[inline(never)]
    fn note_keyword_identifier(&mut self, atom: Atom, pos: u32) {
        self.f.keyword_identifier_positions.push(pos);
        if !self.options.dialect.oxc {
            return;
        }
        // oxc treats `await` in a type as a name.
        let is_keyword_here =
            atom == known::r#await && self.has_context(ctx::AWAIT) && !self.has_context(ctx::TYPE)
                || atom == known::r#yield && self.has_context(ctx::YIELD);
        let is_at_top_level = atom == known::r#await && self.has_context(ctx::TOP_LEVEL);
        if is_keyword_here {
            let code = match (is_at_top_level, self.f.has_module_syntax) {
                (false, _) => 1359,
                (true, true) => 1262,
                (true, false) => 1214,
            };
            self.flag(DiagnosticKind::Grammar, code, (pos, pos + 5), &[]);
        }
    }

    /// `isIdentifier`. Where the grammar requires a name, oxc's parser accepts `await` and `yield` in every context and
    /// reports them (see `note_keyword_identifier`). It tries an `await` or `yield` expression before it gets there.
    #[inline(always)]
    pub(crate) fn is_identifier(&self) -> bool {
        self.is_identifier_in_context() || self.lx.token > T::With && self.options.dialect.oxc
    }

    /// `isIdentifier`
    #[inline(always)]
    pub(crate) fn is_identifier_in_context(&self) -> bool {
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

    /// `parseIdentifier`. Returns the name and its position.
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

    /// `parseIdentifierName`: accepts any word. `tokenIsIdentifierOrKeyword` counts a private name as one.
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
        let text = crate::names::Text::not_in_source(self.lx.src, text);
        self.lx.names.atom(text, self.lx.atoms)
    }

    /// Returns `String(n)` as an atom.
    pub(crate) fn number_name(&mut self, n: f64) -> Atom {
        let text = bun_sema::atom::number_to_string(n);
        self.atom(&text)
    }

    // ───────────────────────────── lists ─────────────────────────────

    /// Pops the id stack's entries from `base` on and returns them as a list.
    #[inline]
    pub(crate) fn take_ids<I>(&mut self, base: usize) -> IdList<I> {
        let start = self.f.ids.len() as u32;
        let items = self.s.ids.get(base..).unwrap_or_default();
        let len = items.len() as u32;
        match *items {
            [only] if self.f.ids.len() < self.f.ids.capacity() => self.f.ids.push(only),
            _ => self.f.ids.extend_from_slice(items),
        }
        self.s.ids.truncate(base);
        IdList::new(start, len)
    }

    /// Records the decorators among the modifiers from `base` on, then pops those modifiers. The decorators belong to a
    /// `MissingDeclaration` or a `this` parameter, which `checkDecorators` doesn't visit. See `File::stray_decorators`.
    /// `end` is the start of whatever follows the decorators.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn note_stray_decorators(&mut self, base: usize, end: u32) {
        if !self.recovers() {
            return self.fail();
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

    /// Call after parsing a statement of a list and before pushing it on the id stack. Pushes the decorators that
    /// `note_stray_decorators` saved while parsing it, as statements that precede it. `base` is how many were saved
    /// when the list began.
    #[inline(always)]
    pub(crate) fn take_stray_decorators(&mut self, base: usize) {
        if GENERAL && self.s.stray_decorators.len() > base {
            self.take_stray_decorators_slow(base);
        }
    }

    #[cold]
    #[inline(never)]
    fn take_stray_decorators_slow(&mut self, base: usize) {
        for index in base..self.s.stray_decorators.len() {
            let Some(&(start, decorator)) = self.s.stray_decorators.get(index) else {
                break;
            };
            self.s.ids.push(self.f.stmts.len() as u32);
            self.f.stmts.push(Stmt {
                kind: StmtKind::Expr(decorator),
                start,
                loc: TextRange::default(),
            });
        }
        self.s.stray_decorators.truncate(base);
    }
}

/// Moves a stack's entries from `base` on to the file's list of the same name. Evaluates to their `Span`.
macro_rules! take_span {
    ($p:expr, $field:ident, $base:expr) => {{
        let base: usize = $base;
        let start = $p.f.$field.len() as u32;
        let items = $p.s.$field.get(base..).unwrap_or_default();
        let len = items.len() as u32;
        // Push only when there's capacity, because a push that can grow the list keeps `only` in a recursive function's
        // frame.
        match *items {
            [only] if $p.f.$field.len() < $p.f.$field.capacity() => $p.f.$field.push(only),
            _ => $p.f.$field.extend_from_slice(items),
        }
        $p.s.$field.truncate(base);
        $crate::parser::comments::finish_list!($p, $field, start, len);
        bun_sema::hir::Span::new(start, len)
    }};
}
pub(crate) use take_span;
