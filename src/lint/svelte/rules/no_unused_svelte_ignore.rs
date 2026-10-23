use crate::ignores::{Ignore, ignores_of};
use bun_core::printer::json_stringify;
use bun_core::strings::{self, Utf16OffsetTable};
use bun_lint::ast::svelte::{Child, InComponent, Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::svelte_compiler::Compiled;

/// disallow unused svelte-ignore comments
pub struct NoUnusedSvelteIgnore;

const UNUSED: Message = Message::new("unused", "svelte-ignore comment is used, but not warned");
const MISSING_CODE: Message = Message::new("missingCode", "svelte-ignore comment must include the code");

/// eslint-plugin-svelte's `CSS_WARN_CODES`: the warnings a style sheet that isn't compiled could get.
const CSS_WARN_CODES: &[&[u8]] = &[
    b"css-unused-selector",
    b"css_unused_selector",
    b"css-invalid-global",
    b"css-invalid-global-selector",
];

impl Rule for NoUnusedSvelteIgnore {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-unused-svelte-ignore", Kind::Suggestion).recommended()
        .reports_on_creation();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnusedSvelteIgnore
    }

    /// If the config hasn't loaded eslint-plugin-svelte, nothing runs the project's compiler, and nothing is reported.
    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let component = file.svelte().filter(|_| file.svelte_compiler().is_some())?;
        strings::contains(component.text(), b"svelte-ignore").then_some(())
    }

    /// Everything happens in `create`: first the comments without a code, then the ones under which the compiler warns
    /// about nothing.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let Some(root) = file.svelte_root() else {
            return;
        };
        let ignores = ignores_of(file);
        for ignore in ignores.iter().filter(|it| it.code.is_none()) {
            cx.report(InComponent(ignore.comment), MISSING_CODE);
        }
        let ignores: Vec<&Ignore<'_>> = ignores.iter().filter(|it| it.code.is_some()).collect();
        if ignores.is_empty() {
            return;
        }
        let warned = match compile(file, root, &ignores) {
            Ok(Some(warned)) => warned,
            Ok(None) => return,
            Err(message) => return cx.throw_on_creation(message),
        };
        for ignore in unused(file, root, &ignores, &warned) {
            if let Some((_, span)) = &ignore.code {
                cx.report(InComponent(*span), UNUSED);
            }
        }
    }
}

/// The compiler's results for the component.
struct Warned<'a> {
    /// True for Svelte 4, which doesn't warn about `reactive-component` without code to generate, so that code is
    /// skipped.
    is_before_five: bool,
    /// The blanked style sheets, as `getSvelteCompileWarnings` has them.
    stripped: Vec<SvelteNode<'a>>,
    /// Each warning with a code, and its start and end in the component.
    warnings: Vec<(Vec<u8>, Option<u32>, Option<u32>)>,
}

/// The top-level style sheets in a language other than CSS, with that language:
/// `extractStyleElementsWithLangOtherThanCSS`.
fn styles_in_other_languages<'a>(root: SvelteNode<'a>) -> Vec<(SvelteNode<'a>, Vec<u8>)> {
    (root.nodes(Role::Body))
        .filter(|it| it.tag() == SvelteTag::StyleElement)
        .filter_map(|it| Some((it, lang_of(it)?.to_ascii_lowercase())))
        .filter(|(_, lang)| lang != b"css")
        .collect()
}

/// `getLangValue`: the value of the first `lang` attribute, if it's only text.
fn lang_of(element: SvelteNode<'_>) -> Option<Vec<u8>> {
    let tag = element.child(Role::StartTag)?;
    let attribute = (tag.nodes(Role::Attributes))
        .find(|it| it.tag() == SvelteTag::Attribute && it.name() == b"lang")?;
    let mut value = Vec::new();
    for part in attribute.nodes(Role::Value) {
        if part.tag() != SvelteTag::Literal {
            return None;
        }
        value.extend_from_slice(part.text());
    }
    Some(value)
}

/// The span between a script's or style sheet's start tag and end tag.
fn content_of(element: SvelteNode<'_>) -> Option<Span> {
    let (start, end) = (element.child(Role::StartTag)?, element.child(Role::EndTag)?);
    Some(Span::new(start.span().end, end.span().start))
}

