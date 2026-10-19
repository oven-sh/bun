//! JavaScript and TypeScript in HTML: Prettier's `textToDoc` for the parsers of `language-js`.
//!
//! The code is parsed separately, and the JavaScript formatter writes it into the same document as the HTML, so its
//! line breaks depend on where it is.

use super::map_strings::{MapString, write_mapped};
use crate::ir::element::{Interned, TextWidth};
use crate::js::ast_nodes::node_as_ast_nodes;
use crate::js::comments::{self, NO_COMMENTS};
use crate::js::context::JsFormatContext;
use crate::js::print::program::{FormatStatements, write_hashbang};
use crate::js::sort_imports::{SortImports, sorted_text};
use crate::js::utils::tailwindcss::{Collapse, Texts, collapse_among, ends_in_template};
use crate::options::{Code, Flavor, HtmlRoot, InHtml, JavaScriptParser, ParseJavaScript, Then};
use crate::prelude::*;
use crate::tailwind::{Tailwind, Tidies};
use crate::{format_args, write};
use bun_core::strings;
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::linter::{TypesInJavaScript, rejected_by_prettier_with};

/// Prettier's parsers for programs.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Syntax {
    /// `babel`: JavaScript with JSX.
    Babel,
    /// `babel-ts`: TypeScript, with JSX if it parses that way.
    BabelTs,
    /// `typescript`, for a file whose name doesn't tell whether it has JSX.
    TypeScript,
    /// Only TypeScript without JSX, which is how oxfmt parses the scripts of a Vue file.
    Ts,
    /// Only TypeScript with JSX, which is how oxfmt parses them if one has `lang="tsx"`.
    Tsx,
}

/// `sourceType`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum SourceType {
    Script,
    Module,
    /// Try a module first, then a script.
    Unknown,
}

/// The name of a file whose text is `(`, an expression and `)`. See `AstNodes::parent`.
pub(crate) const EXPRESSION_JSX: &[u8] = b"\0.jsx";
pub(crate) const EXPRESSION_TS: &[u8] = b"\0.ts";
pub(crate) const EXPRESSION_TSX: &[u8] = b"\0.tsx";

/// Prettier's `isProbablyJsx`: `/(?:^[^"'`]*<\/|^[^/]{2}.*\/>)/m`
pub fn is_probably_jsx(text: &[u8]) -> bool {
    // `</` with no quote between it and the start of its line.
    let mut rest = if strings::contains(text, b"</") {
        text
    } else {
        b""
    };
    let mut is_after_quote = false;
    while let Some(at) = strings::index_of_any(rest, b"\"'`\n<") {
        match rest[at] {
            b'\n' => is_after_quote = false,
            b'<' if is_after_quote || rest.get(at + 1) != Some(&b'/') => {}
            b'<' => return true,
            _ => is_after_quote = true,
        }
        rest = &rest[at + 1..];
    }
    strings::split(text, b"\n").any(|line| {
        line.len() >= 4
            && line[0] != b'/'
            && line[1] != b'/'
            && strings::contains(&line[2..], b"/>")
    })
}

/// Returns the options for code embedded in HTML that's formatted with `options`.
pub(crate) fn options_in_html(options: &FormatOptions, in_html: InHtml) -> FormatOptions {
    FormatOptions {
        // In an attribute, double quotes would have to be written as entities.
        quote_style: if in_html.is_in_attribute || in_html.has_single_quotes {
            QuoteStyle::Single
        } else {
            options.quote_style
        },
        in_html: InHtml {
            quote_style: options.quote_style,
            ..in_html
        },
        parser: None,
        filepath: None,
        range_start: None,
        range_end: None,
        cursor_offset: None,
        insert_pragma: false,
        require_pragma: false,
        check_ignore_pragma: false,
        is_in_markdown: false,
        is_mdx_jsx: false,
        is_mdx_es_syntax: false,
        sort_imports: None,
        jsdoc: None,
        ..options.clone()
    }
}

/// A way to parse code.
#[derive(Copy, Clone)]
pub(crate) enum Parse<'p> {
    Function(ParseJavaScript),
    Closure(JavaScriptParser<'p>),
}

