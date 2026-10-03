//! Produces the input of `bun_sema`: records the type syntax the parser skips, and lowers a parsed
//! file to the HIR the type checker works from.
//!
//! The parser has two modes for type syntax. By default it skips types. When [`TypeSyntax`] is
//! present, the same code also builds syntax-only `crate::sema::ts_syntax` nodes for them (see
//! [`keep`]). The JavaScript AST is identical in both modes.
//! After the parse pass, where ordinary builds start the visit pass, [`lower`] walks the statements
//! and clones them and the type syntax ([`clone_types`]) into the type checker's HIR.
//!
//! In JavaScript the types are in JSDoc comments. Before the lowering pass, [`jsdoc`] parses the
//! tags of the comments the lexer recorded, and has the parser parse the types in them. During the
//! lowering pass, [`reparse`] turns the tags of each comment attached to a node into ordinary
//! annotations, casts and declarations.

pub(crate) mod builder;
pub(crate) mod clone_types;
pub(crate) mod comments;
pub(crate) mod jsdoc;
pub(crate) mod keep;
pub(crate) mod lower;
pub(crate) mod lower_modules;
pub(crate) mod notes;
pub(crate) mod parse_declarations;
pub(crate) mod reparse;
pub(crate) mod ts_syntax;

use crate::sema::ts_syntax as ts;
use bun_ast::{Expr, Loc};
use bun_sema::hir::{Diagnostic, DiagnosticKind};

