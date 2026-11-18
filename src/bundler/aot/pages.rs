//! `--desktop`: the scripts of the pages are compiled, and the pages stay as they are.

use core::cell::RefCell;
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use bun_aot::compile::EntryPointPaths;
use bun_aot::options::ImportOfPage;
use bun_ast::E::{JsonValue, ObjectJSON};
use bun_ast::{ExprData, ImportKind, Loader, Loc, Log, Source};
use bun_core::strings;
use bun_js_parser::{ParserOptions, ScanPassResult};
use bun_options_types::aot_options::AotOptions;
use bun_parsers::json::ParsedJson;
use bun_paths::resolve_path::relative_alloc;
use bun_resolver::compiled_program::join_public_file_path;
use bun_resolver::scripts_of_pages::{CLASSIC, LIST, PRELOAD, PRELOAD_PARAMETERS, name_of_inline};
use bun_sema::hir::{CLASSIC_SCRIPT_END, CLASSIC_SCRIPT_START};
use bun_sys::{Fd, File};
use lol_html::html_content::{Element, TextChunk};

use super::options::{expand_entry_points, real_file_path};
use super::output::EntryPointNames;
use super::paths::absolute_path;
use super::services::with_ast_scope;
use crate::HTMLScanner::OutputSink;
use crate::OutputFile;
use crate::bundle_v2::FileMap;
use crate::options::{BundleOptions, OutputKind, Side};
use crate::output_file::{Options, OptionsData};

const AROUND_CLASSIC: [&[u8]; 2] = [CLASSIC_SCRIPT_START, CLASSIC_SCRIPT_END];
const AROUND_MODULE: [&[u8]; 2] = [b"", b""];

/// All paths are absolute.
#[derive(Default)]
pub(crate) struct Pages {
    pub(super) modules: BTreeSet<Vec<u8>>,
    /// What is compiled in place of what the disk has.
    pub(super) texts: BTreeMap<Vec<u8>, Vec<u8>>,
    pub(super) embedded: BTreeSet<Vec<u8>>,
    documents: BTreeSet<Vec<u8>>,
    /// By importer and specifier.
    imports: BTreeMap<(Vec<u8>, Vec<u8>), Option<Vec<u8>>>,
}

pub(super) fn is_page(path: &[u8]) -> bool {
    let extension = bun_paths::extension(path);
    extension.eq_ignore_ascii_case(b".html") || extension.eq_ignore_ascii_case(b".htm")
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Use {
    Classic,
    Module,
    ImportMap,
    Base,
    Link,
    Data,
}

#[derive(Default)]
struct Markup {
    urls: Vec<(Use, Vec<u8>)>,
    /// With the place where they start.
    inline: Vec<(Use, usize, Vec<u8>)>,
    is_in_inline: bool,
}

fn kind_of_script(element: &Element<'_, '_>) -> Option<Use> {
    let written = element.get_attribute("type").unwrap_or_default();
    let written = written.to_ascii_lowercase();
    let is_classic =
        |it: &[u8]| it.is_empty() || it.ends_with(b"javascript") || it.ends_with(b"/ecmascript");
    match written.as_bytes() {
        b"module" => Some(Use::Module),
        b"importmap" => Some(Use::ImportMap),
        other if is_classic(other.trim_ascii()) && !element.has_attribute("nomodule") => {
            Some(Use::Classic)
        }
        _ => None,
    }
}

impl Markup {
    fn element(&mut self, element: &Element<'_, '_>) {
        let (name, start) = (element.tag_name(), element.source_location().bytes().end);
        let rel = element.get_attribute("rel").unwrap_or_default();
        let kind = match name.as_str() {
            "script" => kind_of_script(element),
            "base" => Some(Use::Base),
            "a" | "area" => Some(Use::Link),
            "link" if rel.eq_ignore_ascii_case("modulepreload") => Some(Use::Module),
            _ => Some(Use::Data),
        };
        let is_inline_script = name == "script" && !element.has_attribute("src");
        self.is_in_inline = kind.is_some() && (is_inline_script || name == "style");
        let Some(kind) = kind else { return };
        if self.is_in_inline {
            self.inline.push((kind, start, Vec::new()));
        }
        for attribute in element.attributes() {
            let value = attribute.value().into_bytes();
            match attribute.name().as_str() {
                "src" | "href" | "xlink:href" | "poster" | "data" => self.urls.push((kind, value)),
                "srcset" | "imagesrcset" => {
                    let candidates = strings::split(&value, b",").map(<[u8]>::trim_ascii);
                    let urls = candidates.filter_map(|it| it.split(u8::is_ascii_whitespace).next());
                    self.urls.extend(urls.map(|it| (kind, it.to_vec())));
                }
                "style" => self.inline.push((Use::Data, start, value)),
                _ => {}
            }
        }
    }

    fn text(&mut self, chunk: &TextChunk<'_>) {
        if let Some(last) = self.inline.last_mut().filter(|_| self.is_in_inline) {
            last.2.extend_from_slice(chunk.as_str().as_bytes());
        }
    }

    fn parse(html: &[u8]) -> Markup {
        let markup = RefCell::new(Markup::default());
        let handlers = |selector: &str, element, text| {
            let selector = selector.parse().expect("the selector is valid");
            let comments = None;
            let handlers = lol_html::ElementContentHandlers {
                element,
                comments,
                text,
            };
            (Cow::Owned(selector), handlers)
        };
        let element: lol_html::ElementHandler<'_> = Box::new(|element: &mut Element<'_, '_>| {
            markup.borrow_mut().element(element);
            Ok(())
        });
        let text: lol_html::TextHandler<'_> = Box::new(|chunk: &mut TextChunk<'_>| {
            markup.borrow_mut().text(chunk);
            Ok(())
        });
        let settings = lol_html::Settings {
            element_content_handlers: vec![
                handlers("*", Some(element), None),
                handlers("script, style", None, Some(text)),
            ],
            strict: false,
            ..lol_html::Settings::new()
        };
        let sink = OutputSink::Callback(Box::new(|_: &[u8]| {}));
        let mut rewriter = lol_html::HtmlRewriter::new(settings, sink);
        // What was found so far counts.
        let _ = rewriter.write(html).and_then(|()| rewriter.end());
        markup.into_inner()
    }
}

