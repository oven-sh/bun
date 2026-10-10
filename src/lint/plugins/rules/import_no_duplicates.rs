use crate::import_resolve::{Resolved, Resolvers};
use bun_lint_oxlint::import::{ImportImportName, import_declarations, import_entries_of};
use bun_lint_oxlint::module_record::{get_loaded_module, in_hash_order, is_waiting_for_modules, requested_modules};
use bun_lint_oxlint::text::find_next_token_within;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

/// Forbid repeated import of the same module in multiple places.
pub struct NoDuplicates {
    prefer_inline: bool,
    consider_query_string: bool,
}

const IMPORTED_MULTIPLE_TIMES: Message = Message::new("", "'{{module}}' imported multiple times.");
const MODULE: Message = Message::new("", "Module '{{module_name}}' is imported more than once in this file");
const MODULES: Message = Message::new("", "Modules should not be imported multiple times in the same file");

type Imports<'a> = SmallVec<[Import<'a>; 2]>;
/// The keys and the values of `with { key: "value" }`, sorted.
type Attributes<'a> = SmallVec<[(&'a [u8], &'a [u8]); 2]>;

fn attributes_of<'a>(import: Import<'a>) -> Attributes<'a> {
    let bytes = |name: Option<Name<'a>>| name.map_or(&b""[..], Name::bytes);
    let entries = import.attributes().into_iter().flat_map(|it| it.entries());
    let key_and_value = |it: Prop<'a>| (bytes(it.key().and_then(Key::name)), bytes(it.value().and_then(Expr::as_string)));
    let mut attributes: Attributes<'a> = entries.map(key_and_value).collect();
    utils::sort::sort_unstable(&mut attributes);
    attributes
}