/// The kind of a note: information the parser records about a node that `bun_ast` has no field for
/// (see [`notes`]). Each variant documents which node the note is on and what its payload is.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Mark {
    /// On a binding, or on the name of a class member: its type (`ts::TypeId`).
    Annotation,
    /// On the same nodes, or on the name of an object literal method: `?` follows it, with the
    /// position of the `?`.
    Optional,
    /// On the same nodes: `!` follows it.
    Definite,
    /// On the `(` of a function's parameters, or on an arrow function: the return type
    /// (`ts::TypeId`).
    ReturnType,
    /// On the `(` of a function's parameters, on the `class` keyword, or on an arrow function: the
    /// type parameters (`ts::Span<ts::TypeParam>`, in `Notes::ranges`).
    TypeParameters,
    /// On the `(` of a function's parameters: its `this` parameter (`ts::Id<ts::Param>`).
    ThisParameter,
    /// On the `)` of a call, of a `new` expression or of an import call: the type arguments
    /// (`ts::IdList<ts::Type>`, in `Notes::ranges`).
    TypeArguments,
    /// On the `)` of a call of `async`: the type arguments, which were parsed as type parameters
    /// (`ts::Span<ts::TypeParam>`, in `Notes::ranges`).
    TypeArgumentsReadAsParameters,
    /// On a tagged template: the type arguments of its tag, like `TypeArguments`.
    TagTypeArguments,
    /// On a tagged template: the position of its `` ` ``.
    Backtick,
    /// On a tagged template: its last piece of text is missing or unterminated
    /// (`callIsIncomplete`).
    IncompleteTemplate,
    /// On the body of an arrow function (`G::FnBody::loc`): the position of its `=>`. On an
    /// expression body only if the `=>` is missing, because its `loc` is at the `=>`.
    ArrowToken,
    /// On the `class` keyword: the type arguments after the `extends` expression, like
    /// `TypeArguments`.
    ExtendsArguments,
    /// On the `class` keyword: an element of an `extends` clause that is not the first
    /// (`ts::Id<Expr>`). One note per element.
    OtherExtends,
    /// On the `class` keyword: the start of an `implements` clause, and a second note for its end.
    /// Two notes per clause.
    ImplementsClause,
    /// On the `class` keyword: an element of its first `implements` clause (`ts::TypeId`). One note
    /// per element.
    Implements,
    /// On the `class` keyword: an element of an `implements` clause that is not the first
    /// (`ts::TypeId`). One note per element.
    OtherImplements,
    /// On the `class` keyword: an index signature of the class (`ts::MemberId`). One note per
    /// signature.
    IndexSignature,
    /// On the `class` keyword: the position of a `;` among its members that is preceded by
    /// comments. One note per `;`.
    SemicolonClassElement,
    /// On the `class` keyword: `TokenFullStart` of each of those, in the same order.
    SemicolonFullStart,
    /// On the name of a class member (the `{` of a static block), of an object literal member or of
    /// a JSX attribute (the `e` of `{...e}`): the position of its first token: a decorator, a
    /// modifier, `get`, `set`, `*`, `[`, `{`.
    MemberStart,
    /// On the same nodes: `TokenFullStart` of that token (`node.Pos()`). On an object literal
    /// member only in JavaScript, if comments precede it.
    MemberFullStart,
    /// On the same nodes, or on the `e` of `...e` in an object literal: the end of the member's
    /// last token.
    MemberEnd,
    /// On a class member name that is a string literal: the position of the next token.
    StringLiteralName,
    /// On an enum member: the `hir::NameKind` of its name, if it is not an identifier.
    NameKind,
    /// On the `key` of the name `[key]` of a member or of a property in a pattern: the position of
    /// the `[`. On an enum member: the `key` that is neither a string nor a number
    /// (`ts::Id<Expr>`).
    ComputedName,
    /// On the omitted element of `[a, , b]`.
    OmittedExpression,
    /// On a binding, or on the `e` of `...e` in an object literal: the position of the `...` before
    /// it.
    DotDotDot,
    /// On a statement, a class expression, or the name or pattern of a parameter: the position of
    /// its first token: a decorator, a modifier, `...`, or the placeholder for a missing name.
    DeclarationStart,
    /// On a statement, or on the name of a parameter or of a class member: its modifiers
    /// (`ts::Span<ts::Modifier>`, in `Notes::ranges`).
    Modifiers,
    /// On the parameter of `x => x` when comments precede it: they do not belong to it
    /// (`parseSimpleArrowFunctionExpression`).
    SimpleArrowParameter,
    /// On an expression statement: its first token is `(` (`hasParen`,
    /// `parseExpressionOrLabeledStatement`).
    HasParen,
    /// On the binding of a `catch` clause: its initializer (`ts::Id<Expr>`).
    Initializer,
    /// On the name of a module: it is a string (`parseAmbientExternalModuleDeclaration`).
    StringName,
    /// On the name of a module: it is `global` (`NodeFlagsGlobalAugmentation`).
    GlobalName,
    /// On the name of a module: `ModuleDeclaration.Keyword` is `module`.
    ModuleKeyword,
    /// On the name of a module: `declare module "a";`.
    NoBody,
    /// On the position where the `(` of a function's parameters was expected: the end of the
    /// previous token (`createMissingList`).
    MissingParameters,
    /// On the `(` of a function's parameters: the position where its `{` was expected. The body is
    /// a missing block (`parseBlock`).
    MissingBody,
    /// On `import.defer(..)`: the position of its `)`.
    DeferredImportClose,
    /// On an import call: an argument after the second (`ts::Id<Expr>`). One note per argument.
    OtherArgument,
    /// On `new.target`: the name used instead of `target`, as a string (`ts::Id<Expr>`).
    MetaPropertyName,
    /// On a binding: `node.End()` of the pattern, or of a name that contains an escape. The node
    /// entry at that `loc` holds the range of the declaration.
    PatternEnd,
    /// On the name of an object literal member: the position of its `PostfixToken`, a `?` or a `!`.
    PostfixToken,
    /// On the expression inside the braces of a `JsxExpression`: the position of the `{`.
    JsxExpression,
    /// On the same, among the children of an element: `node.End()` of the `JsxExpression`.
    JsxExpressionEnd,
    /// On the expression of a decorator: the position of its `@`.
    AtSign,
    /// On the same: `node.End()` of the decorator.
    DecoratorEnd,

    // Nodes that wrap an expression and that the AST represents as the expression alone. Recorded
    // in the order they are built: `(e) as T` is not `(e as T)`.
    /// `node.End()` of the node built by the next note, not counting `LessThan` and
    /// `InstantiationStart`.
    End,
    /// `e as T`, `<T>e`: the type (`ts::TypeId`).
    As,
    /// `<T>(e)` that was parsed as the type parameters of an arrow function: those type parameters
    /// (`ts::Span<ts::TypeParam>`, in `Notes::ranges`).
    AsTypeParameter,
    /// The next `As` or `AsTypeParameter` note is `<T>e`: the position of the `<`.
    LessThan,
    /// `e satisfies T`: the type (`ts::TypeId`).
    Satisfies,
    /// `e!`
    NonNull,
    /// Position of the `<` of the next `Instantiation` note.
    InstantiationStart,
    /// `e<T>` whose type arguments no other node consumes: the type arguments, like
    /// `TypeArguments`.
    Instantiation,
    /// Comments precede the `(` of the next `Paren` note: its `TokenFullStart`.
    ParenFullStart,
    /// `(e)`: the position of the `(`.
    Paren,
}

