use bun_lint_oxlint::import::{ImportImportName, import_declarations, import_entries_of};
use bun_lint_oxlint::module_record::{get_loaded_module, in_hash_order, is_waiting_for_modules, requested_modules};
use bun_lint_oxlint::text::find_next_token_within;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

/// Forbid importing the same module multiple times.
pub struct NoDuplicates {
    prefer_inline: bool,
    consider_query_string: bool,
}

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
    attributes.sort_unstable();
    attributes
}

impl Rule for NoDuplicates {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-duplicates", Kind::Suggestion).fixable(Fixable::Code).needs_modules();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicates {
            prefer_inline: options.bool("preferInline").or_else(|| options.bool("prefer-inline")).unwrap_or(false),
            consider_query_string: options.bool_or("considerQueryString", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_waiting_for_modules(file) && import_declarations(file).nth(1).is_some() {
            on.finish(Self::check);
        }
    }
}

impl NoDuplicates {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
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
            true => self.check_duplicates(key0, cx),
            false => {
                self.check_duplicates(&key0_side_effect_imports, cx);
                self.check_duplicates(&key0_type_only_imports, cx);
            }
        }
        for imports in others {
            self.check_duplicates(imports, cx);
        }
    }

    fn check_duplicates<'a>(&self, imports: &[Import<'a>], cx: &Cx<'a, Self>) {
        let [first, _, ..] = imports else {
            return;
        };
        let Some(first) = first.spec_span() else {
            return;
        };
        let mut module_name = cx.slice(first);
        for quote in *b"'\"" {
            let start = module_name.iter().take_while(|b| **b == quote).count();
            module_name = module_name.get(start..).unwrap_or_default();
            let end = module_name.len() - module_name.iter().rev().take_while(|b| **b == quote).count();
            module_name = module_name.get(..end).unwrap_or_default();
        }
        let message = if module_name.len() > 16 { MODULES } else { MODULE };
        cx.report(first, message).data("module_name", module_name).fix(|fixer| merge_imports_fix(fixer, self.prefer_inline, imports));
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

fn brace_position(decl: Import, brace: &[u8]) -> Option<u32> {
    let span = decl.span();
    find_next_token_within(decl.stmt().file(), span.start, span.end, brace)
}

/// `newlines`: one for what is asked about the comments before the imports, one for the ends of the imports.
fn has_problematic_comments(decl: Import, [after_comment, after_import]: &mut [NextNewlines; 2]) -> bool {
    let (file, span) = (decl.stmt().file(), decl.span());
    // At most one `\n` is between it and the import.
    let comment_before = file.comments_in(Span::new(0, span.start)).next_back().filter(|it| !it.text().starts_with(b"#!"));
    if comment_before.is_some_and(|it| after_comment.after(file, it.end())[1].is_none_or(|second| second >= span.start)) {
        return true;
    }
    // None is.
    let comment_after = file.comments_in(Span::new(span.end, file.span().end)).next();
    if comment_after.is_some_and(|it| after_import.after(file, span.end)[0].is_none_or(|first| first >= it.start())) {
        return true;
    }
    let braces = brace_position(decl, b"{").zip(brace_position(decl, b"}"));
    file.comments_in(span).any(|it| braces.is_none_or(|(open, close)| it.end() <= open || it.start() >= close))
}

struct MergeSpecifier<'a> {
    decl: Import<'a>,
    /// What is between the braces.
    identifiers: &'a [u8],
}

