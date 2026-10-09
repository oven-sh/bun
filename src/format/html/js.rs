//! JavaScript and TypeScript in HTML: Prettier's `textToDoc` for the parsers of `language-js`.
//!
//! The code is parsed by itself, and written by the formatter for JavaScript to the document that the HTML is written
//! to, so that where its lines are broken depends on where it is.

use super::map_strings::{MapString, write_mapped};
use crate::ir::element::{Interned, TextWidth};
use crate::js::context::JsFormatContext;
use crate::js::print::program::{FormatStatements, write_hashbang};
use crate::js::sort_imports::{SortImports, sorted_text};
use crate::options::{Flavor, HtmlRoot, InHtml, JavaScriptParser, ParseJavaScript};
use crate::prelude::*;
use crate::tailwind::{Ends, Tailwind};
use crate::{format_args, text, write};
use bun_core::strings;
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::linter::{TypesInJavaScript, refused_by_prettier_with};

/// The parsers of Prettier for programs.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Syntax {
    /// `babel`: JavaScript with JSX.
    Babel,
    /// `babel-ts`: TypeScript, with JSX if that can be.
    BabelTs,
    /// `typescript`, for a file whose name does not say whether it has JSX.
    TypeScript,
    /// TypeScript without JSX, and nothing else: what oxfmt takes the scripts of a Vue file for.
    Ts,
    /// TypeScript with JSX, and nothing else: the same if one of them says `lang="tsx"`.
    Tsx,
}

/// `sourceType`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum SourceType {
    Script,
    Module,
    /// A module, or else a script.
    Unknown,
}

/// The name of a file whose text is `(`, an expression and `)`. See `AstNodes::parent`.
const EXPRESSION_JSX: &[u8] = b"\0.jsx";
const EXPRESSION_TS: &[u8] = b"\0.ts";

