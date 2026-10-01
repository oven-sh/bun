//! Feeds `bun_sema`: keeps track of the type syntax the parser skips, and turns a parsed file into the summary the
//! type resolver works from.
//!
//! The parser has two modes for type syntax. By default it skips types. When [`TypeSyntax`] is present, the same code also builds
//! syntax-only `bun_ast::ts_syntax` nodes for them (see [`keep`]). The JavaScript AST is identical in both modes.
//! After the parse pass, where ordinary builds start the visit pass, [`lower`] walks the statements and clones them and the type syntax
//! ([`clone_types`]) into the type checker's tree.
//! Statements and class members that the parser drops are still read from the source text by [`type_syntax::Builder`].
//!
//! In JavaScript the types are in JSDoc comments. Before the lowering, [`jsdoc`] reads the tags of the comments the lexer recorded, and
//! has the parser read the types in them. During the lowering, [`reparse`] makes ordinary annotations, casts and declarations of the
//! tags of each comment that belongs to a node.

pub(crate) mod clone_types;
pub(crate) mod jsdoc;
pub(crate) mod keep;
pub(crate) mod lower;
pub(crate) mod reparse;
pub(crate) mod type_syntax;

use bun_ast::ts_syntax as ts;
use bun_ast::{Expr, ExprData};

/// What is written at a place the parser skipped.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Mark {
    /// From a binding, to its type.
    Annotation,
    /// A binding followed by `?`.
    Optional,
    /// A binding followed by `!`.
    Definite,
    /// From the `(` of a function's parameters or the `=>` of an arrow function, to the return type or the `:` before it.
    ReturnType,
    /// From the token after `<T, U>`, to its `<`.
    TypeParameters,
    /// From the `(` of a function's parameters, to the type of its `this` parameter.
    ThisParameter,
    /// From the `)` of a call or the `new` of a `new` expression, to the `<` of its type arguments.
    TypeArguments,
    /// From a tagged template, to the `<` of the type arguments of its tag.
    TagTypeArguments,
    /// From where the body of an arrow function is said to be, to its `=>`.
    ArrowToken,
    /// From the `class` keyword, to the `<` after the expression it extends.
    ExtendsArguments,
    /// From the `class` keyword, to what follows `implements`.
    Implements,
    /// From the name of a class member (the `{` of a static block), to its first decorator or modifier.
    MemberStart,
    /// From the `class` keyword, to a member the parser dropped. As many as there are.
    DroppedMember,
    /// From the `with` keyword, to the token after its statement.
    WithEnd,
    /// From the `(` of a function's parameters, to the token where its `{` was expected: the body is a missing block (`parseBlock`).
    MissingBody,
    /// From a tagged template whose last piece of text is missing or unterminated, to itself (`callIsIncomplete`).
    IncompleteTemplate,
    /// From a token that `abort_list_or_skip` skipped, to the token after it.
    SkippedToken,
    /// From the `import` of `import.defer(..)`, to its `)`.
    DeferredImportClose,
    /// From a decorator that decorates nothing (`note_stray_decorators`), to where what comes after the decorators starts.
    StrayDecorator,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum CastKind {
    /// `e as T`, `<T>e`
    As,
    Satisfies,
    /// `e!`
    NonNull,
    /// `e<T>` that nothing takes the type arguments of. `to` is where the `<` is.
    Instantiation,
    /// `(e)`. `to` is where the `(` is; of `<T>(e)`, where the `<` is.
    Paren,
}

/// Which expression, when several start at the same place: `a`, `a.b` and `a.b()` do.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(crate) struct ExprKey {
    start: i32,
    tag: u8,
    /// Where the node is, for those that are somewhere. At most one of the others starts at any place.
    address: usize,
}

impl ExprKey {
    pub(crate) fn of(expr: &Expr) -> ExprKey {
        ExprKey {
            start: expr.loc.start,
            tag: expr.data.tag() as u8,
            address: address_of(&expr.data),
        }
    }
}

fn address_of(data: &ExprData) -> usize {
    macro_rules! address {
        ($($variant:ident),*) => {
            match data {
                $(ExprData::$variant(node) => core::ptr::from_ref(&**node).addr(),)*
                _ => 0,
            }
        };
    }
    address!(
        EArray,
        EUnary,
        EBinary,
        EClass,
        ENew,
        EFunction,
        ECall,
        EDot,
        EIndex,
        EArrow,
        EJsxElement,
        EObject,
        ESpread,
        ETemplate,
        ERegExp,
        EAwait,
        EYield,
        EIf,
        EImport,
        EBigInt,
        EString
    )
}