impl Mark {
    /// Whether it builds a node of its own kind around an expression.
    #[inline]
    pub(crate) fn is_cast(self) -> bool {
        matches!(
            self,
            Mark::As
                | Mark::AsTypeParameter
                | Mark::Satisfies
                | Mark::NonNull
                | Mark::Instantiation
                | Mark::Paren
        )
    }
}

/// The TypeScript error code for the parser error `text`, after which the parser continued as if
/// there were no error.
/// `0`: the checker detects the error itself. `None`: the AST is unreliable.
pub(crate) fn early_error(text: &[u8], at: &[u8]) -> Option<(u32, i32)> {
    // TypeScript reports at the keyword, the parser after it.
    if text == b"\"await\" can only be used inside an \"async\" function" {
        return Some((1308, -6));
    }
    // `checkGrammarModifiers`
    if text == b"Class constructor cannot be an async function" {
        return Some((0, 0));
    }
    // `checkMethodDeclaration`: only for the keyword. The string literal is an ordinary name.
    if text == b"Class constructor cannot be a generator function" {
        return Some((
            if at.starts_with(b"constructor") {
                1368
            } else {
                0
            },
            0,
        ));
    }
    early_error_in_place(text).map(|code| (code, 0))
}

/// Converts a logged error and its notes to the diagnostic TypeScript reports. `Some(None)`: no diagnostic, because the checker
/// detects the error itself. `None`: an unrecognized error, so the AST is unreliable. `has_jsx`: `LanguageVariantJSX`.
pub(crate) fn diagnostic(
    data: &bun_ast::Data,
    notes: &[bun_ast::Data],
    source: &[u8],
    has_jsx: bool,
) -> Option<Option<Diagnostic>> {
    let location = data.location.as_ref()?;
    let (text, mut len) = (&data.text[..], location.length);
    let at = source.get(location.offset..).unwrap_or_default();
    let (code, delta) = early_error(text, at)?;
    let kind = match text {
        _ if code == 0 => return Some(None),
        // 1368: `checkMethodDeclaration` reports it with a plain `c.error`.
        [b'T', b'C', ..] => DiagnosticKind::Checker,
        _ if code == 1368 => DiagnosticKind::Checker,
        [b'T', b'G', ..] => DiagnosticKind::Grammar,
        [b'T', b'S', ..] => DiagnosticKind::Parse,
        // `Lexer::expected` and `Lexer::unexpected`
        _ if matches!(code, 1003 | 1005 | 1109) => DiagnosticKind::Parse,
        // `createIdentifierWithDiagnostic`, at a reserved word.
        _ if code == 1359 && text.starts_with(b"Expected identifier ") => DiagnosticKind::Parse,
        _ => DiagnosticKind::Grammar,
    };
    match at {
        // `Scan` produces one token for `</` unless the `/` starts a comment. This lexer produces two.
        [b'<', b'/', rest @ ..] if has_jsx && len == 1 && rest.first() != Some(&b'*') => len = 2,
        // `Scan` always produces a single `>`. `reScanGreaterThanToken` only runs after an operand, where 1005 is reported.
        [b'>', b'>' | b'=', ..] if !matches!(code, 1005 | 1185) => len = len.min(1),
        _ => {}
    }
    let mut related: Vec<Diagnostic> = (notes.iter())
        .filter_map(|note| diagnostic(note, &[], source, has_jsx)?)
        .collect();
    // `parseTypedefTag` adds this related info without a location.
    if code == 8033 {
        related.push(Diagnostic::new(kind, (0, 0), 8034, &[]));
    }
    Some(Some(Diagnostic {
        kind,
        start: (location.offset as i64 + i64::from(delta)).max(0) as u32,
        end: match (delta, len) {
            (0, 0) => Diagnostic::NO_LENGTH,
            (0, _) => (location.offset + len) as u32,
            _ => 0,
        },
        code,
        args: error_arguments(data, code, source).unwrap_or_default(),
        related,
    }))
}