impl<'p> Parse<'p> {
    /// Uses `parse`, or else the parser in `options`.
    pub(crate) fn new(
        parse: Option<JavaScriptParser<'p>>,
        options: &FormatOptions,
    ) -> Option<Parse<'p>> {
        match parse {
            Some(parse) => Some(Parse::Closure(parse)),
            None => options.parse_javascript.map(Parse::Function),
        }
    }

    /// Returns the parser for the code in the HTML that `f` writes.
    fn from_formatter(f: &Formatter<'p>) -> Option<Parse<'p>> {
        Parse::new(f.context().parse_javascript, f.options())
    }

    pub(crate) fn call(self, path: &[u8], text: &[u8], is_script: bool, then: Then<'_>) {
        let code = Code {
            path,
            text,
            is_script,
        };
        match self {
            Parse::Function(parse) => parse(code, then),
            Parse::Closure(parse) => parse(code, then),
        }
    }
}

pub(crate) type Write<'w> = &'w mut dyn for<'b> FnMut(&'b File<'b>, &mut Formatter<'b>) -> bool;

/// The kind of a piece of code.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Piece {
    /// The whole contents of a `<script>`, and the flavor to format it in. Import sorting and JSDoc rewriting treat it
    /// as a file.
    Script(Flavor),
    /// The parameters of a function or a type, and the flavor to format them in.
    Binding(Flavor),
    Other,
}

/// The outcome of parsing code one way.
enum Attempt {
    /// It doesn't parse that way.
    ParseFailed,
    /// Nothing has been written. Parse this text instead.
    Sorted(Vec<u8>),
    /// The return value of `write`.
    Written(bool),
}

/// Parses `code` as the file at each of `paths` until one has no errors, then calls `write` with that file and a
/// formatter that continues `f`'s document. Returns what `write` returns, or `false`, with nothing written, if `code`
/// doesn't parse.
pub(crate) fn with_file(
    f: &mut Formatter<'_>,
    code: &[u8],
    paths: &[&[u8]],
    source_type: SourceType,
    in_html: InHtml,
    piece: Piece,
    write: Write<'_>,
) -> bool {
    let Some(parse) = Parse::from_formatter(f) else {
        return false;
    };
    let mut options = options_in_html(f.options(), in_html);
    // In Prettier the file name is still the HTML file's, so `<T,>() => {}` keeps its comma because the name isn't
    // `.ts`. oxfmt prints a script like a separate file.
    if !matches!(piece, Piece::Script(flavor) | Piece::Binding(flavor) if flavor.is_oxfmt()) {
        options.filepath.clone_from(&f.options().filepath);
    }
    // The class-sorting plugin only replaces the parsers for programs and `__js_expression`. oxfmt formats bindings
    // itself and doesn't sort classes there.
    let sorts_classes = match (piece, in_html.root) {
        (Piece::Binding(_), _) => (options.tailwind.as_deref()).is_some_and(|it| it.follows_plugin),
        (_, HtmlRoot::Program) => true,
        (_, HtmlRoot::JsExpression) => paths == [EXPRESSION_JSX],
        _ => false,
    };
    if !sorts_classes {
        options.tailwind = None;
    }
    if let Piece::Binding(flavor) = piece {
        options.flavor = flavor;
    }
    // Prettier's plugins sort the imports in the text before it's parsed.
    let mut sorts_text = None;
    if let Piece::Script(flavor) = piece {
        options.flavor = flavor;
        options.jsdoc = f.options().jsdoc;
        match f.options().sort_imports.clone() {
            Some(how) if how.is_applied_by_format() => {
                (options.sort_imports, sorts_text) = (Some(std::sync::Arc::clone(&how)), Some(how));
            }
            how => sorts_text = how,
        }
    }
    let kinds: &[bool] = match source_type {
        SourceType::Script => &[true],
        SourceType::Module => &[false],
        SourceType::Unknown => &[false, true],
    };
    for path in paths {
        for &is_script in kinds {
            let mut attempt = |code: &[u8], sorts_text: Option<&SortImports>| {
                let mut result = Attempt::ParseFailed;
                parse.call(path, code, is_script, &mut |file| {
                    if file.has_parse_errors()
                        || rejected_by_prettier_with(file, TypesInJavaScript::Rejected)
                    {
                        return;
                    }
                    let comments = comments::for_file(file, &options);
                    // Babel only treats `<!--` and `-->` as comments in code that's known to be a script.
                    let is_html_like = |comment: Comment<'_>| {
                        matches!(
                            file.text().get(comment.span().start as usize),
                            Some(b'<' | b'-')
                        )
                    };
                    if source_type != SourceType::Script && file.comments_by_id().any(is_html_like)
                    {
                        return;
                    }
                    if let Some(sorted) = sorts_text.and_then(|how| sorted_text(file, how)) {
                        result = Attempt::Sorted(sorted);
                        return;
                    }
                    let context = JsFormatContext::new(file, options.clone(), comments);
                    let is_written = match file.comment_count() {
                        0 => f.write_embedded(context, file.text(), |f| write(file, f)),
                        // Prettier's `ensureAllCommentsPrinted`. It throws, so the code is left as written:
                        // `v-slot="/* comment */"`
                        _ => f.try_write_embedded(context, file.text(), |f| {
                            write(file, f) && f.comments().unprinted().next().is_none()
                        }),
                    };
                    result = Attempt::Written(is_written);
                });
                result
            };
            let result = match attempt(code, sorts_text.as_deref()) {
                Attempt::Sorted(sorted) => attempt(&sorted, None),
                result => result,
            };
            if let Attempt::Written(is_written) = result {
                return is_written;
            }
        }
    }
    false
}