/// The code TypeScript has for what the parser says in `text`, having gone on to parse the rest as if nothing were the matter.
/// `0`: the checker finds out by itself. `None`: what was parsed cannot be relied on.
pub(crate) fn early_error(text: &[u8], at: &[u8]) -> Option<(u32, i32)> {
    // TypeScript points at the keyword, the parser past it.
    if text == b"\"await\" can only be used inside an \"async\" function" {
        return Some((1308, -6));
    }
    if text == b"Class constructor cannot be an async function" {
        return Some((1089, -6));
    }
    // `checkMethodDeclaration`: only of the word. The string is a name like any other.
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
    // `await` and `yield` as names: what is wrong with them depends on which it is.
    if text == b"Cannot use \"yield\" or \"await\" here." {
        return Some((if at.starts_with(b"await") { 1359 } else { 1212 }, 0));
    }
    // Said of the name of a class. `checkContextualIdentifier`: `await` is no reserved word of strict mode, what is wrong with it
    // depends on where it is. Of a class statement the parser points past the name, which is no place to say anything.
    if text == b"Cannot use \"await\" as an identifier here" {
        return Some((if at.starts_with(b"await") { 1359 } else { 0 }, 0));
    }
    early_error_in_place(text).map(|code| (code, 0))
}

/// `hir::File::error_arguments`, of an error the parser logged as `text`.
pub(crate) fn error_argument(text: &[u8]) -> Option<Box<str>> {
    // `Lexer::ts_error_about`
    let said = (text.starts_with(b"TS") || text.starts_with(b"TG"))
        .then(|| text.iter().position(|&b| b == b' '))
        .flatten();
    let token = match said {
        Some(space) => &text[space + 1..],
        // `Lexer::expected_string`: `Expected ";" but found "x"`
        None => {
            let rest = text.strip_prefix(b"Expected ")?;
            let end = rest.windows(11).position(|w| w == b" but found ")?;
            let token = &rest[..end];
            token
                .strip_prefix(b"\"")
                .and_then(|token| token.strip_suffix(b"\""))
                .unwrap_or(token)
        }
    };
    Some(String::from_utf8_lossy(token).into())
}

