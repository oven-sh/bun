//! Feeds `bun_sema`: keeps track of the type syntax the parser skips, and turns a parsed file into the summary the
//! type resolver works from.
//!
//! The parser has two modes for type syntax. By default it skips types. When [`TypeSyntax`] is present, the same code also builds
//! syntax-only `bun_ast::ts_syntax` nodes for them (see [`keep`]). The JavaScript AST is identical in both modes.
//! After the parse pass, where ordinary builds start the visit pass, [`lower`] walks the statements and clones them and the type syntax
//! ([`clone_types`]) into the type checker's tree.
//!
//! In JavaScript the types are in JSDoc comments. Before the lowering, [`jsdoc`] reads the tags of the comments the lexer recorded, and
//! has the parser read the types in them. During the lowering, [`reparse`] makes ordinary annotations, casts and declarations of the
//! tags of each comment that belongs to a node.

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

use bun_ast::ts_syntax as ts;
use bun_ast::{Expr, Loc};

/// What the parser says of a node that `bun_ast` has no place for (see [`notes`]). Of which node, and what the payload of the note is.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Mark {
    /// Of a binding, or of the name of a member of a class: its type (`ts::TypeId`).
    Annotation,
    /// Of the same: `?` follows it.
    Optional,
    /// Of the same: `!` follows it.
    Definite,
    /// Of the `(` of a function's parameters, or of an arrow function: the return type (`ts::TypeId`).
    ReturnType,
    /// Of the `(` of a function's parameters, of the `class` keyword, or of an arrow function: the type parameters
    /// (`ts::Span<ts::TypeParam>`, in `Notes::ranges`).
    TypeParameters,
    /// Of the `(` of a function's parameters: its `this` parameter (`ts::Id<ts::Param>`).
    ThisParameter,
    /// Of the `)` of a call, of a `new` expression or of an import call: the type arguments (`ts::IdList<ts::Type>`, in
    /// `Notes::ranges`).
    TypeArguments,
    /// Of the `)` of a call of `async`: the type arguments, which were read as type parameters (`ts::Span<ts::TypeParam>`, in
    /// `Notes::ranges`).
    TypeArgumentsReadAsParameters,
    /// Of a tagged template: the type arguments of its tag, like `TypeArguments`.
    TagTypeArguments,
    /// Of a tagged template: where its `` ` `` is.
    Backtick,
    /// Of a tagged template: its last piece of text is missing or unterminated (`callIsIncomplete`).
    IncompleteTemplate,
    /// Of the body of an arrow function (`G::FnBody::loc`): where its `=>` is. Of a body that is an expression only if the `=>` is
    /// missing: it is said to be at the `=>`.
    ArrowToken,
    /// Of the `class` keyword: the type arguments after the expression it extends, like `TypeArguments`.
    ExtendsArguments,
    /// Of the `class` keyword: an element of an `extends` clause that is not the first (`ts::Id<Expr>`). As many as there are.
    OtherExtends,
    /// Of the `class` keyword: an element of its first `implements` clause (`ts::TypeId`). As many as there are.
    Implements,
    /// Of the `class` keyword: an element of an `implements` clause that is not the first (`ts::TypeId`). As many as there are.
    OtherImplements,
    /// Of the `class` keyword: an index signature of the class (`ts::MemberId`). As many as there are.
    IndexSignature,
    /// Of the `class` keyword: where a `;` among its members is before which comments stand. As many as there are.
    SemicolonClassElement,
    /// Of the `class` keyword: `TokenFullStart` of each of those, in the same order.
    SemicolonFullStart,
    /// Of the name of a member of a class (the `{` of a static block), of an object literal or of a JSX attribute (the `e` of
    /// `{...e}`): where its first token is: a decorator, a modifier, `get`, `set`, `*`, `[`, `{`.
    MemberStart,
    /// Of the same: `TokenFullStart` of that token (`node.Pos()`). Of a member of an object literal only in JavaScript, if comments
    /// stand before it.
    MemberFullStart,
    /// Of the same, or of the `e` of `...e` in an object literal: where the last token of the member ends.
    MemberEnd,
    /// Of the name of a member of a class that is a string literal: where the token after it is.
    StringLiteralName,
    /// Of a member of an enum: which `hir::NameKind` its name is, if no identifier.
    NameKind,
    /// Of the `key` of the name `[key]` of a member or of a property in a pattern: where the `[` is. Of a member of an enum: the `key`
    /// that is neither a string nor a number (`ts::Id<Expr>`).
    ComputedName,
    /// Of the element that is left out of `[a, , b]`.
    OmittedExpression,
    /// Of a binding, or of the `e` of `...e` in an object literal: where the `...` before it is.
    DotDotDot,
    /// Of a statement, a class expression, or the name or pattern of a parameter: where its first token is: a decorator, a modifier,
    /// `...`, what stands where a name is missing.
    DeclarationStart,
    /// Of a statement, or of the name of a parameter or of a member of a class: its modifiers (`ts::Span<ts::Modifier>`, in
    /// `Notes::ranges`).
    Modifiers,
    /// Of the parameter of `x => x` before which comments stand: they are not its own (`parseSimpleArrowFunctionExpression`).
    SimpleArrowParameter,
    /// Of an expression statement: its first token is `(` (`hasParen`, `parseExpressionOrLabeledStatement`).
    HasParen,
    /// Of what `catch` binds: its initializer (`ts::Id<Expr>`).
    Initializer,
    /// Of the name of a module: it is a string (`parseAmbientExternalModuleDeclaration`).
    StringName,
    /// Of the name of a module: it is `global` (`NodeFlagsGlobalAugmentation`).
    GlobalName,
    /// Of the name of a module: `declare module "a";`.
    NoBody,
    /// Of where the `(` of a function's parameters was expected: where the token before ends (`createMissingList`).
    MissingParameters,
    /// Of the `(` of a function's parameters: where its `{` was expected. The body is a missing block (`parseBlock`).
    MissingBody,
    /// Of `import.defer(..)`: where its `)` is.
    DeferredImportClose,
    /// Of an import call: an argument after the second (`ts::Id<Expr>`). As many as there are.
    OtherArgument,
    /// Of `new.target`: what is written instead of `target`, as a string (`ts::Id<Expr>`).
    MetaPropertyName,
    /// Of the expression of a decorator: where its `@` is.
    AtSign,

    // What is made of an expression that is only the expression in the tree. In the order it is made: `(e) as T` is not `(e as T)`.
    /// `e as T`, `<T>e`: the type (`ts::TypeId`).
    As,
    /// `<T>(e)` that was read as the type parameters of an arrow function: those (`ts::Span<ts::TypeParam>`, in `Notes::ranges`).
    AsTypeParameter,
    /// The `As` or `AsTypeParameter` that is noted next is `<T>e`: where the `<` is.
    LessThan,
    /// `e satisfies T`: the type (`ts::TypeId`).
    Satisfies,
    /// `e!`
    NonNull,
    /// Where the `<` is of the `Instantiation` that is noted next.
    InstantiationStart,
    /// `e<T>` that nothing takes the type arguments of: those, like `TypeArguments`.
    Instantiation,
    /// Comments stand before the `(` of the `Paren` that is noted next: its `TokenFullStart`.
    ParenFullStart,
    /// `(e)`: where the `(` is.
    Paren,
}