impl Rule for NoDuplicates {
    const META: Meta = Meta::plugin(Plugin::Import, "no-duplicates", Kind::Problem)
        .fixable(Fixable::Code)
        .needs_modules()
        .reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicates {
            prefer_inline: options.bool("preferInline").or_else(|| options.bool("prefer-inline")).unwrap_or(false),
            consider_query_string: options.bool_or("considerQueryString", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint looks at the top level only, and at its module records.
        match file.language().is_oxlint {
            true => (!is_waiting_for_modules(file) && import_declarations(file).nth(1).is_some()).then_some(()),
            false => file.stmts_of_kind(StmtTag::Import).nth(1).is_some().then_some(()),
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if !file.language().is_oxlint {
            return self.check_resolved(cx);
        }
        let mut by_specifier: FxHashMap<Name<'a>, Imports<'a>> = FxHashMap::default();
        for import in import_declarations(file) {
            by_specifier.entry(import.spec()).or_default().push(import);
        }
        // The imports of each file, or of each specifier that stands for none. Only of specifiers that follow each other in oxlint's
        // hash map.
        let mut groups: Vec<Imports<'a>> = Vec::new();
        let mut previous_key: Option<Cow<'a, [u8]>> = None;
        for (specifier, _) in in_hash_order(requested_modules(file)) {
            let source = specifier.bytes();
            let resolved_absolute_path = get_loaded_module(file, source).map_or(source, |it| it.path());
            let grouping_key = match strings::index_of_char_usize(source, b'?').filter(|_| self.consider_query_string) {
                Some(query) => Cow::Owned([resolved_absolute_path, source.get(query..).unwrap_or_default()].concat()),
                None => Cow::Borrowed(resolved_absolute_path),
            };
            if previous_key.as_ref() != Some(&grouping_key) {
                groups.push(Imports::new());
            }
            if let (Some(group), Some(imports)) = (groups.last_mut(), by_specifier.get(&specifier)) {
                group.extend(imports.iter().copied());
            }
            previous_key = Some(grouping_key);
        }
        for group in groups.iter().filter(|it| it.len() > 1) {
            if group.iter().all(|it| attributes_of(*it).is_empty()) {
                self.check_group(group, cx);
                continue;
            }
            // With other attributes it is another module.
            let mut attribute_groups: FxHashMap<Attributes<'a>, Imports<'a>> = FxHashMap::default();
            for &import in group {
                attribute_groups.entry(attributes_of(import)).or_default().push(import);
            }
            for group in attribute_groups.values().filter(|it| it.len() > 1) {
                self.check_group(group, cx);
            }
        }
    }
}

impl NoDuplicates {
    /// upstream's `resolver`
    fn resolver<'a>(&self, resolvers: &Resolvers, file: &'a File<'a>, source: &'a [u8]) -> Cow<'a, [u8]> {
        let default_resolver = |path: &'a [u8]| match resolvers.resolve(file, path, false) {
            Resolved::File(found) => Cow::Owned(found),
            Resolved::Nothing | Resolved::Builtin => Cow::Borrowed(path),
        };
        // `/^([^?]*)\?(.*)$/`
        let parts = strings::split_once_char(source, b'?').filter(|it| !strings::contains_js_line_break(it.1));
        match parts.filter(|_| self.consider_query_string) {
            Some((path, query)) => Cow::Owned([&default_resolver(path)[..], b"?", query].concat()),
            None => default_resolver(source),
        }
    }

    /// upstream's `getImportMap`: `imported`, `nsImported`, `defaultTypesImported`, `namedTypesImported`.
    fn import_map(&self, import: Import) -> u8 {
        if !self.prefer_inline && import.is_type_only() {
            return if import.default().is_some() { 2 } else { 3 };
        }
        if !self.prefer_inline && import.named().iter().any(|it| it.is_type_only()) {
            return 3;
        }
        u8::from(import.namespace().is_some())
    }

    /// The plugin's way: the imports of each block, at any depth, by `import_map` and by what its resolvers find.
    fn check_resolved<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let Some(resolvers) = Resolvers::of(file.settings()) else {
            return;
        };
        let imports = || {
            file.stmts_of_kind(StmtTag::Import).filter_map(|it| match it.kind() {
                StmtKind::Import(import) => Some(import),
                _ => None,
            })
        };
        let mut resolved: FxHashMap<Name<'a>, Cow<'a, [u8]>> = FxHashMap::default();
        for specifier in imports().map(Import::spec) {
            resolved.entry(specifier).or_insert_with(|| self.resolver(&resolvers, file, specifier.bytes()));
        }
        let key = |it: Import<'a>| {
            let block = match it.stmt().parent() {
                Node::File(_) => u32::MAX,
                parent => parent.span().start,
            };
            Some((block, self.import_map(it), &**resolved.get(&it.spec())?, it))
        };
        let mut keyed: Vec<(u32, u8, &[u8], Import<'a>)> = imports().filter_map(key).collect();
        utils::sort::sort_unstable_by_key(&mut keyed, |it| (it.0, it.1, it.2, it.3.span().start));
        for group in keyed.chunk_by(|a, b| (a.0, a.1, a.2) == (b.0, b.1, b.2)) {
            if let [(_, _, module, _), _, ..] = group {
                let imports: Imports<'a> = group.iter().map(|it| it.3).collect();
                self.check_duplicates(&imports, Some(*module), cx);
            }
        }
    }

    fn check_group<'a>(&self, group: &[Import<'a>], cx: &Cx<'a, Self>) {
        // Values and, with `preferInline`, types by name; types by name; namespaces; types that are default exports.
        let mut import_entries_maps: [Imports<'a>; 4] = Default::default();
        // An import for the side effects and an `import type` cannot be merged. An import of values can take in either.
        let (mut key0_side_effect_imports, mut key0_type_only_imports) = (Imports::new(), Imports::new());
        let mut key0_has_runtime_specifiers = false;
        let mut push = |key: usize, import: Import<'a>| {
            if let Some(imports) = import_entries_maps.get_mut(key) {
                imports.push(import);
            }
        };
        for &import in group {
            let mut keys = import_entries_of(import).map(|entry| match (entry.import_name, entry.is_type()) {
                (ImportImportName::NamespaceObject(_), _) => 2,
                (ImportImportName::Name(_), true) => usize::from(!self.prefer_inline),
                (ImportImportName::Default(_), true) => 3,
                (_, false) => 0,
            });
            let is_in_key0 = match keys.next() {
                None => {
                    let key = usize::from(import.is_type_only() && !self.prefer_inline);
                    push(key, import);
                    if key == 0 && !import.is_type_only() {
                        key0_side_effect_imports.push(import);
                        continue;
                    }
                    key == 0
                }
                Some(first) => {
                    let mut is_pushed = [false; 4];
                    for key in std::iter::once(first).chain(keys) {
                        if let Some(is_pushed) = is_pushed.get_mut(key).filter(|it| !**it) {
                            *is_pushed = true;
                            push(key, import);
                        }
                    }
                    is_pushed[0]
                }
            };
            if is_in_key0 && import.is_type_only() {
                key0_type_only_imports.push(import);
            } else if is_in_key0 {
                key0_has_runtime_specifiers = true;
            }
        }
        let [key0, others @ ..] = &import_entries_maps;
        match key0_has_runtime_specifiers {
            true => self.check_duplicates(key0, None, cx),
            false => {
                self.check_duplicates(&key0_side_effect_imports, None, cx);
                self.check_duplicates(&key0_type_only_imports, None, cx);
            }
        }
        for imports in others {
            self.check_duplicates(imports, None, cx);
        }
    }

    /// `module`: what the plugin calls the module. oxlint has none.
    fn check_duplicates<'a>(&self, imports: &[Import<'a>], module: Option<&[u8]>, cx: &Cx<'a, Self>) {
        let [first, _, ..] = imports else {
            return;
        };
        let Some(first) = first.spec_span() else {
            return;
        };
        let is_oxlint = module.is_none();
        let fix = |fixer| merge_imports_fix(fixer, self.prefer_inline, is_oxlint, imports);
        // The plugin reports each import, oxlint the first, with a label at each of the others.
        if let Some(module) = module {
            cx.report(first, IMPORTED_MULTIPLE_TIMES).data("module", module.to_vec()).fix(fix);
            for other in imports.iter().skip(1).filter_map(|it| it.spec_span()) {
                cx.report(other, IMPORTED_MULTIPLE_TIMES).data("module", module.to_vec());
            }
            return;
        }
        let mut module_name = cx.slice(first);
        for quote in *b"'\"" {
            let start = module_name.iter().take_while(|b| **b == quote).count();
            module_name = module_name.get(start..).unwrap_or_default();
            let end = module_name.len() - module_name.iter().rev().take_while(|b| **b == quote).count();
            module_name = module_name.get(..end).unwrap_or_default();
        }
        let message = if module_name.len() > 16 { MODULES } else { MODULE };
        let report = cx.report(first, message).data("module_name", module_name);
        let report = report.first_label("It is first imported here");
        let report = report.help("Merge these imports into a single import statement");
        (imports.iter().skip(1).filter_map(|it| it.spec_span()))
            .fold(report, |report, other| report.label(other, ""))
            .fix(fix);
    }
}