/// The message arguments of the logged error `reported`, which has `code`.
fn error_arguments(reported: &bun_ast::Data, code: u32, source: &[u8]) -> Option<Box<[Box<[u8]>]>> {
    let text = &reported.text[..];
    // `createIdentifierWithDiagnostic`, `parsingContextErrors`, `checkGrammarObjectLiteralExpression`: these name the token they are
    // reported at.
    if matches!(code, 1042 | 1359 | 1389 | 1390) {
        let at = reported.location.as_ref()?;
        let token = source.get(at.offset..at.offset + at.length)?;
        return Some(Box::new([token.into()]));
    }
    // `Lexer::ts_error_about`
    let reported = (text.starts_with(b"TS") || text.starts_with(b"TG"))
        .then(|| bun_core::strings::index_of_char_usize(text, b' '))
        .flatten();
    let token = match reported {
        Some(space) => &text[space + 1..],
        // `Lexer::expected_string`: `Expected ";" but found "x"`
        None => {
            let rest = text.strip_prefix(b"Expected ")?;
            let end = bun_core::strings::index_of(rest, b" but found ")?;
            let token = &rest[..end];
            token
                .strip_prefix(b"\"")
                .and_then(|token| token.strip_suffix(b"\""))
                .unwrap_or(token)
        }
    };
    // `Lexer::ts_error_about`: a NUL separates two arguments.
    Some(token.split(|&b| b == 0).map(Box::from).collect())
}