/// `url(a)` and `@import "a"`.
fn urls_in_css(css: &[u8]) -> impl Iterator<Item = &[u8]> {
    let after = |start: &'static [u8]| strings::split(css, start).skip(1).map(<[u8]>::trim_ascii);
    let quoted = |rest: &'_ [u8]| matches!(rest.first(), Some(b'"' | b'\''));
    let imports = after(b"@import").filter(move |it| quoted(it));
    after(b"url(").chain(imports).filter_map(move |rest| {
        let (rest, end) = match quoted(rest) {
            true => (&rest[1..], rest[0]),
            false => (rest, b')'),
        };
        Some(strings::split_once_char(rest, end)?.0.trim_ascii())
    })
}

/// The string at the start, unless it has to be evaluated, and what follows it.
fn split_string(code: &[u8]) -> Option<(&[u8], &[u8])> {
    let (&quote @ (b'"' | b'\'' | b'`'), rest) = code.trim_ascii_start().split_first()? else {
        return None;
    };
    let (text, rest) = strings::split_once_char(rest, quote)?;
    (strings::index_of_any(text, b"\\$\n").is_none()).then(|| (text, rest.trim_ascii_start()))
}

fn strings_after<'a>(
    code: &'a [u8],
    start: &'a [u8],
) -> impl Iterator<Item = (&'a [u8], &'a [u8])> {
    strings::split(code, start).skip(1).filter_map(split_string)
}

fn is_bare(specifier: &[u8]) -> bool {
    !matches!(
        specifier,
        [b'/', ..] | [b'.', b'/', ..] | [b'.', b'.', b'/', ..]
    )
}

fn has_scheme(url: &[u8]) -> bool {
    strings::contains_char(strings::split(url, b"/").next().unwrap_or_default(), b':')
}

fn is_below(path: &[u8], directory: &[u8]) -> bool {
    let is_separator = |it: &u8| bun_paths::is_sep_native(*it);
    path.strip_prefix(directory).is_some_and(|rest| {
        directory.last().is_some_and(is_separator) || rest.first().is_none_or(is_separator)
    })
}