/// Returns `code`, the whole contents of a `<script>`, with its imports sorted. Returns `None` if nothing changes or it
/// doesn't parse.
pub(crate) fn sorted_script(parse: Parse<'_>, code: &[u8], how: &SortImports) -> Option<Vec<u8>> {
    for path in [&b"dummy.tsx"[..], b"dummy.ts", b"dummy.jsx"] {
        let mut sorted = None;
        parse.call(path, code, false, &mut |file| {
            if !file.has_parse_errors() {
                sorted = Some(sorted_text(file, how));
            }
        });
        if let Some(sorted) = sorted {
            return sorted;
        }
    }
    None
}

/// The language around an expression with classes.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Host {
    Vue,
    Angular,
    Svelte,
}

/// Finds the strings and templates in a program and sorts the classes in them.
struct ClassSorter<'t, 'a> {
    tailwind: &'t Tailwind,
    host: Host,
    /// Every `+` and template around the current node, outermost first.
    enclosing: Vec<Expr<'a>>,
    /// Replacements, as a span and its new text, in source order.
    changes: Vec<(Span, Vec<u8>)>,
}

impl ClassSorter<'_, '_> {
    /// Returns how to sort the texts of the template or string at `whole`.
    fn how(&self, whole: Span) -> (Collapse, Tidies) {
        let among = |rules| collapse_among(&self.enclosing, whole, self.tailwind, rules);
        match self.host {
            Host::Angular => (among((true, Texts::Unsorted)), self.tailwind.tidies()),
            Host::Vue => (among((false, Texts::Unseen)), self.tailwind.tidies()),
            // `removeDuplicates: false, collapseWhitespace: false`
            Host::Svelte => (
                Collapse::ALL,
                Tidies {
                    collapses_white_space: false,
                    removes_duplicates: false,
                },
            ),
        }
    }

    /// `texts` has the texts of the template at `whole`, or the contents of the string there, each with its span.
    fn sort<'s>(&mut self, whole: Span, texts: impl ExactSizeIterator<Item = (&'s [u8], Span)>) {
        let (collapse, tidies) = self.how(whole);
        let count = texts.len();
        for (index, (text, span)) in texts.enumerate() {
            let ends = ends_in_template(text, (index == 0, index + 1 == count), collapse);
            let sorted = self.tailwind.sorted_with(text, ends, tidies);
            if *sorted != *text {
                self.changes.push((span, sorted.into_owned()));
            }
        }
    }

    /// `span` covers a string with its quotes, or a template without substitutions.
    fn sort_literal(&mut self, file: &File<'_>, span: Span) {
        if let [b'"' | b'\'' | b'`', content @ .., _] = file.slice(span) {
            let inner = Span::new(span.start + 1, span.end - 1);
            self.sort(span, std::iter::once((content, inner)));
        }
    }
}

fn is_concatenation(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::Template(_) | ExprKind::Binary { op: BinOp::Add, .. }
    )
}