fn early_error_in_place(text: &[u8]) -> Option<u32> {
    // `Lexer::ts_error` (TS), `ts_grammar_error` (TG), `ts_checker_error` (TC): the error was
    // logged as a TypeScript code in the first place.
    if let Some(code) = text
        .strip_prefix(b"TS")
        .or_else(|| text.strip_prefix(b"TG"))
        .or_else(|| text.strip_prefix(b"TC"))
    {
        // `Lexer::ts_error_about` appends the message arguments.
        let digits = code.iter().take_while(|b| b.is_ascii_digit()).count();
        return std::str::from_utf8(&code[..digits]).ok()?.parse().ok();
    }
    let (starts, ends) = (|s: &[u8]| text.starts_with(s), |s: &[u8]| text.ends_with(s));
    Some(
        if ends(b" has already been declared")
        || text == b"Cannot use a declaration in a single-statement context"
        || text == b"Unexpected \"super\""
        || text == b"Cannot use \"this\" here"
        || ends(b" loops must have a single declaration")
        || ends(b" loop variables cannot have an initializer")
        || (starts(b"Setter ") || starts(b"Getter ")) && (ends(b")") || ends(b" arguments"))
        // `checkContextualIdentifier`, `checkStrictModeEvalOrArguments`: the checker visits every
        // such name itself.
        || ends(b" is a reserved word and cannot be used in strict mode")
        || starts(b"Cannot use ") && ends(b" as an identifier here")
        || text == b"Cannot use \"yield\" or \"await\" here."
        || starts(b"An async function cannot be named ")
        // `reportObviousDecoratorErrors`: the decorators are preserved, and reported together with
        // those on all other nodes that cannot be decorated.
        || text == b"TypeScript does not allow decorators on class constructors"
        // `checkGrammarVariableDeclaration`: 1492 1182 1155.
        || ends(b" must be initialized")
        // `ReScanSlashToken` reports nothing about flags while parsing. `checkGrammarRegularExpressionLiteral`: 1499 1500 1501 1502.
        || (starts(b"Invalid flag \"") || starts(b"Duplicate flag \"")) && ends(b" in regular expression")
        // The parser accepts any member name. `checkGrammarProperty`: 18006. `checkObjectTypeForDuplicateDeclarations`: 2699.
        || text == b"Invalid field name"
        || text == b"Invalid static method name \"prototype\""
        // `checkGrammarModifiers`: 1491 1495. `checkGrammarVariableDeclarationList`: 1545 1546.
        || starts(b"Cannot use ") && ends(b" declaration") && bun_core::strings::contains(text, b"\" with a")
        // `checkContextualIdentifier`: 1212 1213 1214.
        || text == b"An generator function expression cannot be named \"yield\""
        // `checkDeleteExpression`: 18011.
        || starts(b"Deleting the private name ")
        // `checkGrammarParameterList`: 1048. `checkGrammarBindingElement`: 1186.
        || text == b"A rest argument cannot have a default initializer"
        {
            0
        } else if ends(b" outside a generator function") {
            1163
        } else if text == b"Cannot use \"await\" outside an async function" {
            1103
        } else if text == b"\"await\" is only allowed in an \"async\" function" {
            1308
        } else if text == b"A return statement cannot be used here" {
            18041
        } else if text == b"Invalid field name \"#constructor\""
            || text == b"Invalid method name \"#constructor\""
        {
            // `checkPrivateIdentifier`
            18012
        } else if text == b"Template literals cannot have an optional chain as a tag" {
            // `checkGrammarTaggedTemplateChain`
            1358
        } else if let Some(found) = text.strip_prefix(b"Expected identifier but found ") {
            // `createIdentifierWithDiagnostic`
            if found
                .strip_prefix(b"\"")
                .and_then(|word| word.strip_suffix(b"\""))
                // `isReservedWord`
                .is_some_and(|word| bun_ast::lexer_tables::keyword(word).is_some())
            {
                1359
            } else {
                1003
            }
        } else if starts(b"Expected \"") || starts(b"Expected ") && ends(b" but found end of file")
        {
            1005
        } else if text == b"Unexpected trailing comma after rest element"
            || text == b"Unexpected \",\" after rest pattern"
        {
            // `checkGrammarForDisallowedTrailingComma`
            1013
        } else if starts(b"Unexpected ") {
            1109
        } else {
            return None;
        },
    )
}

thread_local! {
    /// The arena files are parsed in, and how much source has been parsed in it since it was reset.
    static ARENA: core::cell::RefCell<Option<(bun_alloc::Arena, usize)>> = const { core::cell::RefCell::new(None) };
}

/// Per-thread buffers reused from one file to the next to reduce allocation. A pool thread outlives
/// a check, so the check owns this: a thread holds one only while it works for the check.
#[derive(Default)]
pub struct ThreadCaches(notes::Notes, builder::Recycled);

impl ThreadCaches {
    /// Takes the caches from the calling thread, and frees the arena it parsed in. Only the thread
    /// that created an arena allocates in it.
    pub fn take() -> ThreadCaches {
        ARENA.take();
        ThreadCaches::default().install()
    }