/// The directory that has the outermost `node_modules`, and the one of the innermost package.
fn find_package(path: &[u8]) -> Option<(&[u8], &[u8])> {
    const NODE_MODULES: &[u8] = bun_paths::NODE_MODULES_NEEDLE;
    let start = strings::last_index_of(path, NODE_MODULES)? + NODE_MODULES.len();
    let end_of_name = |start: usize| {
        let length = path[start..]
            .iter()
            .position(|&it| bun_paths::is_sep_native(it));
        length.map_or(path.len(), |it| start + it)
    };
    let end = match (path.get(start), end_of_name(start)) {
        (Some(b'@'), scope) if scope < path.len() => end_of_name(scope + 1),
        (_, end) => end,
    };
    Some((
        &path[..strings::index_of(path, NODE_MODULES)?],
        &path[..end],
    ))
}

/// What the scripts of a page have in common.
#[derive(Clone, Default, PartialEq, Eq)]
struct Context {
    base: Vec<u8>,
    /// Scope, specifier and address.
    import_map: Vec<[Vec<u8>; 3]>,
}

impl Context {
    fn add_import_map(&mut self, text: &[u8]) {
        let source = Source::init_path_string(&b"importmap.json"[..], text);
        let Ok(parsed) = ParsedJson::parse_json(&source, &mut Log::init()) else {
            return;
        };
        let ExprData::EObjectJSON(root) = &parsed.root.data else {
            return;
        };
        let object = |key: &[u8]| root.get().get(key).and_then(JsonValue::as_object);
        let mut add = |scope: &[u8], imports: Option<&ObjectJSON>| {
            for it in imports.map_or(&[][..], ObjectJSON::properties) {
                let address = it.value.as_str().unwrap_or_default();
                (self.import_map).push([scope, it.key.slice(), address].map(<[u8]>::to_vec));
            }
        };
        add(b"", object(b"imports"));
        for scope in object(b"scopes").map_or(&[][..], ObjectJSON::properties) {
            add(scope.key.slice(), scope.value.as_object());
        }
    }

    /// In any scope.
    fn addresses_of(&self, specifier: &[u8]) -> BTreeSet<Vec<u8>> {
        let mut found: BTreeMap<&[u8], (usize, Vec<u8>)> = BTreeMap::new();
        for [scope, key, address] in &self.import_map {
            if let Some(rest) = specifier.strip_prefix(&key[..])
                && (rest.is_empty() || key.ends_with(b"/"))
                && found.get(&scope[..]).is_none_or(|it| it.0 < key.len())
            {
                found.insert(scope, (key.len(), [address, rest].concat()));
            }
        }
        found.into_values().map(|it| it.1).collect()
    }
}

/// As the parser passes it on.
fn normalize_newlines(text: &[u8]) -> Vec<u8> {
    strings::replace_owned(&strings::replace_owned(text, b"\r\n", b"\n"), b"\r", b"\n")
}

struct Search<'a> {
    pages: Pages,
    options: &'a BundleOptions<'a>,
    file_map: Option<&'a FileMap>,
    shipped: &'a [Vec<u8>],
    /// Where URLs may lead, as written and with links followed.
    directories: Vec<Vec<u8>>,
    visited: Vec<u8>,
    /// With the file that names it.
    refused: BTreeMap<Vec<u8>, Vec<u8>>,
    seen: BTreeSet<Vec<u8>>,
    waiting: Vec<Vec<u8>>,
    contexts: Vec<Context>,
    /// With the number of the context.
    seen_scripts: BTreeSet<(Vec<u8>, Use, usize)>,
    waiting_scripts: Vec<(Vec<u8>, Use, usize)>,
}