impl<'a> Visitor<'a> for ClassSorter<'_, 'a> {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Expr(e) => {
                match e.kind() {
                    ExprKind::String(_) if !e.is_jsx_text() => {
                        self.sort_literal(e.file(), e.span())
                    }
                    ExprKind::Template(template) => {
                        let count = template.quasi_count();
                        let text = |index: usize| {
                            let span = template.quasi_span(index);
                            let end = span.end - if index + 1 == count { 1 } else { 2 };
                            (template.raw(index), Span::new(span.start + 1, end))
                        };
                        self.sort(e.span(), (0..count).map(text));
                    }
                    _ => {}
                }
                if is_concatenation(e) {
                    self.enclosing.push(e);
                }
            }
            Node::Prop(property) => {
                if let Some(key) = property.key()
                    && matches!(key.kind(), KeyKind::String(_) | KeyKind::ComputedString(_))
                {
                    let file = property.file();
                    self.sort_literal(file, key.inner_span(file));
                }
            }
            _ => {}
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        if matches!(node, Node::Expr(e) if is_concatenation(e)) {
            self.enclosing.pop();
        }
    }
}

/// Does what `prettier-plugin-tailwindcss` does to `code`, an expression in a Vue or Angular attribute:
/// `transformDynamicJsAttribute`, `transformDynamicAngularAttribute`. Returns `None` if nothing changes or it doesn't
/// parse.
pub(crate) fn with_sorted_classes(
    parse: Parse<'_>,
    code: &[u8],
    tailwind: &Tailwind,
    is_angular: bool,
) -> Option<Vec<u8>> {
    const BEFORE: &[u8] = b"let __prettier_temp__ = ";
    let source = [BEFORE, code].concat();
    let mut changes = None;
    for path in paths_of(Syntax::BabelTs, code) {
        parse.call(path, &source, false, &mut |file| {
            if !file.has_parse_errors() {
                let mut sorter = ClassSorter {
                    tailwind,
                    host: match is_angular {
                        true => Host::Angular,
                        false => Host::Vue,
                    },
                    enclosing: Vec::new(),
                    changes: Vec::new(),
                };
                walk(file, &mut sorter);
                changes = Some(sorter.changes);
            }
        });
        if changes.is_some() {
            break;
        }
    }
    let mut changes = changes.filter(|it| !it.is_empty())?;
    // A template's texts are visited before the expressions between them.
    crate::sort::sort_by_key(&mut changes[..], |it| it.0.start);
    let (mut sorted, mut from) = (Vec::with_capacity(code.len()), BEFORE.len());
    for (span, text) in changes {
        sorted.extend_from_slice(source.get(from..span.start as usize)?);
        sorted.extend_from_slice(&text);
        from = span.end as usize;
    }
    sorted.extend_from_slice(source.get(from..)?);
    Some(sorted)
}

/// Returns the replacements for `file`, the expression in the braces of a Svelte class attribute. The plugin's
/// `transformSvelte` sorts all its strings and templates, and changes nothing else about them.
pub(crate) fn sorted_in_svelte<'a>(
    file: &'a File<'a>,
    tailwind: &Tailwind,
) -> Vec<(Span, Vec<u8>)> {
    if file.has_parse_errors() {
        return Vec::new();
    }
    let mut sorter = ClassSorter {
        tailwind,
        host: Host::Svelte,
        enclosing: Vec::new(),
        changes: Vec::new(),
    };
    walk(file, &mut sorter);
    sorter.changes
}

pub(crate) fn paths_of(syntax: Syntax, code: &[u8]) -> &'static [&'static [u8]] {
    match syntax {
        Syntax::Babel => &[b"dummy.jsx"],
        Syntax::BabelTs => &[b"dummy.tsx", b"dummy.ts"],
        Syntax::TypeScript => match is_probably_jsx(code) {
            true => &[b"dummy.tsx", b"dummy.ts"],
            false => &[b"dummy.ts", b"dummy.tsx"],
        },
        Syntax::Ts => &[b"dummy.ts"],
        Syntax::Tsx => &[b"dummy.tsx"],
    }
}

/// Writes what Prettier prints for a `Program`, without the final line break.
fn write_statements<'b>(file: &'b File<'b>, f: &mut Formatter<'b>) {
    let program = node_as_ast_nodes(Node::File(file));
    let owned = f.comments().of_node(program);
    let has_statements = (file.body().iter()).any(|it| !matches!(it.kind(), StmtKind::Empty));
    let is_hashbang_last = !has_statements && owned.leading.is_empty() && owned.dangling.is_empty();
    write_hashbang(is_hashbang_last, f);
    // The program only owns comments if there's no statement to attach them to.
    write!(
        f,
        [
            leading_comments(program),
            FormatStatements(file.body()),
            dangling_comments(program)
        ]
    );
}