    /// Installs the caches on the calling thread. Returns the previous ones.
    pub fn install(self) -> ThreadCaches {
        ThreadCaches(
            notes::replace_recycled(self.0),
            builder::replace_recycled(self.1),
        )
    }
}

/// The type checker's input for the TypeScript file `text` at `path`.
pub fn summarize(
    path: &[u8],
    text: &[u8],
    atoms: &bun_sema::atom::Interner,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
) -> (bun_sema::hir::File, core::time::Duration) {
    // How long `parse_stmts_up_to` took. The rest is lowering.
    let parsing = core::cell::Cell::new(core::time::Duration::ZERO);
    // `GetDeclarationFileExtension`
    let base = &path[path
        .iter()
        .rposition(|&b| matches!(b, b'/' | b'\\'))
        .map_or(0, |i| i + 1)..];
    let is_declaration_file = base.ends_with(b".d.ts")
        || base.ends_with(b".d.mts")
        || base.ends_with(b".d.cts")
        || base.ends_with(b".ts") && bun_core::strings::contains(base, b".d.");
    let is_js = [&b".js"[..], b".jsx", b".mjs", b".cjs"]
        .iter()
        .any(|e| path.ends_with(e));
    let is_json = path.ends_with(b".json");
    // `getLanguageVariant`: JSX is enabled in all JavaScript files.
    let loader = if is_js || path.ends_with(b".tsx") {
        bun_ast::Loader::Tsx
    } else {
        bun_ast::Loader::Ts
    };
    // Parses the file once. Also returns whether it must be parsed again with `await` as an
    // identifier at the top level.
    let parse = |await_is_a_name: bool, arena: &bun_alloc::Arena| -> (bun_sema::hir::File, bool) {
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(path, text);
        let mut options = crate::ParserOptions::init(Default::default(), loader);
        options.features.no_macros = true;
        options.features.top_level_await = true;
        options.features.standard_decorators = !experimental_decorators;
        options.suppress_warnings_about_weird_code = true;
        options.tolerant = true;
        let define = crate::Define::default();
        let mut log = bun_ast::Log::init();
        let (file, awaited) = match crate::Parser::init(options, &mut log, &source, &define, arena)
        {
            Ok(parser) => parser.parse_for_sema(
                atoms,
                is_declaration_file,
                is_json,
                await_is_a_name,
                &parsing,
            ),
            Err(_) => (
                bun_sema::hir::File {
                    has_errors: true,
                    ..Default::default()
                },
                false,
            ),
        };
        // `parseSourceFileWorker`: only a file with an `ExternalModuleIndicator` has an [Await] context at its top level.
        let parse_again = awaited
            && !await_is_a_name
            && !every_file_is_a_module
            && !file.has_module_syntax
            && ![&b".mts"[..], b".cts", b".mjs", b".cjs"]
                .iter()
                .any(|e| path.ends_with(e))
            && !file
                .exprs
                .iter()
                .any(|e| matches!(e.kind, bun_sema::hir::ExprKind::ImportMeta));
        (file, parse_again)
    };
    // What a file leaves in the arena is garbage. The arena is reset after this much source, not
    // after every file.
    const SOURCE_AT_MOST: usize = 256 << 10;
    let mut file = ARENA.with_borrow_mut(|arena| {
        let (arena, parsed) = arena.get_or_insert_default();
        if *parsed >= SOURCE_AT_MOST {
            arena.reset();
            *parsed = 0;
        }
        *parsed += text.len();
        let (file, parse_again) = parse(false, arena);
        match parse_again {
            true => parse(true, arena).0,
            false => file,
        }
    });
    file.legacy_decorators = experimental_decorators;
    file.is_js = is_js;
    if is_json {
        file.kind = bun_sema::hir::FileKind::Json;
        file.has_module_syntax = true;
    }
    file.shrink_to_fit();
    file.finish_nodes();
    if is_json {
        bun_sema::json::validate_json(&mut file, text);
    }
    // A very large file would leave its capacity to every later file.
    if text.len() < 4 << 20 {
        builder::recycle(&mut file);
    }
    (file, parsing.get())
}