fn early_error_in_place(text: &[u8]) -> Option<u32> {
    // `Lexer::ts_error` (TS), `ts_grammar_error` (TG), `ts_checker_error` (TC): said in TypeScript's own terms to begin with.
    if let Some(code) = text
        .strip_prefix(b"TS")
        .or_else(|| text.strip_prefix(b"TG"))
        .or_else(|| text.strip_prefix(b"TC"))
    {
        // `Lexer::ts_error_about` goes on to say what.
        let digits = code.iter().take_while(|b| b.is_ascii_digit()).count();
        return std::str::from_utf8(&code[..digits]).ok()?.parse().ok();
    }
    let (starts, ends) = (|s: &[u8]| text.starts_with(s), |s: &[u8]| text.ends_with(s));
    let refused_name = text
        .strip_prefix(b"Cannot use ")
        .and_then(|rest| rest.strip_suffix(b" as an identifier here"));
    Some(
        if ends(b" has already been declared")
        || text == b"Cannot use a declaration in a single-statement context"
        || text == b"Unexpected \"super\""
        || text == b"Cannot use \"this\" here"
        || ends(b" loops must have a single declaration")
        || ends(b" loop variables cannot have an initializer")
        || (starts(b"Setter ") || starts(b"Getter ")) && (ends(b")") || ends(b" arguments"))
        // `checkContextualIdentifier`: the checker goes over every name by itself.
        || ends(b" is a reserved word and cannot be used in strict mode")
        // Said of the names imports are given, which `checkStrictModeEvalOrArguments` is not asked about.
        || matches!(refused_name, Some(b"eval" | b"\"eval\"" | b"arguments" | b"\"arguments\""))
        // `reportObviousDecoratorErrors`: the decorators are kept, and refused with all that cannot be decorated.
        || text == b"TypeScript does not allow decorators on class constructors"
        // `checkGrammarVariableDeclaration`: a pattern in a `using` declaration gets 1492 and nothing else.
        || text == b"This declaration must be initialized"
        // `ReScanSlashToken` reports nothing about flags while parsing. `checkGrammarRegularExpressionLiteral`: 1499 1500 1501 1502.
        || (starts(b"Invalid flag \"") || starts(b"Duplicate flag \"")) && ends(b" in regular expression")
        // The parser accepts any member name. `checkGrammarProperty`: 18006. `checkObjectTypeForDuplicateDeclarations`: 2699.
        || text == b"Invalid field name"
        || text == b"Invalid static method name \"prototype\""
        // `checkGrammarModifiers`: 1491 1495. `checkGrammarVariableDeclarationList`: 1545 1546.
        || starts(b"Cannot use ") && ends(b" declaration") && text.windows(8).any(|w| w == b"\" with a")
        // `checkContextualIdentifier`: 1212 1213 1214.
        || text == b"An generator function expression cannot be named \"yield\""
        // `checkDeleteExpression`: 18011.
        || starts(b"Deleting the private name ")
        // `checkGrammarParameterList`: 1048. `checkGrammarBindingElement`: 1186.
        || text == b"A rest argument cannot have a default initializer"
        {
            0
        } else if (starts(b"The constant ") || starts(b"The declaration "))
            && ends(b" must be initialized")
        {
            1155
        } else if ends(b" outside a generator function") {
            1163
        } else if text == b"Cannot use \"await\" outside an async function" {
            1103
        } else if text == b"\"await\" is only allowed in an \"async\" function" {
            1308
        } else if starts(b"An async function cannot be named ") {
            1359
        } else if text == b"A return statement cannot be used here" {
            18041
        } else if text == b"This constant must be initialized" {
            1182
        } else if refused_name.is_some() {
            1212
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
                .is_some_and(is_reserved_word)
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

/// `isReservedWord`
fn is_reserved_word(word: &[u8]) -> bool {
    matches!(
        word,
        b"break"
            | b"case"
            | b"catch"
            | b"class"
            | b"const"
            | b"continue"
            | b"debugger"
            | b"default"
            | b"delete"
            | b"do"
            | b"else"
            | b"enum"
            | b"export"
            | b"extends"
            | b"false"
            | b"finally"
            | b"for"
            | b"function"
            | b"if"
            | b"import"
            | b"in"
            | b"instanceof"
            | b"new"
            | b"null"
            | b"return"
            | b"super"
            | b"switch"
            | b"this"
            | b"throw"
            | b"true"
            | b"try"
            | b"typeof"
            | b"var"
            | b"void"
            | b"while"
            | b"with"
    )
}

/// What the type resolver needs of the TypeScript file `text` at `path`.
pub fn summarize(
    path: &[u8],
    text: &[u8],
    atoms: &bun_sema::atom::Interner,
    experimental_decorators: bool,
    every_file_is_a_module: bool,
) -> bun_sema::hir::File {
    // `GetDeclarationFileExtension`
    let base = &path[path
        .iter()
        .rposition(|&b| matches!(b, b'/' | b'\\'))
        .map_or(0, |i| i + 1)..];
    let is_declaration_file = base.ends_with(b".d.ts")
        || base.ends_with(b".d.mts")
        || base.ends_with(b".d.cts")
        || base.ends_with(b".ts") && base.windows(3).any(|w| w == b".d.");
    let is_js = [&b".js"[..], b".jsx", b".mjs", b".cjs"]
        .iter()
        .any(|e| path.ends_with(e));
    // `getLanguageVariant`: JSX is there in all JavaScript.
    let loader = if is_js || path.ends_with(b".tsx") {
        bun_ast::Loader::Tsx
    } else {
        bun_ast::Loader::Ts
    };
    // Parses the file once. Also returns whether it must be parsed again with `await` as a name at the top level.
    let parse = |await_is_a_name: bool| -> (bun_sema::hir::File, bool) {
        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(path, text);
        let mut options = crate::ParserOptions::init(Default::default(), loader);
        options.features.no_macros = true;
        options.features.top_level_await = true;
        options.features.standard_decorators = !experimental_decorators;
        options.suppress_warnings_about_weird_code = true;
        // BUN_SEMA_NOT_TOLERANT=1 runs the parser as ordinary builds do, to check that a change to tolerant mode leaves them alone.
        // Ordinary builds never parse declaration files, so those stay tolerant.
        let tolerant = is_declaration_file || std::env::var_os("BUN_SEMA_NOT_TOLERANT").is_none();
        options.tolerant = tolerant;
        let define = crate::Define::default();
        let mut log = bun_ast::Log::init();
        let (file, awaited) = match crate::Parser::init(options, &mut log, &source, &define, &arena)
        {
            Ok(parser) => parser.parse_for_sema(atoms, is_declaration_file, await_is_a_name),
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
            && tolerant
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
        if !parse_again
            && (file.has_errors
                || (!log.msgs.is_empty() && std::env::var_os("BUN_SEMA_TRACE_LOG").is_some()))
            && std::env::var_os("BUN_SEMA_TRACE_PARSE").is_some()
        {
            let why: Vec<String> = log
                .msgs
                .iter()
                .map(|m| {
                    format!(
                        "{}@{}",
                        String::from_utf8_lossy(&m.data.text),
                        m.data.location.as_ref().map_or(-1, |l| l.offset as i64)
                    )
                })
                .collect();
            // BUN_SEMA_TRACE_LOG=1: every file with a message, whatever becomes of it, for comparing what the parser itself logs.
            let kind = if std::env::var_os("BUN_SEMA_TRACE_LOG").is_some() {
                "RAW"
            } else if file.stmts.is_empty() {
                "FATAL"
            } else {
                "LOGGED"
            };
            eprintln!(
                "REJECTED {}\t{kind}\t{}",
                String::from_utf8_lossy(path),
                why.join("\t")
            );
        }
        (file, parse_again)
    };
    let (mut file, parse_again) = parse(false);
    if parse_again {
        file = parse(true).0;
    }
    file.legacy_decorators = experimental_decorators;
    file.is_js = is_js;
    file.check_directive = check_directive(text);
    if is_js || path.ends_with(b"x") {
        file.jsx_pragmas = bun_sema::hir::JsxPragmas::scan(text, atoms);
    }
    file.shrink_to_fit();
    file
}

/// `getCommentPragmas`, `extractPragmas`, for `ts-check` and `ts-nocheck`: looked for in the comments before the first token.
fn check_directive(text: &[u8]) -> Option<bool> {
    let line_end = |from: usize| {
        text[from..]
            .iter()
            .position(|&c| c == b'\n' || c == b'\r')
            .map_or(text.len(), |n| from + n)
    };
    let mut i = if text.starts_with(b"\xEF\xBB\xBF") {
        3
    } else {
        0
    };
    if text[i..].starts_with(b"#!") {
        i = line_end(i);
    }
    let mut found = None;
    loop {
        while text.get(i).is_some_and(u8::is_ascii_whitespace) {
            i += 1;
        }
        if text[i..].starts_with(b"//") {
            let end = line_end(i);
            let mut p = i + 2;
            if text.get(p) == Some(&b'/') {
                p += 1;
            }
            while p < end && matches!(text[p], b' ' | b'\t') {
                p += 1;
            }
            if p < end && text[p] == b'@' {
                let name = &text[p + 1..end];
                let name = &name[..name
                    .iter()
                    .position(|&c| !(c.is_ascii_alphabetic() || c == b'-'))
                    .unwrap_or(name.len())];
                if name.eq_ignore_ascii_case(b"ts-check") {
                    found = Some(true);
                } else if name.eq_ignore_ascii_case(b"ts-nocheck") {
                    found = Some(false);
                }
            }
            i = end;
        } else if text[i..].starts_with(b"/*") {
            match text[i + 2..].windows(2).position(|w| w == b"*/") {
                Some(n) => i += n + 4,
                None => return found,
            }
        } else {
            return found;
        }
    }
}

pub(crate) struct TypeSyntax {
    /// (from, what, to). Entries an abandoned attempt at parsing left behind are harmless: nothing asks for them, or the
    /// attempt that succeeded made the same ones.
    pub(crate) marks: Vec<(i32, Mark, i32)>,
    /// In the order they apply, parentheses among them: `(e) as T` is not `(e as T)`. `to` is where the type starts.
    pub(crate) casts: Vec<(ExprKey, CastKind, i32)>,
    /// `with { .. }` after a module specifier: where `with` is, and the attributes as an object literal.
    pub(crate) import_attributes: Vec<(i32, Expr)>,
    /// The module specifiers that are no string literals (`parseModuleSpecifier`).
    pub(crate) specifier_expressions: Vec<Expr>,
    /// The `<` of a JSX element, and the name in its closing tag. The element's `tag` is then the name in its opening tag.
    pub(crate) closing_tags: Vec<(i32, Expr)>,
    /// `f<T>` was just parsed: where the `<` is, and where the next token starts.
    pub(crate) pending_type_arguments: (i32, i32),
    /// Build type nodes instead of only recording where types are.
    pub(crate) keep_types: bool,
    /// The TypeScript syntax nodes of the file.
    pub(crate) ast: ts::Syntax,
    /// Finished nodes, keyed by start offset.
    pub(crate) by_offset: keep::KeptNodes,
    /// The most recently parsed type. `NONE` if there is no usable type.
    pub(crate) last_type: ts::TypeId,
    /// Shared stack for the members of unions, intersections and type argument lists that are still being parsed.
    pub(crate) type_stack: Vec<ts::TypeId>,
    /// Shared stack for the names in `typeof a.b.c`.
    pub(crate) name_stack: Vec<ts::Name>,
    /// The most recently parsed type arguments. `None` if unusable.
    pub(crate) last_type_args: Option<ts::IdList<ts::Type>>,
    /// The most recently parsed binding pattern. `NONE` if unusable.
    pub(crate) last_binding: ts::PatternId,
    /// The most recently parsed parameter list and the type of its `this` parameter. `None` if unusable.
    pub(crate) last_params: Option<(ts::Span<ts::Param>, ts::TypeId)>,
    /// `new`, `abstract new` and type parameters that precede the `(` of the function type about to be parsed.
    pub(crate) pending_fn_type_head: Option<keep::FnTypeHead>,
    /// The most recently parsed type parameters. `None` if unusable.
    pub(crate) last_type_params: Option<ts::Span<ts::TypeParam>>,
    /// The `{` about to be parsed opens the body of an interface, which cannot be a mapped type.
    pub(crate) next_braces_are_interface_body: bool,
    /// The body of the most recently parsed object type. `None` if unusable.
    pub(crate) last_object_type: Option<keep::ObjectTypeBody>,
    /// The TypeScript-only statement emitted while parsing the current statement. `NONE` if there is none.
    pub(crate) last_statement: ts::StatementId,
    /// `export`, `default` and `declare` consumed so far, for the current statement and the statements around it.
    pub(crate) statement_modifiers: Vec<ts::Modifier>,
    /// Where the modifiers of the current statement start in `statement_modifiers`.
    pub(crate) statement_modifiers_base: usize,
    /// Statements other than declarations that were parsed in an ambient context: (start, start of the next token, statement).
    pub(crate) ambient_statements: Vec<(i32, i32, bun_ast::Stmt)>,
    /// Initializers of variables declared in an ambient context: (start of the binding, initializer).
    pub(crate) ambient_initializers: Vec<(i32, Expr)>,
}

impl TypeSyntax {
    pub(crate) fn new() -> Self {
        TypeSyntax {
            marks: Vec::new(),
            casts: Vec::new(),
            import_attributes: Vec::new(),
            specifier_expressions: Vec::new(),
            closing_tags: Vec::new(),
            pending_type_arguments: (0, 0),
            // BUN_SEMA_KEEP=0 runs the parser in skip mode, as ordinary builds do, to check what it accepts and reports. No types result.
            keep_types: std::env::var_os("BUN_SEMA_KEEP").is_none_or(|v| v != "0"),
            ast: ts::Syntax::new(),
            by_offset: Default::default(),
            last_type: ts::TypeId::NONE,
            type_stack: Vec::new(),
            name_stack: Vec::new(),
            last_type_args: None,
            last_binding: ts::PatternId::NONE,
            last_params: None,
            pending_fn_type_head: None,
            last_type_params: None,
            next_braces_are_interface_body: false,
            last_object_type: None,
            last_statement: ts::StatementId::NONE,
            statement_modifiers: Vec::new(),
            statement_modifiers_base: 0,
            ambient_statements: Vec::new(),
            ambient_initializers: Vec::new(),
        }
    }
}

/// Debug counters: [type lookups by the lowering that found a node, lookups that found none].
pub static KEPT: [std::sync::atomic::AtomicU64; 2] = [
    std::sync::atomic::AtomicU64::new(0),
    std::sync::atomic::AtomicU64::new(0),
];

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> crate::P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline(always)]
    pub(crate) fn keeps_type_syntax(&self) -> bool {
        TYPESCRIPT && self.type_syntax.is_some()
    }

    #[inline]
    pub(crate) fn mark_type_syntax(&mut self, from: bun_ast::Loc, what: Mark, to: bun_ast::Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.marks.push((from.start, what, to.start));
        }
    }

    /// `stmt` starts at `start` and was parsed in an ambient context, and the lexer is at what follows. The caller drops it, but
    /// TypeScript checks it like any other (`checkGrammarStatementInAmbientContext`, `checkAmbientInitializer`).
    #[cold]
    #[inline(never)]
    pub(crate) fn note_ambient_statement(&mut self, start: bun_ast::Loc, stmt: &bun_ast::Stmt) {
        use bun_ast::stmt::Data;
        let end = self.lexer.loc().start;
        let Some(syntax) = &mut self.type_syntax else {
            return;
        };
        match &stmt.data {
            Data::SLocal(local) => {
                for decl in local.decls.iter() {
                    if let Some(value) = decl.value {
                        syntax
                            .ambient_initializers
                            .push((decl.binding.loc.start, value));
                    }
                }
            }
            Data::SBlock(_)
            | Data::SBreak(_)
            | Data::SContinue(_)
            | Data::SDoWhile(_)
            | Data::SExpr(_)
            | Data::SForIn(_)
            | Data::SForOf(_)
            | Data::SFor(_)
            | Data::SIf(_)
            | Data::SLabel(_)
            | Data::SReturn(_)
            | Data::SSwitch(_)
            | Data::SThrow(_)
            | Data::STry(_)
            | Data::SWhile(_)
            | Data::SWith(_) => syntax.ambient_statements.push((start.start, end, *stmt)),
            _ => {}
        }
    }

    /// Logs an error that TypeScript's checker reports through `grammarErrorOnNode`. Dropped if the file has syntax errors.
    /// Same message as `Lexer::ts_grammar_error`. Does nothing outside tolerant mode or during a speculative parse.
    #[cold]
    #[inline(never)]
    pub(crate) fn ts_grammar_error(&mut self, loc: bun_ast::Loc, code: u32) {
        if self.lexer.tolerant && !self.lexer.is_log_disabled {
            self.log()
                .add_error_fmt(Some(self.source), loc, format_args!("TG{code}"));
        }
    }

    /// Logs an error that TypeScript's checker reports with a plain `c.error` about syntax only the parser sees. Always reported.
    #[cold]
    #[inline(never)]
    pub(crate) fn ts_checker_error(&mut self, loc: bun_ast::Loc, code: u32) {
        if self.lexer.tolerant && !self.lexer.is_log_disabled {
            self.log()
                .add_error_fmt(Some(self.source), loc, format_args!("TC{code}"));
        }
    }

    /// `operand<T>` was parsed, and the lexer is at what follows. An instantiation expression, unless the type arguments are taken.
    #[inline]
    pub(crate) fn note_type_arguments(&mut self, operand: &Expr, less_than: bun_ast::Loc) {
        let next = self.lexer.loc().start;
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.pending_type_arguments = (less_than.start, next);
            syntax.casts.push((
                ExprKey::of(operand),
                CastKind::Instantiation,
                less_than.start,
            ));
        }
    }

    /// The `<` of the type arguments that end right before the current token, for the call, `new` or tagged template that has them.
    #[inline]
    pub(crate) fn take_type_arguments(&mut self) -> Option<bun_ast::Loc> {
        let here = self.lexer.loc().start;
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && syntax.pending_type_arguments.1 == here
        {
            syntax.pending_type_arguments.1 = -1;
            let less_than = syntax.pending_type_arguments.0;
            // Nothing was parsed since they were noted.
            if matches!(syntax.casts.last(), Some(&(_, CastKind::Instantiation, at)) if at == less_than)
            {
                syntax.casts.pop();
            }
            return Some(bun_ast::Loc { start: less_than });
        }
        None
    }

    #[inline]
    pub(crate) fn mark_paren(&mut self, inside: &Expr, open: bun_ast::Loc) {
        self.mark_cast(inside, CastKind::Paren, open);
    }

    /// Notes the name in the closing tag of the JSX element whose `<` is at `element`. The caller keeps the opening name as its `tag`.
    #[inline]
    pub(crate) fn mark_closing_tag(&mut self, element: bun_ast::Loc, tag: Option<Expr>) {
        if TYPESCRIPT
            && let Some(syntax) = &mut self.type_syntax
            && let Some(tag) = tag
        {
            syntax.closing_tags.push((element.start, tag));
        }
    }

    #[inline]
    pub(crate) fn mark_cast(&mut self, operand: &Expr, kind: CastKind, ty: bun_ast::Loc) {
        if TYPESCRIPT && let Some(syntax) = &mut self.type_syntax {
            syntax.casts.push((ExprKey::of(operand), kind, ty.start));
        }
    }
}