/// `textToDoc(code, { parser })` for a program. `flavor` is the flavor to format it in. Returns true if it was written.
pub(crate) fn write_program(
    f: &mut Formatter<'_>,
    code: &[u8],
    syntax: Syntax,
    source_type: SourceType,
    in_html: InHtml,
    flavor: Flavor,
) -> bool {
    with_file(
        f,
        code,
        paths_of(syntax, code),
        source_type,
        in_html,
        Piece::Script(flavor),
        &mut |file, f| {
            write_statements(file, f);
            true
        },
    )
}

/// The wrapper that `formatAttributeValue` puts around the document.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Hug {
    /// `group(doc)`
    Always,
    /// `printExpand(doc)`
    Never,
    /// `shouldHugJsExpression`
    Expression,
    /// Nothing, because `textToDoc` is called directly.
    Bare,
}

/// `shouldHugJsExpression`, for the node in the root.
fn should_hug_js_expression(e: Expr<'_>, root: HtmlRoot) -> bool {
    match e.as_ast_nodes() {
        AstNodes::ObjectExpression(_) | AstNodes::ArrayExpression(_) => true,
        AstNodes::TemplateLiteral(_) | AstNodes::StringLiteral(_) => {
            matches!(
                root,
                HtmlRoot::VueExpression | HtmlRoot::NgBinding | HtmlRoot::NgDirective
            )
        }
        _ => false,
    }
}

impl Hug {
    /// Returns whether `formatAttributeValue` hugs a root that contains `e`, or `None` if it isn't called.
    fn should_hug_expression(self, e: Expr<'_>, root: HtmlRoot) -> Option<bool> {
        match self {
            Hug::Expression => Some(should_hug_js_expression(e, root)),
            _ => self.should_hug_non_expression(),
        }
    }

    /// The same, for a root that `shouldHugJsExpression` rejects.
    pub(crate) fn should_hug_non_expression(self) -> Option<bool> {
        match self {
            Hug::Always => Some(true),
            Hug::Never | Hug::Expression => Some(false),
            Hug::Bare => None,
        }
    }
}

/// Writes `content` wrapped the way `formatAttributeValue` does.
pub(crate) fn write_hugged<'b>(
    should_hug: Option<bool>,
    content: &impl Format<'b>,
    f: &mut Formatter<'b>,
) {
    match should_hug {
        None => write!(f, content),
        Some(true) => write!(f, group(content)),
        Some(false) => write!(
            f,
            [
                indent(&format_args!(soft_line_break(), content)),
                soft_line_break()
            ]
        ),
    }
}

/// Returns the expression in `file` if its text is `(`, an expression, a line break and `)`.
pub(crate) fn expression_of<'b>(file: &'b File<'b>) -> Option<Expr<'b>> {
    let mut statements = file.body().iter();
    let (Some(statement), None) = (statements.next(), statements.next()) else {
        return None;
    };
    let StmtKind::Expr(e) = statement.kind() else {
        return None;
    };
    let outer = e.outer_span();
    (e.span().start > 0 && outer.start == 0 && outer.end as usize == file.text().len()).then_some(e)
}

/// Words that can't be identifiers, or only in some places.
fn is_reserved_word(name: &[u8]) -> bool {
    matches!(
        name,
        b"arguments"
            | b"async"
            | b"await"
            | b"break"
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
            | b"eval"
            | b"export"
            | b"extends"
            | b"false"
            | b"finally"
            | b"for"
            | b"function"
            | b"if"
            | b"implements"
            | b"import"
            | b"in"
            | b"instanceof"
            | b"interface"
            | b"let"
            | b"new"
            | b"null"
            | b"package"
            | b"private"
            | b"protected"
            | b"public"
            | b"return"
            | b"static"
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
            | b"yield"
    )
}