/// `getSvelteCompileWarnings`, up to `processIgnore`. `None` if the component doesn't compile or there's no compiler.
/// `Err` holds what was thrown while asking.
fn compile<'a>(
    file: &'a File<'a>,
    root: SvelteNode<'a>,
    ignores: &[&Ignore<'a>],
) -> Result<Option<Warned<'a>>, Vec<u8>> {
    let (Some(compiler), Some(component)) = (file.svelte_compiler(), file.svelte()) else {
        return Ok(None);
    };
    let text = component.text();
    let bom = if text.starts_with(bun_lint::source::BOM) { 3 } else { 0 };
    let offsets = Utf16OffsetTable::without_bom(text);
    let range = |out: &mut Vec<u8>, span: Span| {
        let (start, end) = (offsets.to_utf16(span.start), offsets.to_utf16(span.end));
        out.extend_from_slice(format!("[{start},{end}]").as_bytes());
    };
    let mut request = b"{\"plugin\":".to_vec();
    json_stringify(compiler.plugin, &mut request);
    request.extend_from_slice(b",\"filename\":");
    json_stringify(compiler.filename, &mut request);
    request.extend_from_slice(b",\"strip\":[");
    let mut comments: Vec<Span> = ignores.iter().map(|it| it.comment).collect();
    bun_lint::utils::sort::sort_by_key(&mut comments, |it| it.start);
    comments.dedup();
    for (i, &comment) in comments.iter().enumerate() {
        if i > 0 {
            request.push(b',');
        }
        range(&mut request, comment);
    }
    request.extend_from_slice(b"],\"styles\":[");
    let styles = styles_in_other_languages(root);
    for (i, (style, lang)) in styles.iter().enumerate() {
        if i > 0 {
            request.push(b',');
        }
        request.extend_from_slice(b"{\"lang\":");
        json_stringify(lang, &mut request);
        request.extend_from_slice(b",\"input\":");
        range(&mut request, content_of(*style).unwrap_or_else(|| style.span()));
        request.extend_from_slice(b",\"children\":[");
        for (j, child) in style.nodes(Role::Children).enumerate() {
            if j > 0 {
                request.push(b',');
            }
            range(&mut request, child.span());
        }
        request.extend_from_slice(b"]}");
    }
    request.extend_from_slice(b"],\"scripts\":[");
    let scripts = (root.nodes(Role::Body)).filter(|it| it.tag() == SvelteTag::ScriptElement);
    let mut is_typescript = !file.is_javascript();
    for (i, script) in scripts.enumerate() {
        if i > 0 {
            request.push(b',');
        }
        let lang = lang_of(script).map(|it| it.to_ascii_lowercase());
        is_typescript |= matches!(lang.as_deref(), Some(b"ts" | b"typescript"));
        range(&mut request, content_of(script).unwrap_or_else(|| script.span()));
    }
    request.extend_from_slice(b"],\"scriptKind\":");
    request.extend_from_slice(match is_typescript {
        true => b"\"typescript\"",
        false => b"null",
    });
    request.extend_from_slice(b",\"async\":");
    request.extend_from_slice(compiler.experimental_async);
    request.extend_from_slice(b",\"customElement\":");
    request.extend_from_slice(match is_custom_element(root) {
        true => b"true",
        false => b"false",
    });
    request.extend_from_slice(b",\"postcss\":");
    let postcss = (file.settings().get(b"svelte"))
        .and_then(|it| it.get(b"compileOptions")?.get(b"postcss"));
    match postcss {
        Some(postcss) => postcss.stringify(&mut request),
        None => request.extend_from_slice(b"null"),
    }
    request.extend_from_slice(b",\"program\":");
    request.extend_from_slice(compiler.program);
    request.push(b'}');
    let answer = match (compiler.compiles).compile(&request, text.get(bom..).unwrap_or_default()) {
        Compiled::Answer(answer) => answer,
        Compiled::NotInstalled => return Ok(None),
        Compiled::Failed(why) => return Err(why),
    };
    if answer.get(b"kind").and_then(Json::as_str) != Some(b"warn") {
        return Ok(None);
    }
    let version = answer.get(b"version").and_then(Json::as_str).unwrap_or_default();
    let major = version.get(..strings::index_of_char_usize(version, b'.').unwrap_or(version.len()));
    let places = component.places();
    let at = |point: Option<&Json>| -> Option<u32> {
        let point = point?;
        if let Some(Json::Number(index)) = point.get(b"index") {
            return Some(offsets.to_bytes(*index as u32));
        }
        let (Some(Json::Number(line)), Some(Json::Number(column))) = (point.get(b"line"), point.get(b"column")) else {
            return None;
        };
        Some(places.offset(*line as u32, *column as u32 + 1))
    };
    let warnings = (answer.get(b"warnings").and_then(Json::as_array).unwrap_or_default().iter())
        .filter_map(|it| {
            let code = it.get(b"code").and_then(Json::as_str)?.to_vec();
            Some((code, at(it.get(b"start")), at(it.get(b"end"))))
        })
        .collect();
    let stripped = (answer.get(b"stripped").and_then(Json::as_array).unwrap_or_default().iter())
        .filter_map(|it| match it {
            Json::Number(at) => styles.get(*at as usize).map(|it| it.0.id()),
            _ => None,
        })
        .filter_map(|id| file.svelte_node(id))
        .collect();
    Ok(Some(Warned {
        is_before_five: matches!(major, Some([b'0'..=b'4'])),
        stripped,
        warnings,
    }))
}