impl Search<'_> {
    fn read(&self, path: &[u8]) -> Option<Vec<u8>> {
        match self.file_map.and_then(|it| it.get(path)) {
            Some(text) => Some(text.to_vec()),
            None => File::read_from(Fd::cwd(), path).ok(),
        }
    }

    fn is_file(&self, path: &[u8]) -> bool {
        self.file_map.is_some_and(|it| it.contains(path))
            || bun_sys::stat(&bun_core::ZBox::from_bytes(path))
                .is_ok_and(|it| bun_sys::S::ISREG(it.st_mode as _))
    }

    fn allow(&mut self, directory: &[u8]) {
        self.directories.push(directory.to_vec());
        self.directories.extend(real_file_path(directory));
    }

    fn is_allowed(&self, path: &[u8]) -> bool {
        self.directories.iter().any(|it| is_below(path, it))
    }

    fn is_of_project(&self, path: &[u8]) -> bool {
        let real = real_file_path(path);
        let Some((installed_in, package)) = find_package(path) else {
            return self.is_allowed(path) && real.is_none_or(|it| self.is_allowed(&it));
        };
        let is_above = || (self.directories.iter()).any(|it| is_below(it, installed_in));
        (self.is_allowed(installed_in) || is_above())
            && (real.zip(real_file_path(package))).is_none_or(|it| is_below(&it.0, &it.1))
    }

    fn refuses(&mut self, path: &[u8]) -> bool {
        let refuses = !self.is_of_project(path);
        if refuses {
            self.refused.insert(path.to_vec(), self.visited.clone());
        }
        refuses
    }

    /// What `/` stands for is up to the app: the nearest directory of the project that has the file.
    fn find(&self, directory: &[u8], url: &[u8]) -> Option<Vec<u8>> {
        let url = url.trim_ascii();
        let url = &url[..strings::index_of_any(url, b"?#").unwrap_or(url.len())];
        if url.is_empty() || url.starts_with(b"//") || has_scheme(url) {
            return None;
        }
        let url = bun_url::PercentEncoding::decode_lenient_alloc(url);
        let Some(below) = url.strip_prefix(b"/") else {
            return Some(absolute_path(directory, &url)).filter(|it| self.is_file(it));
        };
        let above = |it: &&[u8]| bun_core::dirname(it).map(<[u8]>::len);
        core::iter::successors(Some(directory), |it| Some(&directory[..above(it)?]))
            .filter(|it| self.is_allowed(it))
            .map(|it| absolute_path(it, below))
            .find(|it| self.is_file(it))
    }

    fn add_text(&mut self, path: &[u8], end: &[u8], around: [&[u8]; 2]) -> bool {
        let Some(text) = self.read(path) else {
            return false;
        };
        let text = strings::without_utf8_bom(&text);
        // The page says what else it is.
        if strings::is_valid_utf8(text) {
            let mut text = [around[0], text, around[1]].concat();
            if let [start @ b'#', next @ b'!', ..] = &mut text[around[0].len()..] {
                (*start, *next) = (b'/', b'/');
            }
            self.pages.texts.insert([path, end].concat(), text);
        } else {
            self.embed(path);
        }
        true
    }

    fn embed(&mut self, path: &[u8]) {
        if !self.shipped.iter().any(|it| is_below(path, it)) {
            self.pages.embedded.insert(path.to_vec());
        }
    }

    fn follow(&mut self, path: Vec<u8>) {
        if self.seen.insert(path.clone()) && !self.refuses(&path) {
            self.waiting.push(path);
        }
    }

    fn follow_script(&mut self, path: Vec<u8>, kind: Use, context: usize) {
        if !self.refuses(&path) {
            self.follow_import(path, kind, context);
        }
    }

    fn follow_import(&mut self, path: Vec<u8>, kind: Use, context: usize) {
        if self.seen_scripts.insert((path.clone(), kind, context)) {
            self.waiting_scripts.push((path, kind, context));
        }
    }

    fn loader_of(&self, path: &[u8]) -> Loader {
        self.options.loader(bun_paths::extension(path))
    }

    /// And whether only a module can be written like that.
    fn imports_in(&self, code: &[u8], loader: Loader) -> (Vec<Vec<u8>>, bool) {
        if !strings::contains(code, b"import") && !strings::contains(code, b"export") {
            return (Vec::new(), false);
        }
        with_ast_scope(|arena| {
            let source = Source::init_path_string(loader.stdin_name(), code);
            let options = ParserOptions::init(self.options.jsx.clone(), loader);
            let (mut found, define) = (ScanPassResult::init(), &self.options.define);
            // What was found so far counts.
            let _ = crate::cache::JavaScript::init().scan(
                arena,
                &mut found,
                options,
                define,
                &mut Log::init(),
                &source,
            );
            let records = found.import_records.iter();
            let is_module =
                found.has_export_statement || records.clone().any(|it| it.kind == ImportKind::Stmt);
            let imports =
                records.filter(|it| matches!(it.kind, ImportKind::Stmt | ImportKind::Dynamic));
            (imports.map(|it| it.path.text.to_vec()).collect(), is_module)
        })
    }

    /// `None` if it is no URL: Bun resolves it.
    fn resolve(
        &mut self,
        from: &[u8],
        specifier: &[u8],
        context: usize,
    ) -> Option<Option<Vec<u8>>> {
        let page = &self.contexts[context];
        let addresses = page.addresses_of(specifier);
        let mut files: Vec<_> = (addresses.iter())
            .map(|it| self.find(&page.base, it))
            .collect();
        if files.is_empty() && !is_bare(specifier) {
            files.push(self.find(from, specifier));
            if files == [None] && specifier.starts_with(b".") {
                return None;
            }
        } else if files.is_empty() {
            let is_built_in = specifier.starts_with(b"node:") || specifier.starts_with(b"bun:");
            return (has_scheme(specifier) && !is_built_in).then_some(None);
        }
        let mut is_linked = files.len() == 1;
        for file in files.iter().flatten() {
            match self.loader_of(file) {
                Loader::Json => {}
                loader if loader.is_java_script_like() => {
                    self.follow_import(file.clone(), Use::Module, context);
                }
                _ => {
                    is_linked = false;
                    self.follow(file.clone());
                }
            }
        }
        Some(files.pop().flatten().filter(|_| is_linked))
    }

    fn visit_code(&mut self, compiled_as: &[u8], loader: Loader, code: &[u8], context: usize) {
        let directory = bun_core::dirname(compiled_as).unwrap_or_default();
        for specifier in self.imports_in(code, loader).0 {
            if let Some(file) = self.resolve(directory, &specifier, context) {
                let key = (compiled_as.to_vec(), specifier);
                let known = self
                    .pages
                    .imports
                    .entry(key)
                    .or_insert_with(|| file.clone());
                known.take_if(|it| Some(&*it) != file.as_ref());
            }
        }
        let base = self.contexts[context].base.clone();
        let mut workers = Vec::new();
        for call in strings::split(code, b"Worker(").skip(1) {
            let call = call.trim_ascii_start();
            let (from, call) = match call.strip_prefix(b"\"\"+").unwrap_or(call) {
                [b'n', b'e', b'w', b' ', b'U', b'R', b'L', b'(', url @ ..] => (directory, url),
                url => (&base[..], url),
            };
            if let Some((url, rest)) = split_string(call)
                && let Some(path) = self.find(from, url)
            {
                let options = &rest[..rest.len().min(80)];
                let is_module = strings_after(options, b"type:").any(|it| it.0 == b"module");
                let kind = if is_module { Use::Module } else { Use::Classic };
                self.follow_script(path, kind, context);
                workers.push(url);
            }
        }
        let beside_module = strings_after(code, b"URL(").filter(|(url, rest)| {
            let base = rest.strip_prefix(b",").unwrap_or_default();
            base.trim_ascii_start().starts_with(b"import.meta.url") && !workers.contains(url)
        });
        let worklets = strings_after(code, b"addModule(").map(|it| (&base[..], it.0));
        for (from, url) in beside_module.map(|it| (directory, it.0)).chain(worklets) {
            if let Some(path) = self.find(from, url) {
                self.follow(path);
            }
        }
        for mut rest in strings::split(code, b"importScripts(").skip(1) {
            while let Some((url, after)) = split_string(rest) {
                if let Some(path) = self.find(directory, url) {
                    self.follow_script(path, Use::Classic, context);
                }
                rest = after.strip_prefix(b",").unwrap_or_default();
            }
        }
    }

    fn visit_script(&mut self, path: &[u8], kind: Use, context: usize) {
        let (loader, end, around) = match kind {
            Use::Classic => (Loader::Js, CLASSIC, AROUND_CLASSIC),
            _ => (self.loader_of(path), &b""[..], AROUND_MODULE),
        };
        // No browser runs the others, so they mean what they mean to Bun.
        if matches!(bun_paths::extension(path), b".js" | b".mjs") || kind == Use::Classic {
            self.add_text(path, end, around);
        }
        if kind == Use::Module && loader.is_java_script_like() {
            self.pages.modules.insert(path.to_vec());
        }
        if let Some(code) = self.read(path) {
            self.visit_code(&[path, end].concat(), loader, &code, context);
        }
    }

    fn number_of(&mut self, context: Context) -> usize {
        (self.contexts.iter().position(|it| *it == context)).unwrap_or_else(|| {
            self.contexts.push(context);
            self.contexts.len() - 1
        })
    }

    fn follow_css(&mut self, directory: &[u8], css: &[u8]) {
        for url in urls_in_css(css) {
            if let Some(path) = self.find(directory, url) {
                self.follow(path);
            }
        }
    }

    fn visit_page(&mut self, directory: &[u8], html: &[u8]) {
        let html = normalize_newlines(strings::without_utf8_bom(html));
        let Markup { urls, inline, .. } = Markup::parse(&html);
        let base = urls.iter().find(|it| it.0 == Use::Base);
        let base = base.filter(|it| it.1.starts_with(b".") && it.1.ends_with(b"/"));
        let base = base.map_or_else(|| directory.to_vec(), |it| absolute_path(directory, &it.1));
        let mut context = Context {
            base: base.clone(),
            import_map: Vec::new(),
        };
        let import_maps = inline.iter().filter(|it| it.0 == Use::ImportMap);
        import_maps.for_each(|it| context.add_import_map(&it.2));
        let context = self.number_of(context);
        for (kind, url) in urls {
            let Some(path) = self.find(&base, &url) else {
                continue;
            };
            match kind {
                Use::Classic | Use::Module => self.follow_script(path, kind, context),
                Use::Link if !is_page(&path) => {}
                Use::Link | Use::Data => self.follow(path),
                Use::Base | Use::ImportMap => {}
            }
        }
        for (kind, start, text) in inline {
            if kind == Use::Data {
                self.follow_css(&base, &text);
            }
            if !matches!(kind, Use::Classic | Use::Module) {
                continue;
            }
            // Stacks have the lines and columns of the page.
            let lines = strings::count_char(&html[..start], b'\n');
            let line = html[..start].iter().rev().take_while(|it| **it != b'\n');
            let (lines, columns) = (b"\n".repeat(lines), b" ".repeat(line.count()));
            let [before, after] = match kind {
                Use::Module => AROUND_MODULE,
                _ => AROUND_CLASSIC,
            };
            let path = absolute_path(&base, &name_of_inline(&text, kind == Use::Module));
            self.visit_code(&path, Loader::Js, &text, context);
            (self.pages.texts)
                .entry(path)
                .or_insert_with(|| [before, &lines, &columns, &text, after].concat());
        }
    }

    fn visit(&mut self, path: &[u8]) {
        self.embed(path);
        let is_css = bun_paths::extension(path).eq_ignore_ascii_case(b".css");
        if !is_css && !is_page(path) {
            return;
        }
        let (Some(text), Some(directory)) = (self.read(path), bun_core::dirname(path)) else {
            return;
        };
        match is_css {
            true => self.follow_css(directory, &text),
            false => {
                self.pages.documents.insert(path.to_vec());
                self.visit_page(directory, &text);
            }
        }
    }
}