/// Most expressions in templates are `a`, `a.b.c` or `!a`. Those are written here without parsing, the way
/// `printMemberExpression` prints them. Returns true if `code` is one.
pub(crate) fn write_path(f: &mut Formatter<'_>, code: &[u8], hug: Hug) -> bool {
    let code = code.trim_ascii();
    let path = &code[code.iter().take_while(|byte| **byte == b'!').count()..];
    let is_name = |name: &[u8]| {
        matches!(name, [b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$', ..])
            && name
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
    };
    let mut names = strings::split(path, b".");
    let Some(first) = names
        .next()
        .filter(|first| is_name(first) && (!is_reserved_word(first) || *first == b"this"))
    else {
        return false;
    };
    if !names.clone().all(is_name) {
        return false;
    }
    let count = names.clone().count();
    let content = format_with(|f| {
        // Through the end of the first name.
        let mut end = code.len() - path.len() + first.len();
        write!(f, text(&code[..end]));
        for name in names.clone() {
            let lookup = text(&code[end..end + 1 + name.len()]);
            end += 1 + name.len();
            write!(f, line_suffix_boundary());
            match count == 1 && first != b"this" {
                true => write!(f, lookup),
                false => write!(f, group(&indent(&format_args!(soft_line_break(), lookup)))),
            }
        }
    });
    write_hugged(hug.should_hug_non_expression(), &content, f);
    true
}

/// `formatAttributeValue(code, textToDoc, { parser })` for the parsers that take an expression. Returns true if it was
/// written.
pub(crate) fn write_expression(
    f: &mut Formatter<'_>,
    code: &[u8],
    is_typescript: bool,
    in_html: InHtml,
    hug: Hug,
) -> bool {
    if write_path(f, code, hug) {
        return true;
    }
    let wrapped = [b"(", code, b"\n)"].concat();
    let path = if is_typescript {
        EXPRESSION_TS
    } else {
        EXPRESSION_JSX
    };
    with_file(
        f,
        &wrapped,
        &[path],
        SourceType::Module,
        in_html,
        Piece::Other,
        &mut |file, f| {
            let Some(e) = expression_of(file) else {
                return false;
            };
            let should_hug = hug.should_hug_expression(e, in_html.root);
            let content = format_with(|f| {
                write!(f, e);
            });
            write_hugged(should_hug, &content, f);
            true
        },
    )
}

/// An Angular expression.
pub(crate) struct AngularExpression<'c> {
    /// `(`, the expression as TypeScript, a line break and `)`.
    pub(crate) code: &'c [u8],
    /// A copy of `code` with the same length, with the original names where TypeScript wouldn't accept them.
    pub(crate) display_code: Option<&'c [u8]>,
    /// Written instead of the expression if it has a `prettier-ignore` comment.
    pub(crate) ignored: Option<&'c [u8]>,
}

/// Writes what's a single string in Prettier, whatever it contains.
pub(crate) fn write_string(text: &[u8], f: &mut Formatter<'_>) {
    let width = strings::contains_char(text, b'\n').then(|| {
        TextWidth::multiline_string(
            strings::split(text, b"\n")
                .map(|line| f.string_width(line))
                .sum(),
        )
    });
    f.write_text(text, width);
}

/// `formatAttributeValue(code, textToDoc, { parser })` for the parsers of `angular-estree-parser`, if the root is a
/// single expression. `write_rest` writes what follows the expression. Returns true if it was written.
pub(crate) fn write_angular_expression(
    f: &mut Formatter<'_>,
    expression: &AngularExpression<'_>,
    in_html: InHtml,
    hug: Hug,
    write_rest: &dyn for<'b> Fn(&mut Formatter<'b>),
) -> bool {
    let Some(parse) = Parse::from_formatter(f) else {
        return false;
    };
    // The class-sorting plugin doesn't replace the Angular parsers.
    let options = FormatOptions {
        tailwind: None,
        ..options_in_html(f.options(), in_html)
    };
    let mut is_written = false;
    parse.call(EXPRESSION_TS, expression.code, false, &mut |file| {
        let Some(e) = expression_of(file).filter(|_| !file.has_parse_errors()) else {
            return;
        };
        let source = match expression.display_code {
            None => file.text(),
            Some(display_code) => match file.extension(|| display_code.to_vec()) {
                Some(display_code) => &display_code[..],
                None => return,
            },
        };
        let should_hug = hug.should_hug_expression(e, in_html.root);
        // An assignment only goes without parentheses in an `NGChainedExpression`.
        let needs_parentheses = e.tag() == ExprTag::Assign && in_html.root != HtmlRoot::NgAction;
        let content = format_with(|f| {
            match expression.ignored {
                Some(text) => write_string(text, f),
                None => write!(
                    f,
                    [
                        needs_parentheses.then_some("("),
                        e,
                        needs_parentheses.then_some(")")
                    ]
                ),
            }
            write_rest(f);
        });
        let context = JsFormatContext::new(file, options.clone(), &NO_COMMENTS);
        f.write_embedded(context, source, |f| write_hugged(should_hug, &content, f));
        is_written = true;
    });
    is_written
}