/// Where the next two `\n` are from a place on. It is kept for the next question, which is often about the same line.
#[derive(Default)]
struct NextNewlines {
    from: u32,
    /// `None`: nothing was asked yet. In it: there is none.
    found: Option<[Option<u32>; 2]>,
}

impl NextNewlines {
    fn after(&mut self, file: &File, from: u32) -> [Option<u32>; 2] {
        if let Some(found @ [first, _]) = self.found
            && self.from <= from
            && first.is_none_or(|it| from <= it)
        {
            return found;
        }
        let next = |from: u32| Some(from + strings::index_of_char_usize(file.text().get(from as usize..)?, b'\n')? as u32);
        let first = next(from);
        let found = [first, first.and_then(|it| next(it + 1))];
        (self.from, self.found) = (from, Some(found));
        found
    }
}

/// Where the first `brace` is in `within`. oxlint searches the text, so that what is in a string counts.
fn find_brace<'a>(file: &'a File<'a>, within: Span, brace: &str, is_oxlint: bool) -> Option<u32> {
    match is_oxlint {
        true => find_next_token_within(file, within, brace.as_bytes()),
        false => file.tokens_in(within).find(|it| it.is_punctuator(brace)).map(Token::start),
    }
}

fn brace_position(decl: Import, brace: &str, is_oxlint: bool) -> Option<u32> {
    find_brace(decl.stmt().file(), decl.span(), brace, is_oxlint)
}