impl Pages {
    pub(super) fn find(
        (aot, options): (&AotOptions, &BundleOptions<'_>),
        entry_points: &[&[u8]],
        working_directory: &[u8],
        file_map: Option<&FileMap>,
        log: &mut Log,
    ) -> Option<Pages> {
        if !aot.has_realms_of_the_web {
            return Some(Pages::default());
        }
        let given = entry_points.iter().filter(|it| is_page(it)).copied();
        let listed: Vec<&[u8]> = given
            .chain(aot.pages.listed.iter().map(|it| &it[..]))
            .collect();
        let listed = expand_entry_points(&listed, working_directory, file_map, log);
        let preloads = expand_entry_points(&aot.pages.preloads, working_directory, file_map, log);
        let project = match (&options.root_dir[..], &aot.pages.app_directory[..]) {
            ([], []) => working_directory.to_vec(),
            ([], directory) | (directory, _) => absolute_path(working_directory, directory),
        };
        let mut search = Search {
            pages: Pages::default(),
            options,
            file_map,
            shipped: &aot.pages.shipped,
            directories: Vec::new(),
            visited: Vec::new(),
            refused: BTreeMap::new(),
            seen: BTreeSet::new(),
            waiting: Vec::new(),
            contexts: Vec::new(),
            seen_scripts: BTreeSet::new(),
            waiting_scripts: Vec::new(),
        };
        search.allow(&project);
        aot.pages.shipped.iter().for_each(|it| search.allow(it));
        let start = format!("module.exports=function({PRELOAD_PARAMETERS}){{");
        let listed = listed?.into_iter().map(|it| (it, false));
        let mut has_all = true;
        for (written, is_preload) in listed.chain(preloads?.into_iter().map(|it| (it, true))) {
            let path = absolute_path(working_directory, &written);
            let real = real_file_path(&path);
            for path in [&path].into_iter().chain(&real).filter(|_| !is_preload) {
                search.allow(bun_core::dirname(path).unwrap_or_default());
            }
            let is_there = match (is_preload, is_page(&path)) {
                (true, _) => search.add_text(&path, PRELOAD, [start.as_bytes(), b"\n}"]),
                (false, false) => {
                    let base = bun_core::dirname(&path).unwrap_or_default().to_vec();
                    let context = search.number_of(Context {
                        base,
                        import_map: Vec::new(),
                    });
                    let code = search.read(&path).unwrap_or_default();
                    let is_module = !matches!(bun_paths::extension(&path), b".js" | b".cjs")
                        || search.imports_in(&code, Loader::Js).1;
                    let kind = if is_module { Use::Module } else { Use::Classic };
                    search.follow_script(path.clone(), kind, context);
                    search.is_file(&path)
                }
                (false, true) => {
                    search.follow(path.clone());
                    search.is_file(&path)
                }
            };
            if !is_there {
                has_all = false;
                let path = bun_core::fmt::quote(&written);
                log.add_error_fmt(None, Loc::EMPTY, format_args!("Failed to read {path}"));
            }
        }
        loop {
            if let Some(path) = search.waiting.pop() {
                search.visited.clone_from(&path);
                search.visit(&path);
            } else if let Some((path, kind, context)) = search.waiting_scripts.pop() {
                search.visited.clone_from(&path);
                search.visit_script(&path, kind, context);
            } else {
                break;
            }
        }
        for (file, named_by) in &search.refused {
            has_all = false;
            let [file, named_by, project] =
                [file, named_by, &project].map(|it| bun_core::fmt::quote(it));
            let message = format_args!(
                "{named_by} loads {file}, which is outside of {project}. To embed it, pass --root with a directory that has both"
            );
            log.add_error_fmt(None, Loc::EMPTY, message);
        }
        has_all.then_some(search.pages)
    }

    pub(super) fn is_empty(&self) -> bool {
        self.embedded.is_empty() && self.texts.is_empty() && self.modules.is_empty()
    }

    /// The files that the executable has in some form.
    pub(super) fn files(&self) -> BTreeSet<Vec<u8>> {
        let compiled = (self.texts.keys()).filter_map(|it| {
            it.strip_suffix(CLASSIC)
                .or_else(|| it.strip_suffix(PRELOAD))
        });
        (compiled.map(<[u8]>::to_vec))
            .chain(self.embedded.iter().cloned())
            .collect()
    }

    pub(super) fn entry_points(&self) -> BTreeSet<Vec<u8>> {
        let paths = self.modules.iter().chain(self.texts.keys());
        paths.cloned().collect()
    }

    pub(super) fn imports(&self) -> Vec<ImportOfPage> {
        let imports = self.imports.clone().into_iter();
        let of_page = |((importer, specifier), file)| ImportOfPage {
            importer,
            specifier,
            file,
        };
        imports.map(of_page).collect()
    }

    pub(super) fn classic_scripts(&self) -> Vec<(Vec<u8>, Vec<u8>)> {
        (self.texts.keys())
            .filter_map(|it| Some((it.strip_suffix(CLASSIC)?.to_vec(), it.clone())))
            .collect()
    }

    pub(super) fn modules_as_written(&self) -> Vec<Vec<u8>> {
        let is_module = |it: &&Vec<u8>| !it.ends_with(CLASSIC) && !it.ends_with(PRELOAD);
        self.texts.keys().filter(is_module).cloned().collect()
    }

    pub(super) fn list(
        &self,
        entry_points: &[EntryPointPaths],
        root_directory: &[u8],
        names: &EntryPointNames<'_>,
    ) -> Option<OutputFile> {
        let (root, levels) = (names.module_prefix, names.levels_above_root);
        let documents = self.documents.iter().filter_map(|it| {
            let relative = relative_alloc(root_directory, it).ok()?;
            join_public_file_path(root, levels, root, &[b"./", &relative[..]].concat())
        });
        let scripts = entry_points.iter().filter(|it| it.is_loaded_by_page);
        let paths: Vec<_> = (scripts.map(|it| it.public_path.clone()))
            .chain(documents)
            .collect();
        let data = paths.join(&b'\n').into_boxed_slice();
        (!data.is_empty()).then(|| {
            OutputFile::init(Options {
                size: Some(data.len()),
                data: OptionsData::Buffer { data },
                output_path: LIST.into(),
                input_loader: Loader::File,
                loader: Loader::File,
                output_kind: OutputKind::Asset,
                side: Some(Side::Client),
                ..Default::default()
            })
        })
    }
}