impl Mark {
    /// Whether it makes a node of its own kind of an expression.
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
        .then(|| bun_core::strings::index_of_char_usize(text, b' '))
        .flatten();
    let token = match said {
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
    Some(bstr::BStr::new(token).to_string().into_boxed_str())
}

/// `hir::File::error_ends`, of the error the parser logged as `said`: its start, its code and its end. `None`: where it ends is read
/// off the source. `has_jsx`: `LanguageVariantJSX`.
pub(crate) fn error_end(
    said: &bun_ast::Data,
    source: &[u8],
    has_jsx: bool,
) -> Option<(u32, u32, u32)> {
    let location = said.location.as_ref()?;
    let (start, mut len) = (location.offset, location.length);
    let at = source.get(start..)?;
    let Some((code, 0)) = early_error(&said.text, at) else {
        return None;
    };
    // Those that are logged with the range `parseErrorAtCurrentToken` or `parseErrorAt` reports.
    if !matches!(
        code,
        1003 | 1005
            | 1068
            | 1109
            | 1128..=1140
            | 1144..=1146
            | 1161
            | 1179..=1181
            | 1185
            | 1436
            | 1441
            | 1442
            | 1478
            | 1490
            | 2499
            | 17014
    ) {
        return None;
    }
    match at {
        // `Scan` makes one token of `</`, unless the `/` starts a comment. This lexer makes two.
        [b'<', b'/', rest @ ..] if has_jsx && len == 1 && rest.first() != Some(&b'*') => len = 2,
        // `Scan` makes a token of `>` whatever follows. `reScanGreaterThanToken` is asked after an operand, where a token is missed.
        [b'>', b'>' | b'=', ..] if code != 1005 => len = len.min(1),
        _ => {}
    }
    Some((start as u32, code, (start + len) as u32))
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
        || starts(b"Cannot use ") && ends(b" declaration") && bun_core::strings::contains(text, b"\" with a")
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
        options.tolerant = true;
        let define = crate::Define::default();
        let mut log = bun_ast::Log::init();
        let (file, awaited) = match crate::Parser::init(options, &mut log, &source, &define, &arena)
        {
            Ok(parser) => {
                parser.parse_for_sema(atoms, is_declaration_file, await_is_a_name, &parsing)
            }
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
    let (mut file, parse_again) = parse(false);
    if parse_again {
        file = parse(true).0;
    }
    file.legacy_decorators = experimental_decorators;
    file.is_js = is_js;
    file.shrink_to_fit();
    file.finish_nodes();
    (file, parsing.get())
}

pub(crate) struct TypeSyntax {
    /// What is said of the nodes of the tree.
    pub(crate) notes: notes::Notes,
    /// `hir::File::after_skipped`: where the token after each token is that `abort_list_or_skip` skipped.
    pub(crate) after_skipped: Vec<Loc>,
    /// `hir::File::stray_decorators`: where the expression of each decorator is that decorates nothing, and where what comes after the
    /// decorators starts.
    pub(crate) stray_decorators: Vec<(Loc, Loc)>,
    /// `hir::File::unclosed_literals`: the bracket that opens an array or object literal whose closing bracket is missed, and where the
    /// token before the miss ends.
    pub(crate) unclosed_literals: Vec<(Loc, Loc)>,
    /// `f<T>` was just parsed: the type arguments, in `Notes::ranges`, and where the next token is.
    pub(crate) pending_type_arguments: Option<(u32, Loc)>,
    /// Build type nodes instead of only recording where types are.
    pub(crate) keep_types: bool,
    /// `withJSDoc`: only in JavaScript is anything made of the tags.
    pub(crate) has_jsdoc: bool,
    /// The TypeScript syntax nodes of the file.
    pub(crate) ast: ts::Syntax,
    /// The most recently parsed type. `NONE` if there is no usable type.
    pub(crate) last_type: ts::TypeId,
    /// Where the first token is of the type `parse_and_keep_type` read last.
    pub(crate) last_type_start: i32,
    /// Shared stack for the members of unions, intersections and type argument lists that are still being parsed.
    pub(crate) type_stack: Vec<ts::TypeId>,
    /// Shared stack for the names in `typeof a.b.c`.
    pub(crate) name_stack: Vec<ts::Name>,
    /// The most recently parsed type arguments. `None` if unusable.
    pub(crate) last_type_args: Option<ts::IdList<ts::Type>>,
    /// The most recently parsed binding pattern. `NONE` if unusable.
    pub(crate) last_binding: ts::PatternId,
    /// The most recently parsed parameter list and the type of its `this` parameter. `None` if unusable.
    pub(crate) last_params: Option<ts::Span<ts::Param>>,
    /// `new`, `abstract new` and type parameters that precede the `(` of the function type about to be parsed.
    pub(crate) pending_fn_type_head: Option<keep::FnTypeHead>,
    /// The most recently parsed type parameters. `None` if unusable.
    pub(crate) last_type_params: Option<ts::Span<ts::TypeParam>>,
    /// The `{` about to be parsed opens the body of an interface, which cannot be a mapped type.
    pub(crate) next_braces_are_interface_body: bool,
    /// The body of the most recently parsed object type. `None` if unusable.
    pub(crate) last_object_type: Option<keep::ObjectTypeBody>,
    /// The index signature `parse_class_index_signature` read last. `NONE` if there is none.
    pub(crate) last_index_signature: ts::MemberId,
    /// The TypeScript-only statement emitted while parsing the current statement. `NONE` if there is none.
    pub(crate) last_statement: ts::StatementId,
    /// The modifiers consumed so far, for the current statement and the statements around it.
    pub(crate) statement_modifiers: Vec<ts::Modifier>,
    /// Where the modifiers of the current statement start in `statement_modifiers`.
    pub(crate) statement_modifiers_base: usize,
    /// The statements being parsed that start with `import` or `export`, the innermost last.
    pub(crate) module_syntax: Vec<parse_declarations::ModuleSyntax>,
}

impl TypeSyntax {
    pub(crate) fn new() -> Self {
        TypeSyntax {
            notes: Default::default(),
            after_skipped: Vec::new(),
            stray_decorators: Vec::new(),
            unclosed_literals: Vec::new(),
            pending_type_arguments: None,
            keep_types: true,
            has_jsdoc: false,
            ast: ts::Syntax::new(),
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
            last_index_signature: ts::MemberId::NONE,
            last_statement: ts::StatementId::NONE,
            statement_modifiers: Vec::new(),
            statement_modifiers_base: 0,
            module_syntax: Vec::new(),
        }
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> crate::P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline(always)]
    pub(crate) fn keeps_type_syntax(&self) -> bool {
        TYPESCRIPT && self.type_syntax.is_some()
    }

    /// `E::JSXElement::syntax`
    #[inline]
    pub(crate) fn keep_jsx(
        &mut self,
        closing_tag: Option<Expr>,
        opening_end: bun_ast::Loc,
        closing_start: bun_ast::Loc,
        end: bun_ast::Loc,
        type_arguments: ts::IdList<ts::Type>,
    ) -> ts::JsxId {
        match &mut self.type_syntax {
            Some(syntax) if TYPESCRIPT => syntax.ast.add_jsx(ts::Jsx {
                closing_tag,
                opening_end,
                closing_start,
                end,
                type_arguments,
            }),
            _ => ts::JsxId::NONE,
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

    /// `nodePos()`, taken on the first token of a node for `has_comments_before`. Nothing where nothing is made of comments.
    #[inline]
    pub(crate) fn pos_for_jsdoc(&self) -> bun_ast::Loc {
        match &self.type_syntax {
            Some(syntax) if TYPESCRIPT && syntax.has_jsdoc => self.lexer.full_start(),
            _ => bun_ast::Loc::EMPTY,
        }
    }

    /// `hasPrecedingJSDocComment`, more or less: whether comments stand before the token at `token`, which fully starts at
    /// `full_start`, in a file in which something is made of them.
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