/// The same for a program. `shouldHugJsExpression` sees a `File` as the root, which it doesn't hug.
pub(crate) fn write_program_in_attribute(
    f: &mut Formatter<'_>,
    code: &[u8],
    syntax: Syntax,
    in_html: InHtml,
    hug: Hug,
) -> bool {
    with_file(
        f,
        code,
        paths_of(syntax, code),
        SourceType::Unknown,
        in_html,
        Piece::Other,
        &mut |file, f| {
            let content = format_with(|f| write_statements(file, f));
            write_hugged(hug.should_hug_non_expression(), &content, f);
            true
        },
    )
}

/// The part that `printHtmlBinding` prints of a program that's a single declaration.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Binding {
    /// `__isVueBindings`: the parameters of `function _(..) {}`.
    Parameters,
    /// `__isVueForBindingLeft`: the same, in parentheses unless there's exactly one.
    ForLeft,
    /// `__isEmbeddedTypescriptGenericParameters`: the type parameters of `type T<..> = any`.
    TypeParameters,
}

/// `group(printHtmlBinding(..))` for `before`, `code` and `after` concatenated. `flavor` is the flavor to format it in.
/// Returns true if it was written.
pub(crate) fn write_binding(
    f: &mut Formatter<'_>,
    code: &[u8],
    is_typescript: bool,
    in_html: InHtml,
    (binding, flavor): (Binding, Flavor),
) -> bool {
    let (before, after): (&[u8], &[u8]) = match binding {
        Binding::Parameters | Binding::ForLeft => (b"function _(", b") {}"),
        Binding::TypeParameters => (b"type T<", b"> = any"),
    };
    let program = [before, code, after].concat();
    let syntax = if is_typescript {
        Syntax::BabelTs
    } else {
        Syntax::Babel
    };
    with_file(
        f,
        &program,
        paths_of(syntax, &program),
        SourceType::Unknown,
        in_html,
        Piece::Binding(flavor),
        &mut |file, f| {
            let Some(statement) = file.body().iter().next() else {
                return false;
            };
            let separator = format_with(|f| write!(f, [",", soft_line_break_or_space()]));
            match (binding, statement.kind()) {
                (Binding::TypeParameters, StmtKind::TypeAlias(alias)) => {
                    let content = format_with(|f| {
                        f.join_with(&separator).entries(alias.type_params().iter());
                    });
                    // The root is a `File`, which `shouldHugJsExpression` doesn't hug.
                    write_hugged(Some(false), &content, f);
                }
                (Binding::Parameters | Binding::ForLeft, StmtKind::Fn(func)) => {
                    // Only TypeScript has a `this` parameter.
                    if func.this_param().is_some() && !is_typescript {
                        return false;
                    }
                    let list = format_with(|f| {
                        f.join_with(&separator).entries(func.params_with_this());
                    });
                    match binding == Binding::ForLeft && func.params_with_this().count() != 1 {
                        true => write!(
                            f,
                            group(&format_args!(
                                "(",
                                indent(&format_args!(soft_line_break(), group(&list))),
                                soft_line_break(),
                                ")"
                            ))
                        ),
                        false => write!(f, group(&list)),
                    }
                }
                _ => return false,
            }
            true
        },
    )
}

// ───────────────────────────── `"` in an attribute value ─────────────────────────────

/// `(doc) => (typeof doc === "string" ? doc.replaceAll('"', "&quot;") : doc)`
struct QuoteEntities;

impl MapString for QuoteEntities {
    fn changes(&self, text: &[u8]) -> bool {
        strings::contains_char(text, b'"')
    }

    fn write(&mut self, text: &[u8], is_one_string: bool, f: &mut Formatter<'_>) {
        let mut replaced = Vec::with_capacity(text.len() + 16);
        for (index, part) in strings::split(text, b"\"").enumerate() {
            if index > 0 {
                replaced.extend_from_slice(b"&quot;");
            }
            replaced.extend_from_slice(part);
        }
        match is_one_string {
            true => write_string(&replaced, f),
            false => f.write_text(&replaced, None),
        }
    }
}

/// Writes the captured `content` as an attribute value between double quotes.
pub(crate) fn write_with_quote_entities(content: Interned, f: &mut Formatter<'_>) {
    write_mapped(content, &mut QuoteEntities, f);
}