/// `isCustomElement`: a top-level `<svelte:options>` with a `tag` or a `customElement`.
fn is_custom_element(root: SvelteNode<'_>) -> bool {
    root.nodes(Role::Body).any(|it| {
        it.tag() == SvelteTag::Element
            && it.kind() == SvelteKind::Special
            && it.name() == b"svelte:options"
            && it.child(Role::StartTag).is_some_and(|tag| {
                (tag.nodes(Role::Attributes)).any(|attribute| {
                    attribute.tag() == SvelteTag::Attribute
                        && matches!(attribute.name(), b"tag" | b"customElement")
                })
            })
    })
}

/// `processIgnore`: the entries of `ignores` that ignore nothing the compiler warns about. A warning targets the
/// element it's in, or a top-level node of the component or a script, and a comment before that node, or before an
/// enclosing element or block, ignores it.
fn unused<'i, 'a>(
    file: &'a File<'a>,
    root: SvelteNode<'a>,
    ignores: &[&'i Ignore<'a>],
    warned: &Warned<'a>,
) -> Vec<&'i Ignore<'a>> {
    let Some(text) = file.svelte().map(|it| it.text()) else {
        return Vec::new();
    };
    let offsets = Utf16OffsetTable::without_bom(text);
    let leading = Leading::of(file);
    let mut is_used = vec![false; ignores.len()];
    let mut use_first = |at: u32, ignores_it: &dyn Fn(&Ignore<'a>) -> bool| {
        for comment in leading.before(at).iter().rev() {
            let found = (ignores.iter()).position(|it| it.comment.start == *comment && ignores_it(it));
            if let Some(found) = found {
                is_used[found] = true;
                break;
            }
        }
    };
    for (code, start, end) in &warned.warnings {
        let mut target = warned_node(file, root, (*start, *end), &offsets);
        while let Some(at) = target {
            use_first(at.start(), &|it| it.ignores(code));
            target = at.ignore_parent();
        }
    }
    // A blanked style sheet isn't compiled, so its warnings aren't known.
    for style in &warned.stripped {
        use_first(style.span().start, &|it| {
            it.code.is_some_and(|code| CSS_WARN_CODES.contains(&code.0))
                || CSS_WARN_CODES.contains(&&*it.code_for_five)
        });
    }
    let is_reactive_component = |it: &Ignore<'_>| it.code.is_some_and(|it| it.0 == b"reactive-component");
    (ignores.iter().zip(is_used))
        .filter(|(it, is_used)| !is_used && !(warned.is_before_five && is_reactive_component(it)))
        .map(|(it, _)| *it)
        .collect()
}

/// A warning's target: `getWarningTargetNodeFromIndex`.
#[derive(Copy, Clone)]
enum Target<'a> {
    Node(SvelteNode<'a>),
    /// A top-level statement in a script, by its start.
    Statement(u32),
}

impl<'a> Target<'a> {
    fn start(self) -> u32 {
        match self {
            Target::Node(node) => node.span().start,
            Target::Statement(start) => start,
        }
    }

    /// `getIgnoreParent`: the element or block that encloses an element or a block.
    fn ignore_parent(self) -> Option<Target<'a>> {
        let Target::Node(node) = self else {
            return None;
        };
        let is_target = |it: SvelteNode<'_>| {
            matches!(
                it.tag(),
                SvelteTag::Element | SvelteTag::IfBlock | SvelteTag::KeyBlock | SvelteTag::EachBlock
            )
        };
        if !is_target(node) && node.tag() != SvelteTag::AwaitBlock {
            return None;
        }
        let parent = node.parent()?;
        match parent.tag() {
            SvelteTag::ElseBlock
            | SvelteTag::AwaitPendingBlock
            | SvelteTag::AwaitThenBlock
            | SvelteTag::AwaitCatchBlock => parent.parent().map(Target::Node),
            _ if is_target(parent) => Some(Target::Node(parent)),
            _ => None,
        }
    }
}