pub(crate) struct TypeSyntax<'a> {
    /// The parser's side notes about AST nodes.
    pub(crate) notes: notes::Notes,
    /// `hir::File::after_skipped`: for each token that `abort_list_or_skip` skipped, the position
    /// of the next token.
    pub(crate) after_skipped: Vec<Loc>,
    /// `hir::File::stray_decorators`: for each decorator that decorates nothing, the position of
    /// its expression and the start of the syntax after the decorators.
    pub(crate) stray_decorators: Vec<(Loc, Loc)>,
    /// `hir::File::unclosed_literals`: the opening bracket of an array or object literal whose
    /// closing bracket is missing, and the end of the token before the point where it was expected.
    pub(crate) unclosed_literals: Vec<(Loc, Loc)>,
    /// `f<T>` was just parsed: the type arguments, in `Notes::ranges`, and the position of the next
    /// token.
    pub(crate) pending_type_arguments: Option<(u32, Loc)>,
    /// Build type nodes instead of only recording where types are.
    pub(crate) save_types: bool,
    /// `withJSDoc`: tags are only processed in JavaScript files.
    pub(crate) has_jsdoc: bool,
    /// The file's HIR, which holds the nodes of the TypeScript syntax parsed so far.
    pub(crate) b: builder::Builder<'a>,
    /// `CommentTypes::created`, while the comments are parsed.
    pub(crate) comment_rows: Vec<(notes::Rows, notes::Rows)>,
    /// The most recently parsed type. `NONE` if there is no usable type.
    pub(crate) last_type: ts::TypeId,
    /// Position of the first token of the type `parse_and_keep_type` parsed last.
    pub(crate) last_type_start: i32,
    /// Shared stack for the members of unions, intersections and type argument lists that are still being parsed.
    pub(crate) type_stack: Vec<ts::TypeId>,
    /// Shared stack for the names in `typeof a.b.c`.
    pub(crate) name_stack: Vec<ts::Name>,
    /// The most recently parsed type arguments. `None` if unusable.
    pub(crate) last_type_args: Option<ts::Types>,
    /// The most recently parsed binding pattern. `NONE` if unusable.
    pub(crate) last_binding: ts::PatternId,
    /// The most recently parsed parameter list and the type of its `this` parameter. `None` if unusable.
    pub(crate) last_params: Option<ts::Params>,
    /// `new`, `abstract new` and type parameters that precede the `(` of the function type about to be parsed.
    pub(crate) pending_fn_type_head: Option<keep::FnTypeHead>,
    /// The most recently parsed type parameters. `None` if unusable.
    pub(crate) last_type_params: Option<ts::TypeParams>,
    /// The `{` about to be parsed opens the body of an interface, which cannot be a mapped type.
    pub(crate) next_braces_are_interface_body: bool,
    /// The body of the most recently parsed object type. `None` if unusable.
    pub(crate) last_object_type: Option<keep::ObjectTypeBody>,
    /// The index signature `parse_class_index_signature` parsed last.
    pub(crate) last_index_signature: Option<ts::Member>,
    /// The index signatures of classes, which become HIR nodes together with the other members of
    /// their class.
    pub(crate) class_index_signatures: Vec<bun_sema::hir::Member>,
    /// The TypeScript-only statement emitted while parsing the current statement. `NONE` if there is none.
    pub(crate) last_statement: ts::StatementId,
    /// The modifiers consumed so far, for the current statement and its enclosing statements.
    pub(crate) statement_modifiers: Vec<ts::Modifier>,
    /// Index in `statement_modifiers` where the modifiers of the current statement start.
    pub(crate) statement_modifiers_base: usize,
    /// The statements being parsed that start with `import` or `export`, the innermost last.
    pub(crate) module_syntax: Vec<parse_declarations::ModuleSyntax>,
}