fn merge_imports_fix<'a>(fixer: Fixer<'a>, prefer_inline: bool, decls: &[Import<'a>]) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let (&first, rest) = decls.split_first()?;
    let mut newlines = [NextNewlines::default(), NextNewlines::default()];
    if decls.iter().any(|it| it.spec() != first.spec() || it.attributes().is_some() || it.phase().is_some())
        || first.namespace().is_some()
        || has_problematic_comments(first, &mut newlines)
    {
        return None;
    }
    let mut default_import_names = decls.iter().filter_map(|it| it.default()).map(Ident::name);
    let default_name = default_import_names.next();
    if default_import_names.any(|it| Some(it) != default_name) {
        return None;
    }
    let (mut specifiers, mut unnecessary): (Vec<MergeSpecifier<'a>>, Imports<'a>) = (Vec::new(), Imports::new());
    for &decl in rest.iter().filter(|it| it.namespace().is_none() && !has_problematic_comments(**it, &mut newlines)) {
        match brace_position(decl, b"{").zip(brace_position(decl, b"}")) {
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
    let braces = brace_position(first, b"{").and_then(|open| Some((open, find_next_token_within(file, open + 1, first_span.end, b"}")?)));
    let has_open_brace = brace_position(first, b"{").is_some();
    let import_keyword_end = Span::empty(first_span.start + "import".len() as u32);
    let first_is_empty = first.named().is_empty();
    let first_brace_content = braces.map_or(&b""[..], |(open, close)| file.slice(Span::new(open + 1, close)));
    let first_has_trailing_comma = !first_is_empty && text::trim_end(first_brace_content).ends_with(b",");
    let mut existing: FxHashSet<&[u8]> = FxHashSet::default();
    if !first_is_empty {
        existing.extend(strings::split(first_brace_content, b",").map(text::trim));
    }
    let should_inline_type_imports = prefer_inline || !first.is_type_only() || specifiers.iter().any(|it| !it.decl.is_type_only());
    let specifiers_text =
        build_specifiers_text(&specifiers, &mut existing, first_has_trailing_comma, first_is_empty, should_inline_type_imports);

    let mut fixes = Vec::with_capacity(decls.len() + 1);
    if should_add_specifiers && should_inline_type_imports && first.is_type_only() {
        if let Some(type_start) = find_next_token_within(file, first_span.start, first_span.end, b"type") {
            let type_end = type_start + 4;
            let has_space = file.text().get(type_end as usize) == Some(&b' ');
            fixes.push(fixer.remove(Span::new(type_start, type_end + u32::from(has_space))));
        }
        fixes.extend(first.named().iter().map(|it| fixer.insert_before(it, "type ")));
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
                fixes.push(merge_into_braces(fixer, open, close, &specifiers_text));
            }
        }
        (None, false, _) if should_add_specifiers => match first.default() {
            None => fixes.push(fixer.insert_before(import_keyword_end, [&in_braces()[..], b" from"].concat())),
            Some(first_default) => fixes.push(fixer.insert_after(first_default, [b",", &in_braces()[..]].concat())),
        },
        (None, true, Some((open, close))) => fixes.push(merge_into_braces(fixer, open, close, &specifiers_text)),
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
    first_has_trailing_comma: bool,
    first_is_empty: bool,
    inline_type_imports: bool,
) -> Vec<u8> {
    let mut result = Vec::new();
    let mut needs_comma = !first_has_trailing_comma && !first_is_empty;
    for specifier in specifiers {
        let (start, is_empty) = (result.len(), specifier.decl.named().is_empty());
        for cur in strings::split(specifier.identifiers, b",") {
            let trimmed = text::trim(cur);
            if trimmed.is_empty() || !existing.insert(trimmed) {
                continue;
            }
            // The first is put after what there is already.
            if result.len() > start || needs_comma && !is_empty {
                result.push(b',');
            }
            let is_type = inline_type_imports && specifier.decl.is_type_only();
            if is_type {
                result.extend_from_slice(b"type ");
            }
            if ends_with_line_comment(trimmed) {
                result.extend_from_slice(trimmed);
                result.push(b'\n');
            } else if !is_type && strings::contains_char(cur, b'\n') {
                result.extend_from_slice(strip_leading_inline_whitespace(text::trim_end(cur)));
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
    source.get(line.len() - text::trim_start(line).len()..).unwrap_or(source)
}

fn merge_into_braces(fixer: Fixer, open: u32, close: u32, specifiers_text: &[u8]) -> Fix {
    let content = fixer.file().slice(Span::new(open + 1, close));
    let trailing = content.get(text::trim_end(content).len()..).unwrap_or_default();
    if trailing.len() == content.len() {
        fixer.replace(Span::new(open + 1, close), specifiers_text)
    } else if !trailing.is_empty() {
        fixer.replace(Span::new(close - trailing.len() as u32, close + 1), [specifiers_text, trailing, b"}"].concat())
    } else {
        fixer.insert_before(Span::empty(close), specifiers_text)
    }
}