/// Prettier's `isProbablyJsx`: `/(?:^[^"'`]*<\/|^[^/]{2}.*\/>)/m`
fn is_probably_jsx(text: &[u8]) -> bool {
    // `</` with the start of a line before it and no quote in between.
    let mut rest = if strings::contains(text, b"</") {
        text
    } else {
        b""
    };
    let mut is_behind_quote = false;
    while let Some(at) = strings::index_of_any(rest, b"\"'`\n<") {
        match rest[at] {
            b'\n' => is_behind_quote = false,
            b'<' if is_behind_quote || rest.get(at + 1) != Some(&b'/') => {}
            b'<' => return true,
            _ => is_behind_quote = true,
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

/// The options for code that is in HTML that is formatted with `options`.
pub(crate) fn options_in_html(options: &FormatOptions, in_html: InHtml) -> FormatOptions {
    FormatOptions {
        // In an attribute, double quotes would have to be written as entities.
        quote_style: if in_html.is_in_attribute {
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

/// What parses code.
#[derive(Copy, Clone)]
pub(crate) enum Parse<'p> {
    Function(ParseJavaScript),
    Closure(JavaScriptParser<'p>),
}

impl<'p> Parse<'p> {
    /// `parse`, or else what `options` has.
    pub(crate) fn new(
        parse: Option<JavaScriptParser<'p>>,
        options: &FormatOptions,
    ) -> Option<Parse<'p>> {
        match parse {
            Some(parse) => Some(Parse::Closure(parse)),
            None => options.parse_javascript.map(Parse::Function),
        }
    }

    /// For the code in the HTML that `f` writes.
    fn of(f: &Formatter<'p>) -> Option<Parse<'p>> {
        Parse::new(f.context().parse_javascript, f.options())
    }

    fn call(
        self,
        path: &[u8],
        code: &[u8],
        is_script: bool,
        then: &mut dyn for<'b> FnMut(&'b File<'b>),
    ) {
        match self {
            Parse::Function(parse) => parse(path, code, is_script, then),
            Parse::Closure(parse) => parse(path, code, is_script, then),
        }
    }
}

type Write<'w> = &'w mut dyn for<'b> FnMut(&'b File<'b>, &mut Formatter<'b>) -> bool;

/// What code is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Piece {
    /// All that is in a `<script>`, and whose output it is. What sorts imports and rewrites JSDoc comments takes it for
    /// a file.
    Script(Flavor),
    Other,
}

/// What has become of code that has been parsed one way.
enum Attempt {
    /// It cannot be parsed that way.
    Refused,
    /// Nothing has been written: this is to be parsed in its place.
    Sorted(Vec<u8>),
    /// What `write` has returned.
    Written(bool),
}

/// Parses `code` as the file at each of `paths`, until it is one without errors, and calls `write` with that file and
/// a formatter that goes on with the document of `f`. Returns what `write` returns, and `false` if `code` cannot be
/// parsed: nothing has been written then.
fn with_file(
    f: &mut Formatter<'_>,
    code: &[u8],
    paths: &[&[u8]],
    source_type: SourceType,
    in_html: InHtml,
    piece: Piece,
    write: Write<'_>,
) -> bool {
    let Some(parse) = Parse::of(f) else {
        return false;
    };
    let mut options = options_in_html(f.options(), in_html);
    // To Prettier the name of the file is still that of the HTML, so `<T,>() => {}` keeps its comma: it is not `.ts`.
    // oxfmt prints a script like a file of its own.
    if !matches!(piece, Piece::Script(flavor) if flavor.is_oxfmt()) {
        options.filepath.clone_from(&f.options().filepath);
    }
    // A plugin of Prettier sorts the imports of the text before it is parsed.
    let mut sorts_text = None;
    if let Piece::Script(flavor) = piece {
        options.flavor = flavor;
        options.jsdoc = f.options().jsdoc;
        match f.options().sort_imports.clone() {
            Some(how) if how.is_applied_by_format() => options.sort_imports = Some(how),
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
                let mut result = Attempt::Refused;
                parse.call(path, code, is_script, &mut |file| {
                    if file.has_parse_errors()
                        || refused_by_prettier_with(file, TypesInJavaScript::Refused)
                    {
                        return;
                    }
                    let comments = file.extension(|| {
                        let mut comments = Vec::new();
                        crate::js::comments::collect(file, options.flavor, &mut comments);
                        comments
                    });
                    let comments = comments.map_or(&[][..], |comments: &Vec<Comment>| comments);
                    // Only in what is known to be a script are `<!--` and `-->` comments to Babel.
                    let is_html_like = |comment: &Comment| {
                        matches!(
                            file.text().get(comment.span.start as usize),
                            Some(b'<' | b'-')
                        )
                    };
                    if source_type != SourceType::Script && comments.iter().any(is_html_like) {
                        return;
                    }
                    if let Some(sorted) = sorts_text.and_then(|how| sorted_text(file, how)) {
                        result = Attempt::Sorted(sorted);
                        return;
                    }
                    let context = JsFormatContext::new(file, options.clone(), comments);
                    let is_written = f.write_embedded(context, file.text(), |f| write(file, f));
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

/// `code`, which is all that is in a `<script>`, with its imports sorted. `None`: it is the same, or cannot be parsed.
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

/// Finds the strings and the templates of a program, and sorts the classes in them.
struct ClassSorter<'t> {
    tailwind: &'t Tailwind,
    /// The operands of each `+` around what is visited.
    concatenations: Vec<(Span, Span)>,
    /// What is written in the place of what, in the order of the text.
    changes: Vec<(Span, Vec<u8>)>,
}

impl ClassSorter<'_> {
    /// `text`, which is at `span`, is text of a template, or what is between the quotes of a string. `index`, `count`: which of
    /// how many texts of the template.
    fn sort(&mut self, text: &[u8], span: Span, (index, count): (usize, usize)) {
        // What is added to has to stay apart.
        let (is_left, is_right) = self.concatenations.last().map_or((false, false), |it| {
            let is_in = |operand: Span| operand.start <= span.start && span.end <= operand.end;
            (is_in(it.0), is_in(it.1))
        });
        let ends = Ends {
            ignores_first: index > 0 && !text::starts_with_white_space(text),
            ignores_last: index + 1 < count && text::trim_end(text).len() == text.len(),
            collapses_start: !is_right && index == 0,
            collapses_end: !is_left && index + 1 == count,
        };
        let sorted = self.tailwind.sorted_between(text, ends);
        if *sorted != *text {
            self.changes.push((span, sorted.into_owned()));
        }
    }

    /// `span`: of a string with its quotes, or of a template without substitutions.
    fn sort_literal(&mut self, file: &File<'_>, span: Span) {
        if let [b'"' | b'\'' | b'`', content @ .., _] = file.slice(span) {
            self.sort(content, Span::new(span.start + 1, span.end - 1), (0, 1));
        }
    }
}

impl<'a> Visitor<'a> for ClassSorter<'_> {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Expr(e) => match e.kind() {
                ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    right,
                } => self.concatenations.push((left.span(), right.span())),
                ExprKind::String(_) if !e.is_jsx_text() => self.sort_literal(e.file(), e.span()),
                ExprKind::Template(template) => {
                    let count = template.quasi_count();
                    for index in 0..count {
                        let span = template.quasi_span(index);
                        let end = span.end - if index + 1 == count { 1 } else { 2 };
                        let span = Span::new(span.start + 1, end);
                        self.sort(template.raw(index), span, (index, count));
                    }
                }
                _ => {}
            },
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
        if matches!(node, Node::Expr(e) if matches!(e.kind(), ExprKind::Binary { op: BinOp::Add, .. }))
        {
            self.concatenations.pop();
        }
    }
}

/// What `prettier-plugin-tailwindcss` makes of `code`, an expression in an attribute of Vue: `transformDynamicJsAttribute`.
/// `None`: it is the same, or cannot be parsed.
pub(crate) fn with_sorted_classes(
    parse: Parse<'_>,
    code: &[u8],
    tailwind: &Tailwind,
) -> Option<Vec<u8>> {
    const BEFORE: &[u8] = b"let __prettier_temp__ = ";
    let source = [BEFORE, code].concat();
    let mut changes = None;
    for path in paths_of(Syntax::BabelTs, code) {
        parse.call(path, &source, false, &mut |file| {
            if !file.has_parse_errors() {
                let mut sorter = ClassSorter {
                    tailwind,
                    concatenations: Vec::new(),
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
    let changes = changes.filter(|it| !it.is_empty())?;
    let (mut sorted, mut from) = (Vec::with_capacity(code.len()), BEFORE.len());
    for (span, text) in changes {
        sorted.extend_from_slice(source.get(from..span.start as usize)?);
        sorted.extend_from_slice(&text);
        from = span.end as usize;
    }
    sorted.extend_from_slice(source.get(from..)?);
    Some(sorted)
}

fn paths_of(syntax: Syntax, code: &[u8]) -> &'static [&'static [u8]] {
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

/// What Prettier makes of a `Program`, without the line break at the end.
fn write_statements<'b>(file: &'b File<'b>, f: &mut Formatter<'b>) {
    // Nothing that a comment could belong to. Without a statement at all the comments keep the empty lines between
    // them, as in `write_program`, which counts on being at the start of a line.
    let is_all_empty = file
        .body()
        .iter()
        .all(|it| matches!(it.kind(), StmtKind::Empty));
    write_hashbang(
        is_all_empty && f.comments().unprinted_comments().is_empty(),
        f,
    );
    if is_all_empty && (!file.body().is_empty() || f.options().in_html.is_in_attribute) {
        let comments = f.comments().unprinted_comments();
        let indent = DanglingIndentMode::None;
        return write!(f, FormatDanglingComments::Comments { comments, indent });
    }
    write!(f, FormatStatements(file.body()));
    let rest = f.comments().unprinted_comments();
    write!(f, FormatTrailingComments::Comments(rest));
}

/// `textToDoc(code, { parser })` for a program. `flavor`: whose output it is. Returns whether it has been written.
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

/// What `formatAttributeValue` puts around the document.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Hug {
    /// `group(doc)`
    Always,
    /// `printExpand(doc)`
    Never,
    /// `shouldHugJsExpression`
    Expression,
    /// Nothing: it is `textToDoc` that is called.
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
    /// Whether `formatAttributeValue` hugs a root with `e` in it. `None`: it is not called.
    fn of_expression(self, e: Expr<'_>, root: HtmlRoot) -> Option<bool> {
        match self {
            Hug::Expression => Some(should_hug_js_expression(e, root)),
            _ => self.of_other_kinds(),
        }
    }

    /// The same for a root that `shouldHugJsExpression` says no to.
    pub(crate) fn of_other_kinds(self) -> Option<bool> {
        match self {
            Hug::Always => Some(true),
            Hug::Never | Hug::Expression => Some(false),
            Hug::Bare => None,
        }
    }
}

/// Writes `content` the way `formatAttributeValue` returns it.
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

/// The expression that `file` is made of, if its text is `(`, an expression, a line break and `)`.
fn expression_of<'b>(file: &'b File<'b>) -> Option<Expr<'b>> {
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

/// What no name can be, or can be only in some places.
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

/// Most expressions in templates are `a`, `a.b.c` or `!a`. Those are written here, as `printMemberExpression` has them,
/// without being parsed. Returns whether `code` is one.
fn write_path(f: &mut Formatter<'_>, code: &[u8], hug: Hug) -> bool {
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
        // Up to the end of the first name.
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
    write_hugged(hug.of_other_kinds(), &content, f);
    true
}

/// `formatAttributeValue(code, textToDoc, { parser })` for the parsers that take an expression. Returns whether it has
/// been written.
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
            let should_hug = hug.of_expression(e, in_html.root);
            let content = format_with(|f| {
                write!(f, e);
                let rest = f.comments().unprinted_comments();
                write!(f, FormatTrailingComments::Comments(rest));
            });
            write_hugged(should_hug, &content, f);
            true
        },
    )
}

/// An expression of Angular.
pub(crate) struct AngularExpression<'c> {
    /// `(`, the expression as TypeScript, a line break and `)`.
    pub(crate) code: &'c [u8],
    /// The same, as long, with the names as they are written where those are no names to TypeScript.
    pub(crate) shown: Option<&'c [u8]>,
    /// What is written in its place: it has a `prettier-ignore` comment.
    pub(crate) ignored: Option<&'c [u8]>,
}

/// One string to Prettier, whatever is in it.
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

/// `formatAttributeValue(code, textToDoc, { parser })` for the parsers of `angular-estree-parser`, if the root is one
/// expression. `write_rest` writes what follows the expression. Returns whether it has been written.
pub(crate) fn write_angular_expression(
    f: &mut Formatter<'_>,
    expression: &AngularExpression<'_>,
    in_html: InHtml,
    hug: Hug,
    write_rest: &dyn for<'b> Fn(&mut Formatter<'b>),
) -> bool {
    let Some(parse) = Parse::of(f) else {
        return false;
    };
    let options = options_in_html(f.options(), in_html);
    let mut is_written = false;
    parse.call(EXPRESSION_TS, expression.code, false, &mut |file| {
        let Some(e) = expression_of(file).filter(|_| !file.has_parse_errors()) else {
            return;
        };
        let source = match expression.shown {
            None => file.text(),
            Some(shown) => match file.extension(|| shown.to_vec()) {
                Some(shown) => &shown[..],
                None => return,
            },
        };
        let should_hug = hug.of_expression(e, in_html.root);
        // Only in an `NGChainedExpression` is an assignment without parentheses.
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
        let context = JsFormatContext::new(file, options.clone(), &[]);
        f.write_embedded(context, source, |f| write_hugged(should_hug, &content, f));
        is_written = true;
    });
    is_written
}

/// The same for a program. For `shouldHugJsExpression` the root is a `File`, which is not hugged.
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
            write_hugged(hug.of_other_kinds(), &content, f);
            true
        },
    )
}