/// `newlines`: one for what is asked about the comments before the imports, one for the ends of the imports.
fn has_problematic_comments(
    decl: Import,
    [after_comment, after_import]: &mut [NextNewlines; 2],
    is_oxlint: bool,
) -> bool {
    let (file, span) = (decl.stmt().file(), decl.span());
    // The plugin asks the comments next to the import, oxlint the closest, whatever is in between.
    let (mut before, mut after) = match is_oxlint {
        true => (file.comments_in(Span::before(0, span)), file.comments_in(Span::new(span.end, file.span().end))),
        false => (file.comments_before(span), file.comments_after(span)),
    };
    // At most one `\n` is between it and the import. The plugin counts lines.
    let comment_before = before.next_back().filter(|it| !is_oxlint || !it.text().starts_with(b"#!"));
    if comment_before.is_some_and(|it| match is_oxlint {
        true => after_comment.after(file, it.end())[1].is_none_or(|second| second >= span.start),
        false => file.line_of(it.end()) + 1 >= file.line_of(span.start),
    }) {
        return true;
    }
    // None is.
    if after.next().is_some_and(|it| match is_oxlint {
        true => after_import.after(file, span.end)[0].is_none_or(|first| first >= it.start()),
        false => file.line_of(it.start()) == file.line_of(span.end),
    }) {
        return true;
    }
    let braces = brace_position(decl, "{", is_oxlint).zip(brace_position(decl, "}", is_oxlint));
    file.comments_in(span).any(|it| braces.is_none_or(|(open, close)| it.end() <= open || it.start() >= close))
}

struct MergeSpecifier<'a> {
    decl: Import<'a>,
    /// What is between the braces.
    identifiers: &'a [u8],
}