impl<'a> TypeSyntax<'a> {
    pub(crate) fn new(b: builder::Builder<'a>) -> Self {
        TypeSyntax {
            notes: notes::Notes::take_recycled(),
            after_skipped: Vec::new(),
            stray_decorators: Vec::new(),
            unclosed_literals: Vec::new(),
            pending_type_arguments: None,
            save_types: true,
            has_jsdoc: false,
            b,
            comment_rows: Vec::new(),
            last_type: ts::TypeId::NONE,
            last_type_start: 0,
            type_stack: Vec::new(),
            name_stack: Vec::new(),
            last_type_args: None,
            last_binding: ts::PatternId::NONE,
            last_params: None,
            pending_fn_type_head: None,
            last_type_params: None,
            next_braces_are_interface_body: false,
            last_object_type: None,
            last_index_signature: None,
            class_index_signatures: Vec::new(),
            last_statement: ts::StatementId::NONE,
            statement_modifiers: Vec::new(),
            statement_modifiers_base: 0,
            module_syntax: Vec::new(),
        }
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    crate::P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    #[inline(always)]
    pub(crate) fn preserves_type_syntax(&self) -> bool {
        SEMA && self.type_syntax.is_some()
    }

    /// Whether syntax errors are recovered from as TypeScript's parser does. Always false in an ordinary build, at compile time.
    #[inline(always)]
    pub(crate) fn is_tolerant(&self) -> bool {
        SEMA && self.lexer.tolerant
    }

    /// `E::JSXElement::syntax`
    #[inline]
    pub(crate) fn keep_jsx(
        &mut self,
        closing_tag: Option<Expr>,
        opening_end: bun_ast::Loc,
        closing_start: bun_ast::Loc,
        end: bun_ast::Loc,
        type_arguments: ts::Types,
    ) -> bun_ast::ts_syntax::JsxId {
        match &mut self.type_syntax {
            Some(syntax) if SEMA => {
                let kept = syntax.b.ts.add_jsx(ts::Jsx {
                    closing_tag,
                    opening_end,
                    closing_start,
                    end,
                    type_arguments,
                });
                bun_ast::ts_syntax::JsxId(kept.index() as u32)
            }
            _ => bun_ast::ts_syntax::JsxId::NONE,
        }
    }

    /// Logs an error that TypeScript's checker reports with a plain `c.error` about syntax only the parser sees. Always reported.
    #[cold]
    #[inline(never)]
    pub(crate) fn ts_checker_error(&mut self, r: bun_ast::Range, code: u32) {
        if self.is_tolerant() && !self.lexer.is_log_disabled {
            self.log()
                .add_range_error_fmt(Some(self.source), r, format_args!("TC{code}"));
        }
    }

    /// `nodePos()`, taken at the first token of a node for `has_comments_before`. No value in files
    /// whose comments are not processed.
    #[inline]
    pub(crate) fn pos_for_jsdoc(&self) -> bun_ast::Loc {
        match &self.type_syntax {
            Some(syntax) if SEMA && syntax.has_jsdoc => self.lexer.full_start(),
            _ => bun_ast::Loc::EMPTY,
        }
    }

    /// Approximates `hasPrecedingJSDocComment`: whether comments precede the token at `token`,
    /// whose full start is `full_start`, in a file whose comments are processed.
    #[inline]
    pub(crate) fn has_comments_before(
        &self,
        token: bun_ast::Loc,
        full_start: bun_ast::Loc,
    ) -> bool {
        TYPESCRIPT
            && self
                .type_syntax
                .as_ref()
                .is_some_and(|syntax| syntax.has_jsdoc)
            && !full_start.is_empty()
            && self.lexer.has_comment_between(full_start, token)
    }
}