/// What `printHtmlBinding` prints of a program that is one declaration.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Binding {
    /// `__isVueBindings`: the parameters of `function _(..) {}`.
    Parameters,
    /// `__isVueForBindingLeft`: the same, in parentheses if there is more than one.
    ForLeft,
    /// `__isEmbeddedTypescriptGenericParameters`: the type parameters of `type T<..> = any`.
    TypeParameters,
}

/// `group(printHtmlBinding(..))`, for `before`, `code` and `after` put together. Returns whether it has been written.
pub(crate) fn write_binding(
    f: &mut Formatter<'_>,
    code: &[u8],
    is_typescript: bool,
    in_html: InHtml,
    binding: Binding,
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
        Piece::Other,
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
                    // The root is a `File`, which `shouldHugJsExpression` has nothing to say about.
                    write_hugged(Some(false), &content, f);
                }
                (Binding::Parameters | Binding::ForLeft, StmtKind::Fn(func)) => {
                    // Only TypeScript has it.
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

// ───────────────────────────── `"` in the value of an attribute ─────────────────────────────

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

/// Writes `content`, which has been captured, as the value of an attribute between double quotes.
pub(crate) fn write_with_quote_entities(content: Interned, f: &mut Formatter<'_>) {
    write_mapped(content, &mut QuoteEntities, f);
}