/// upstream's `getFix`
#[cold]
#[inline(never)]
fn merge_imports_fix<'a>(
    fixer: Fixer<'a>,
    prefer_inline: bool,
    is_oxlint: bool,
    decls: &[Import<'a>],
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let (&first, rest) = decls.split_first()?;
    let mut newlines = [NextNewlines::default(), NextNewlines::default()];
    // oxlint merges only what is written alike, without attributes.
    let is_other = |it: &Import<'a>| it.spec() != first.spec() || it.attributes().is_some() || it.phase().is_some();
    if is_oxlint && decls.iter().any(is_other)
        || first.namespace().is_some()
        || has_problematic_comments(first, &mut newlines, is_oxlint)
    {
        return None;
    }
    let mut default_import_names = decls.iter().filter_map(|it| it.default()).map(Ident::name);
    let default_name = default_import_names.next();
    if default_import_names.any(|it| Some(it) != default_name) {
        return None;
    }
    let (mut specifiers, mut unnecessary): (Vec<MergeSpecifier<'a>>, Imports<'a>) = (Vec::new(), Imports::new());
    for &decl in rest {
        if decl.namespace().is_some() || has_problematic_comments(decl, &mut newlines, is_oxlint) {
            continue;
        }
        match brace_position(decl, "{", is_oxlint).zip(brace_position(decl, "}", is_oxlint)) {
            Some((open, close)) => specifiers.push(MergeSpecifier { decl, identifiers: file.slice(Span::new(open + 1, close)) }),
            None if decl.named().is_empty() => unnecessary.push(decl),
            None => {}
        }
    }
    let should_add_default = default_name.filter(|_| first.default().is_none());
    let should_add_specifiers = !specifiers.is_empty();
    if should_add_default.is_none() && !should_add_specifiers && unnecessary.is_empty() {
        return None;
    }
    let first_span = first.span();
    let open_brace = brace_position(first, "{", is_oxlint);
    let close_brace = |open: u32| find_brace(file, Span::new(open + 1, first_span.end), "}", is_oxlint);
    let braces = open_brace.and_then(|open| Some((open, close_brace(open)?)));
    let has_open_brace = open_brace.is_some();
    let import_keyword_end = Span::empty(first_span.start + "import".len() as u32);
    let first_is_empty = first.named().is_empty();
    let first_brace_content = braces.map_or(&b""[..], |(open, close)| file.slice(Span::new(open + 1, close)));
    // oxlint looks at the text: a comment after the `,` hides it.
    let first_has_trailing_comma = match (is_oxlint, braces) {
        (true, _) => !first_is_empty && strings::trim_js_whitespace_end(first_brace_content).ends_with(b","),
        (false, Some((_, close))) => file.token_before(Span::empty(close)).is_some_and(|it| it.is_punctuator(",")),
        (false, None) => false,
    };
    let mut existing: FxHashSet<&[u8]> = FxHashSet::default();
    if !first_is_empty {
        existing.extend(strings::split(first_brace_content, b",").map(strings::trim_js_whitespace));
    }
    // oxlint also where types and values come together.
    let should_inline_type_imports =
        prefer_inline || is_oxlint && (!first.is_type_only() || specifiers.iter().any(|it| !it.decl.is_type_only()));
    let needs_comma = !first_has_trailing_comma && !first_is_empty;
    let specifiers_text =
        build_specifiers_text(&specifiers, &mut existing, needs_comma, should_inline_type_imports, is_oxlint);

    let mut fixes = Vec::with_capacity(decls.len() + 1);
    if should_add_specifiers && should_inline_type_imports && first.is_type_only() {
        if let Some(type_start) = find_next_token_within(file, first_span, b"type") {
            let type_end = type_start + 4;
            // The plugin takes the character after it, whatever it is.
            let after = match file.text().get(type_end as usize..) {
                Some(tail) if !is_oxlint => strings::js_whitespace_len(tail).max(1) as u32,
                tail => u32::from(tail.is_some_and(|it| it.starts_with(b" "))),
            };
            fixes.push(fixer.remove(Span::new(type_start, type_end + after)));
        }
        // The plugin goes by the tokens: `a as b` stays as it is, and a `from` that is imported makes two.
        match is_oxlint {
            true => fixes.extend(first.named().iter().map(|it| fixer.insert_before(it, "type "))),
            false => {
                let known = file.tokens_in(first_span).filter(|it| existing.contains(it.value()));
                fixes.extend(known.map(|it| fixer.insert_before(it, "type ")));
            }
        }
    }
    let in_braces = || [b" {", &specifiers_text[..], b"}"].concat();
    match (should_add_default.map(Name::bytes), has_open_brace, braces) {
        (Some(default_name), false, _) if should_add_specifiers => {
            fixes.push(fixer.insert_before(import_keyword_end, [b" ", default_name, b",", &in_braces()[..], b" from"].concat()));
        }
        (Some(default_name), false, _) => {
            fixes.push(fixer.insert_before(import_keyword_end, [b" ", default_name, b" from"].concat()));
        }
        (Some(default_name), true, Some((open, close))) => {
            fixes.push(fixer.insert_before(import_keyword_end, [b" ", default_name, b","].concat()));
            if should_add_specifiers {
                fixes.push(merge_into_braces(fixer, Span::new(open + 1, close), &specifiers_text, is_oxlint));
            }
        }
        (None, false, _) if should_add_specifiers => match first.default() {
            None => fixes.push(fixer.insert_before(import_keyword_end, [&in_braces()[..], b" from"].concat())),
            Some(first_default) => fixes.push(fixer.insert_after(first_default, [b",", &in_braces()[..]].concat())),
        },
        (None, true, Some((open, close))) => {
            fixes.push(merge_into_braces(fixer, Span::new(open + 1, close), &specifiers_text, is_oxlint));
        }
        _ => {}
    }
    for decl in specifiers.iter().map(|it| it.decl).chain(unnecessary) {
        let span = decl.span();
        let has_newline = file.text().get(span.end as usize) == Some(&b'\n');
        fixes.push(fixer.remove(Span::new(span.start, span.end + u32::from(has_newline))));
    }
    Some(fixes)
}