/// `getWarningNode`: the node at the warning's start, otherwise at its middle, otherwise at its end.
fn warned_node<'a>(
    file: &'a File<'a>,
    root: SvelteNode<'a>,
    (start, end): (Option<u32>, Option<u32>),
    offsets: &Utf16OffsetTable,
) -> Option<Target<'a>> {
    if let Some(start) = start {
        if let Some(found) = target_at(file, root, start) {
            return Some(found);
        }
        if let Some(end) = end {
            let (from, to) = (offsets.to_utf16(start), offsets.to_utf16(end));
            let middle = from + to.saturating_sub(from) / 2;
            return target_at(file, root, offsets.to_bytes(middle));
        }
    }
    target_at(file, root, end?)
}

/// `getWarningTargetNodeFromIndex`: starting from the innermost node at `index`, the first element or style sheet, or
/// top-level node of the component or a script.
fn target_at<'a>(file: &'a File<'a>, root: SvelteNode<'a>, index: u32) -> Option<Target<'a>> {
    let contains = |span: Span| span.start <= index && index < span.end;
    let mut innermost = root;
    while let Some(child) = (innermost.children())
        .filter_map(|(_, child)| match child {
            Child::Node(id) => file.svelte_node(id),
            _ => None,
        })
        .find(|it| contains(it.span()))
    {
        innermost = child;
    }
    if innermost.tag() == SvelteTag::ScriptElement
        && let Some(view) = file.view()
    {
        // A statement at the end of the scripts without a `;` gets the lowering's `;` after them, so its parts are
        // roots.
        let top_level = |node: Node<'a>| {
            let mut node = node;
            while !matches!(node, Node::File(_)) && !matches!(node.parent(), Node::File(_)) {
                node = node.parent();
            }
            node
        };
        for statement in innermost.codes(Role::Body).flat_map(|it| it.roots()) {
            let span = top_level(statement.node()).span();
            let start = view.in_file(span.start);
            if contains(Span::new(start, start + span.len())) {
                return Some(Target::Statement(start));
            }
        }
    }
    let mut at = innermost;
    loop {
        if matches!(at.tag(), SvelteTag::Element | SvelteTag::StyleElement) {
            return Some(Target::Node(at));
        }
        let parent = at.parent()?;
        if matches!(parent.tag(), SvelteTag::Program | SvelteTag::ScriptElement) {
            return Some(Target::Node(at));
        }
        at = parent;
    }
}

/// A component's tokens and comments as `extractLeadingComments` sees them, in component positions.
struct Leading {
    /// The ends of the tokens that a comment before a node must come after: anything but text, HTML comments and `(`.
    ends: Vec<u32>,
    /// The start and end of each comment and HTML comment.
    comments: Vec<(u32, u32)>,
}

impl Leading {
    fn of<'a>(file: &'a File<'a>) -> Leading {
        let (mut ends, mut comments) = (Vec::new(), Vec::new());
        if let Some(view) = file.view() {
            let in_component = |span: Span| {
                let start = view.in_file(span.start);
                (start, start + span.len())
            };
            for token in file.tokens() {
                match token.kind() {
                    TokenKind::HtmlComment => comments.push(in_component(token.span())),
                    TokenKind::HtmlText => {}
                    _ if token.is_punctuator("(") => {}
                    _ => ends.push(in_component(token.span()).1),
                }
            }
            comments.extend(file.comments().map(|it| in_component(it.span())));
        }
        bun_lint::utils::sort::sort_by_key(&mut comments, |it| *it);
        bun_lint::utils::sort::sort_by_key(&mut ends, |it| *it);
        Leading { ends, comments }
    }

    /// The starts of the comments before `start`, after the last token before it.
    fn before(&self, start: u32) -> Vec<u32> {
        let after = self.ends.partition_point(|&end| end <= start);
        let from = after.checked_sub(1).and_then(|it| self.ends.get(it)).copied().unwrap_or(0);
        let first = self.comments.partition_point(|it| it.0 < from);
        let after = self.comments.partition_point(|it| it.0 < start);
        (self.comments.get(first..after).unwrap_or_default().iter())
            .filter(|it| it.1 <= start)
            .map(|it| it.0)
            .collect()
    }
}