fn build_specifiers_text<'a>(
    specifiers: &[MergeSpecifier<'a>],
    existing: &mut FxHashSet<&'a [u8]>,
    mut needs_comma: bool,
    inline_type_imports: bool,
    is_oxlint: bool,
) -> Vec<u8> {
    let mut result = Vec::new();
    for specifier in specifiers {
        let (start, is_empty) = (result.len(), specifier.decl.named().is_empty());
        for cur in strings::split(specifier.identifiers, b",") {
            let trimmed = strings::trim_js_whitespace(cur);
            // For the plugin nothing is a name too, once.
            if is_oxlint && trimmed.is_empty() || !existing.insert(trimmed) {
                continue;
            }
            // The first is put after what there is already.
            if result.len() > start || needs_comma && !is_empty && !cur.is_empty() {
                result.push(b',');
            }
            let is_type = inline_type_imports && specifier.decl.is_type_only() && !trimmed.is_empty();
            if is_type {
                result.extend_from_slice(b"type ");
            }
            // The plugin takes it with the blanks around it.
            if !is_oxlint {
                result.extend_from_slice(cur);
            } else if ends_with_line_comment(trimmed) {
                result.extend_from_slice(trimmed);
                result.push(b'\n');
            } else if !is_type && strings::contains_char(cur, b'\n') {
                result.extend_from_slice(strip_leading_inline_whitespace(strings::trim_js_whitespace_end(cur)));
            } else {
                result.extend_from_slice(trimmed);
            }
        }
        needs_comma |= !is_empty;
    }
    result
}

fn ends_with_line_comment(source: &[u8]) -> bool {
    strings::contains(strings::rsplit_once_char(source, b'\n').map_or(source, |it| it.1), b"//")
}

/// Without the blanks that it starts with, up to a line break.
fn strip_leading_inline_whitespace(source: &[u8]) -> &[u8] {
    let line = strings::split_once_char(source, b'\n').map_or(source, |it| it.0);
    source.get(line.len() - strings::trim_js_whitespace_start(line).len()..).unwrap_or(source)
}

/// `inside`: what is between the braces.
fn merge_into_braces(fixer: Fixer, inside: Span, specifiers_text: &[u8], is_oxlint: bool) -> Fix {
    let (content, close) = (fixer.file().slice(inside), inside.end);
    let trailing = content.get(strings::trim_js_whitespace_end(content).len()..).unwrap_or_default();
    // The plugin puts it right before the `}`.
    if !is_oxlint || trailing.is_empty() && !content.is_empty() {
        fixer.insert_before(Span::empty(close), specifiers_text)
    } else if trailing.len() == content.len() {
        fixer.replace(inside, specifiers_text)
    } else {
        fixer.replace(Span::new(close - trailing.len() as u32, close + 1), [specifiers_text, trailing, b"}"].concat())
    }
}
