#![cfg(not(miri))]

use super::*;
use crate::fold::{FoldInputs, FoldOptions};
use crate::hir_from_data::{DataModule, DataModuleTree, DataValue, HostValue, module_from_data};
use crate::resolve::{
    CodeHost, CodeImportKind, CodeOptions, CodeParseRequest, CodeRead, CodeRequest, FinishedFile,
    HostPayload, HostResolution, LoaderRequest, MacroRequest, ParsedCode, TransformRequest,
    TreeChange, is_declaration_file_name,
};
use bun_threading::io_thread_pool;
use std::sync::Once;
use std::time::{Duration, Instant};

pub(super) const TEXT_LOADER: HostLoader = HostLoader(1);
pub(super) const NATIVE_ADDON_LOADER: HostLoader = HostLoader(2);

const MAX_STRING_BYTES: usize = 1 << 16;
const EXPRESSION_EXPECTED: u32 = 1109;

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum HostEvent {
    ReadCode(Vec<u8>),
    StartedBackgroundReads(Vec<Vec<u8>>),
    BackgroundRead(Vec<u8>),
    FinishedDeferredReads,
    ParsedCode(Vec<u8>),
    RanMacros { pending_calls: usize },
    TransformedTree(Vec<u8>),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct RecordedLoaderRequest {
    pub(super) path: Vec<u8>,
    pub(super) kind: CodeImportKind,
    pub(super) type_attribute: Option<Vec<u8>>,
    pub(super) embed_attribute: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct ParsePayload {
    pub(super) path: Vec<u8>,
    pub(super) reads_jsdoc: bool,
}

pub(super) struct StatementsHost {
    pub(super) files: &'static [(&'static str, &'static str)],
    pub(super) claims: Vec<(&'static str, HostResolution)>,
    pub(super) runtime_modules: Vec<(&'static str, HostResolution)>,
    pub(super) code_request_count: AtomicUsize,
    pub(super) deferred: &'static [(&'static str, ScriptKind)],
    pub(super) unfinished: Guarded<Vec<Vec<u8>>>,
    pub(super) has_finished_reads: AtomicBool,
    pub(super) read_by_plugin: &'static [(&'static str, &'static str)],
    pub(super) has_waited_in_vain: AtomicBool,
    pub(super) background_readable: &'static [&'static str],
    pub(super) rejects_background_reads: bool,
    pub(super) loaders: &'static [(&'static str, Option<&'static str>, HostLoader)],
    pub(super) loader_requests: Guarded<Vec<RecordedLoaderRequest>>,
    pub(super) plugin_sources: &'static [&'static str],
    pub(super) implied: Vec<(&'static str, Vec<HostResolution>)>,
    pub(super) max_macro_values: usize,
    pub(super) macro_round_count: AtomicUsize,
    pub(super) transformed: &'static [&'static str],
    pub(super) events: Guarded<Vec<HostEvent>>,
    pub(super) is_case_sensitive: bool,
    pub(super) threads: usize,
    pub(super) io_pool: Option<io_thread_pool::Ref>,
}

impl Default for StatementsHost {
    fn default() -> StatementsHost {
        StatementsHost {
            files: &[],
            claims: Vec::new(),
            runtime_modules: Vec::new(),
            code_request_count: AtomicUsize::new(0),
            deferred: &[],
            unfinished: Guarded::new(Vec::new()),
            has_finished_reads: AtomicBool::new(false),
            read_by_plugin: &[],
            has_waited_in_vain: AtomicBool::new(false),
            background_readable: &[],
            rejects_background_reads: false,
            loaders: &[],
            loader_requests: Guarded::new(Vec::new()),
            plugin_sources: &[],
            implied: Vec::new(),
            max_macro_values: 0,
            macro_round_count: AtomicUsize::new(0),
            transformed: &[],
            events: Guarded::new(Vec::new()),
            is_case_sensitive: true,
            threads: 1,
            io_pool: None,
        }
    }
}

impl StatementsHost {
    pub(super) fn with_process_io_pool(self, threads: usize) -> StatementsHost {
        static OUTPUT: Once = Once::new();
        OUTPUT.call_once(bun_core::output::stdio::init);
        StatementsHost {
            threads,
            io_pool: Some(io_thread_pool::acquire().into()),
            ..self
        }
    }

    fn wait_until_parsed(&self, path: &str) {
        let awaited = HostEvent::ParsedCode(path.as_bytes().to_vec());
        let deadline = Instant::now() + Duration::from_secs(30);
        while !self.events.lock().contains(&awaited) {
            if Instant::now() > deadline {
                self.has_waited_in_vain.store(true, Ordering::Relaxed);
                return;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    pub(super) fn events(&self) -> Vec<HostEvent> {
        self.events.lock().clone()
    }

    pub(super) fn loader_requests(&self) -> Vec<RecordedLoaderRequest> {
        self.loader_requests.lock().clone()
    }

    pub(super) fn code_request_count(&self) -> usize {
        self.code_request_count.load(Ordering::Relaxed)
    }

    fn record(&self, event: HostEvent) {
        self.events.lock().push(event);
    }

    fn is_at_path(&self, file: &str, path: &[u8]) -> bool {
        is_same_path(file.as_bytes(), path, self.is_case_sensitive)
    }

    fn find_by_path<'t, T>(&self, table: &'t [(&'static str, T)], path: &[u8]) -> Option<&'t T> {
        let entry = table.iter().find(|entry| self.is_at_path(entry.0, path))?;
        Some(&entry.1)
    }

    fn lists_path(&self, paths: &[&'static str], path: &[u8]) -> bool {
        paths.iter().any(|listed| self.is_at_path(listed, path))
    }

    fn has_finished_reads(&self) -> bool {
        self.has_finished_reads.load(Ordering::Relaxed)
    }

    fn child_name<'p>(&self, directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
        let (start, rest) = path.split_at_checked(directory.len())?;
        if !is_same_path(start, directory, self.is_case_sensitive) {
            return None;
        }
        let rest = match directory.ends_with(b"/") {
            true => rest,
            false => rest.strip_prefix(b"/")?,
        };
        let name = strings::split(rest, b"/").next()?;
        (!name.is_empty()).then_some(name)
    }

    fn file_kind(&self, path: &[u8]) -> FileKind {
        let plugin_language = self.script_kind(path);
        if plugin_language.is_none() && is_declaration_file_name(path) {
            return FileKind::Declaration;
        }
        match plugin_language.or_else(|| ScriptKind::from_file_name(path)) {
            Some(ScriptKind::Ts) | None => FileKind::Ts,
            Some(ScriptKind::Tsx | ScriptKind::Js | ScriptKind::Jsx) => FileKind::Tsx,
        }
    }
}

fn find_by_specifier(table: &[(&'static str, HostResolution)], specifier: &[u8]) -> HostResolution {
    let entry = table.iter().find(|entry| entry.0.as_bytes() == specifier);
    entry.map_or(HostResolution::Unclaimed, |entry| entry.1.clone())
}

impl Host for StatementsHost {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let text: &'static str = self.find_by_path(self.files, path)?;
        Some(Cow::Borrowed(text.as_bytes()))
    }

    fn is_file(&self, path: &[u8]) -> bool {
        self.find_by_path(self.files, path).is_some()
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        let is_same = |directory: &[u8]| is_same_path(directory, path, self.is_case_sensitive);
        let mut directories =
            (self.files.iter()).flat_map(|file| ancestors(dirname::<Posix>(file.0.as_bytes())));
        directories.any(is_same)
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        path.to_vec()
    }

    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        let names = (self.files.iter()).filter_map(|file| self.child_name(path, file.0.as_bytes()));
        let mut names: Vec<Vec<u8>> = names.map(<[u8]>::to_vec).collect();
        names.shared_sort();
        names.dedup();
        names
    }

    fn is_case_sensitive(&self) -> bool {
        self.is_case_sensitive
    }

    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        let language = self.find_by_path(self.deferred, path).copied();
        language.filter(|_| self.has_finished_reads())
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }

    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> hir::File<'s> {
        let file = FileBuilder {
            kind: self.file_kind(path),
            is_js: is_javascript_file(self, path),
            legacy_decorators: options.experimental_decorators,
            source_len: text.len() as u32,
            ..FileBuilder::default()
        };
        StatementParser::parse(file, text, atoms, arena)
    }

    fn parse_package_json(&self, _arena: &Arena, text: &[u8]) -> Option<Json> {
        let (name, version) = strings::rsplit_once_char(text, b'@')?;
        if name.is_empty() {
            return None;
        }
        let field = |key: &[u8], value: &[u8]| (key.to_vec(), Json::String(value.to_vec()));
        let fields = vec![field(b"name", name), field(b"version", version)];
        Some(Json::object(fields))
    }

    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        let next = AtomicUsize::new(0);
        let run = || {
            loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= count {
                    break;
                }
                work(index);
            }
        };
        std::thread::scope(|scope| {
            for _ in 1..self.threads.min(count) {
                scope.spawn(run);
            }
            run();
        });
    }

    fn threads(&self) -> usize {
        self.threads
    }

    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        self.io_pool.as_deref()
    }
}

impl CodeHost for StatementsHost {
    fn parse_runtime_tsconfig(&self, _arena: &Arena, text: &[u8]) -> Option<Json> {
        let names = strings::split(text, b"\n").filter(|name| !name.is_empty());
        let flags = names
            .map(|name| (name.to_vec(), Json::Bool(true)))
            .collect();
        let options = (b"compilerOptions".to_vec(), Json::object(flags));
        Some(Json::object(vec![options]))
    }

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        self.code_request_count.fetch_add(1, Ordering::Relaxed);
        match find_by_specifier(&self.claims, request.specifier) {
            HostResolution::Unclaimed => self.resolve_runtime_module(request.specifier),
            claim => claim,
        }
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        find_by_specifier(&self.runtime_modules, specifier)
    }

    fn find_runtime_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostResolution> {
        let is_match = |specifier: &[u8]| {
            specifier.len() >= prefix.len() + suffix.len()
                && specifier.starts_with(prefix)
                && specifier.ends_with(suffix)
        };
        let modules = self.runtime_modules.iter();
        let matches = modules.filter(|module| is_match(module.0.as_bytes()));
        matches.map(|module| module.1.clone()).collect()
    }

    fn loader_of(&self, request: &LoaderRequest<'_>) -> HostLoader {
        self.loader_requests.lock().push(RecordedLoaderRequest {
            path: request.path.to_vec(),
            kind: request.kind,
            type_attribute: request.type_attribute.map(<[u8]>::to_vec),
            embed_attribute: request.embed_attribute.map(<[u8]>::to_vec),
        });
        let mut loaders = self.loaders.iter();
        let found = loaders.find(|entry| {
            self.is_at_path(entry.0, request.path)
                && entry.1.map(str::as_bytes) == request.type_attribute
        });
        match found {
            Some(entry) => entry.2,
            None => HostLoader::default(),
        }
    }

    fn read_code(&self, path: &[u8]) -> CodeRead {
        self.record(HostEvent::ReadCode(path.to_vec()));
        if let Some(&awaited) = self.find_by_path(self.read_by_plugin, path) {
            self.wait_until_parsed(awaited);
        }
        if self.find_by_path(self.deferred, path).is_some() && !self.has_finished_reads() {
            self.unfinished.lock().push(path.to_vec());
            return CodeRead::Deferred;
        }
        CodeRead::Text(self.read_source(path))
    }

    fn is_read_by_plugin(&self, path: &[u8]) -> bool {
        self.find_by_path(self.read_by_plugin, path).is_some()
    }

    fn can_read_in_background(&self, path: &[u8], _loader: HostLoader) -> bool {
        self.lists_path(self.background_readable, path)
    }

    fn start_background_reads(&self, paths: &[&[u8]]) -> bool {
        let mut paths: Vec<Vec<u8>> = paths.iter().map(|path| path.to_vec()).collect();
        paths.sort_unstable();
        self.record(HostEvent::StartedBackgroundReads(paths));
        !self.rejects_background_reads
    }

    fn read_in_background(&self, path: &[u8]) {
        self.record(HostEvent::BackgroundRead(path.to_vec()));
    }

    fn finish_deferred_reads(&self) -> Vec<(Vec<u8>, Cow<'static, [u8]>)> {
        self.record(HostEvent::FinishedDeferredReads);
        self.has_finished_reads.store(true, Ordering::Relaxed);
        let unfinished = std::mem::take(&mut *self.unfinished.lock());
        let with_text = |path: Vec<u8>| {
            let text = self.read(&path)?;
            Some((path, text))
        };
        unfinished.into_iter().filter_map(with_text).collect()
    }

    fn is_plugin_source(&self, path: &[u8]) -> bool {
        self.lists_path(self.plugin_sources, path)
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        self.record(HostEvent::ParsedCode(request.path.to_vec()));
        let data = match request.loader {
            TEXT_LOADER => Some(DataModule::Value {
                default: arena.alloc(DataValue::String(atoms.intern(text))),
                exports_keys: false,
            }),
            NATIVE_ADDON_LOADER => Some(DataModule::RuntimeRequire {
                specifier: atoms.intern(request.path),
                loader_type: None,
                member: None,
            }),
            _ => None,
        };
        let DataModuleTree { file, host_values } = match data {
            Some(module) => module_from_data(&module, atoms, arena),
            None => DataModuleTree {
                file: self.parse(arena, request.path, text, atoms, request.options),
                host_values: &[],
            },
        };
        ParsedCode {
            hir: file,
            host_values,
            payload: Some(Box::new(ParsePayload {
                path: request.path.to_vec(),
                reads_jsdoc: request.reads_jsdoc,
            })),
        }
    }

    fn run_macros<'s>(
        &self,
        arena: &'s Arena,
        _atoms: &Interner<'s>,
        request: &MacroRequest<'_, 's>,
        _payload: &mut Option<HostPayload>,
    ) -> &'s [(ExprId, HostValue<'s>)] {
        let pending = request.analysis.pending_macro_calls;
        self.record(HostEvent::RanMacros {
            pending_calls: pending.len(),
        });
        let round = self.macro_round_count.fetch_add(1, Ordering::Relaxed);
        match pending.first() {
            Some(&call) if round < self.max_macro_values => {
                arena.alloc_slice_copy(&[(call, HostValue::Data(&DataValue::Null))])
            }
            _ => &[],
        }
    }

    fn transform_tree<'s>(
        &self,
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        _payload: &mut Option<HostPayload>,
    ) -> TreeChange {
        let transformed = HostEvent::TransformedTree(request.path.to_vec());
        let mut events = self.events.lock();
        let is_first_call = !events.contains(&transformed);
        events.push(transformed);
        match is_first_call && self.lists_path(self.transformed, request.path) {
            true => TreeChange::Changed,
            false => TreeChange::Unchanged,
        }
    }

    fn finish_file(
        &self,
        request: &FinishedFile<'_, '_>,
        _payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        let implied = self.find_by_path(&self.implied, request.path);
        implied.cloned().unwrap_or_default()
    }
}

#[derive(Copy, Clone)]
struct Token {
    text: Atom,
    start: u32,
    end: u32,
}

struct OpenObject {
    start: u32,
    key: Token,
    properties: Vec<Prop>,
}

struct StatementParser<'t, 'a, 's> {
    text: &'t [u8],
    position: usize,
    file: FileBuilder,
    atoms: &'a Interner<'s>,
}

impl<'s> StatementParser<'_, '_, 's> {
    fn parse(
        file: FileBuilder,
        text: &[u8],
        atoms: &Interner<'s>,
        arena: &'s Arena,
    ) -> hir::File<'s> {
        let mut parser = StatementParser {
            text,
            position: 0,
            file,
            atoms,
        };
        let mut statements = Vec::new();
        while parser.position < text.len() {
            if parser.eat(b"\n") {
                continue;
            }
            let start = parser.offset();
            match parser.statement() {
                Some(statement) if parser.is_at_line_end() => statements.push(statement),
                _ => parser.skip_invalid_line(start),
            }
        }
        parser.finish(&statements, arena)
    }

    fn finish(mut self, statements: &[StmtId], arena: &'s Arena) -> hir::File<'s> {
        self.file.body = self.file.list(statements);
        if self.file.is_js && self.file.has_module_syntax {
            self.file.set_strict_by_syntax();
        }
        let (mut file, _) = self.file.into_arena(arena, self.atoms.session());
        file.finish_nodes();
        file
    }

    fn offset(&self) -> u32 {
        self.position as u32
    }

    fn is_at(&self, token: &[u8]) -> bool {
        self.text[self.position..].starts_with(token)
    }

    fn is_at_line_end(&self) -> bool {
        self.position == self.text.len() || self.is_at(b"\n")
    }

    fn eat(&mut self, token: &[u8]) -> bool {
        let is_next = self.is_at(token);
        if is_next {
            self.position += token.len();
        }
        is_next
    }

    fn expect(&mut self, token: &[u8]) -> Option<()> {
        self.eat(token).then_some(())
    }

    fn take(&mut self, len: usize) -> Token {
        let start = self.offset();
        let text = self.atoms.intern(&self.text[self.position..][..len]);
        self.position += len;
        Token {
            text,
            start,
            end: self.offset(),
        }
    }

    fn identifier(&mut self) -> Option<Token> {
        let rest = &self.text[self.position..];
        let is_name_byte = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
        let len = rest.iter().take_while(|&&byte| is_name_byte(byte)).count();
        let is_name = len > 0 && !rest[0].is_ascii_digit();
        is_name.then(|| self.take(len))
    }

    fn string(&mut self) -> Option<Token> {
        let start = self.offset();
        self.expect(b"\"")?;
        let rest = &self.text[self.position..];
        let len = strings::index_of_any(rest, b"\"\n")?;
        let text = self.take(len).text;
        self.expect(b"\"")?;
        Some(Token {
            text,
            start,
            end: self.offset(),
        })
    }

    fn skip_invalid_line(&mut self, start: u32) {
        let rest = &self.text[self.position..];
        let line_end = strings::index_of_char_usize(rest, b'\n');
        self.position += line_end.unwrap_or(rest.len());
        self.file.has_errors = true;
        self.file.has_parse_diagnostics = true;
        let end = self.offset();
        self.file
            .error(DiagnosticKind::Parse, start, end, EXPRESSION_EXPECTED);
    }

    fn add_statement(&mut self, kind: StmtKind, start: u32) -> StmtId {
        let statement = self.file.stmt(kind, start);
        self.file[statement].loc = TextRange {
            pos: start,
            end: self.offset(),
        };
        statement
    }

    fn add_name(&mut self, name: Token) -> ExprId {
        self.file
            .expr(ExprKind::Ident(name.text), name.start, name.end)
    }

    fn add_specifier_use(&mut self, specifier: Token, kind: SpecifierKind) {
        self.file.specifier_uses.push(SpecifierUse {
            spec: specifier.text,
            pos: specifier.start,
            kind,
            mode: ResolutionMode::None,
        });
    }

    fn add_call_specifier_use(&mut self, argument: ExprId, kind: SpecifierKind) {
        let Expr {
            kind: argument_kind,
            pos: start,
            end,
        } = self.file[argument];
        if let ExprKind::String(text) = argument_kind {
            self.add_specifier_use(Token { text, start, end }, kind);
        }
    }

    fn statement(&mut self) -> Option<StmtId> {
        let start = self.offset();
        if self.eat(b"import ") {
            return self.import_statement(start);
        }
        if self.is_at(b"{ ") {
            let object = self.object()?;
            return Some(self.add_statement(StmtKind::ExportAssign(object), start));
        }
        if !self.eat(b"if (") {
            return self.expression_statement();
        }
        let test_start = self.offset();
        self.expect(b"false")?;
        let test = self.file.expr(ExprKind::False, test_start, self.offset());
        self.expect(b") ")?;
        let yes = self.expression_statement()?;
        let no = StmtId::NONE;
        Some(self.add_statement(StmtKind::If { test, yes, no }, start))
    }

    fn import_statement(&mut self, start: u32) -> Option<StmtId> {
        let clause_start = self.offset();
        let type_only = self.eat(b"type ");
        let default = match self.is_at(b"\"") {
            true => None,
            false => Some(self.identifier()?),
        };
        let clause_end = self.offset();
        if default.is_some() {
            self.expect(b" from ")?;
        } else if type_only {
            return None;
        }
        let specifier = self.string()?;
        let attributes = self.import_attributes()?;
        let kind = match default {
            Some(_) => SpecifierKind::Import,
            None => SpecifierKind::SideEffect,
        };
        self.add_specifier_use(specifier, kind);
        self.file.has_module_syntax = true;
        let import = self.file.add_import(Import {
            spec: specifier.text,
            default: default.map_or(Atom::NONE, |name| name.text),
            default_pos: default.map_or(0, |name| name.start),
            namespace: Atom::NONE,
            namespace_pos: 0,
            clause_start,
            clause_end,
            namespace_start: 0,
            named: Span::EMPTY,
            has_named_imports: false,
            type_only,
            is_deferred: false,
            mode: ResolutionMode::None,
            stmt: StmtId::NONE,
            attributes,
        });
        Some(self.add_statement(StmtKind::Import(import), start))
    }

    fn import_attributes(&mut self) -> Option<ExprId> {
        if !self.eat(b" ") {
            return Some(ExprId::NONE);
        }
        let start = self.offset();
        self.expect(b"with ")?;
        let attributes = self.object()?;
        self.file.import_attributes.push((start, attributes));
        Some(attributes)
    }

    fn expression_statement(&mut self) -> Option<StmtId> {
        let start = self.offset();
        let expression = self.expression()?;
        Some(self.add_statement(StmtKind::Expr(expression), start))
    }

    fn expression(&mut self) -> Option<ExprId> {
        let start = self.offset();
        if self.eat(b"<") {
            return self.jsx_element(start);
        }
        if self.eat(b"import(") {
            return self.import_call(start);
        }
        let mut expression = self.primary_expression()?;
        while self.eat(b".") {
            let name = self.identifier()?;
            let object = (expression, Chain::No);
            let member = self.file.dot(object, (name.text, name.start), name.end);
            expression = self.file.expr(member, start, name.end);
        }
        match self.eat(b"(") {
            true => self.call(expression, start),
            false => Some(expression),
        }
    }

    fn primary_expression(&mut self) -> Option<ExprId> {
        let start = self.offset();
        if self.eat(b"import.meta") {
            self.file.rare_syntax |= rare::IMPORT_META;
            return Some(self.file.expr(ExprKind::ImportMeta, start, self.offset()));
        }
        let name = self.identifier()?;
        Some(self.add_name(name))
    }

    fn jsx_element(&mut self, start: u32) -> Option<ExprId> {
        let name = self.identifier()?;
        self.expect(b" />")?;
        let end = self.offset();
        let tag = self.add_name(name);
        let element = self.file.add_jsx(Jsx {
            tag,
            close_tag: ExprId::NONE,
            attrs: Span::EMPTY,
            children: IdList::EMPTY,
            type_args: IdList::EMPTY,
            opening_end: end,
            close_pos: u32::MAX,
            end,
        });
        Some(self.file.expr(ExprKind::Jsx(element), start, end))
    }

    fn import_call(&mut self, start: u32) -> Option<ExprId> {
        let arguments = self.arguments()?;
        self.add_call_specifier_use(arguments[0], SpecifierKind::ImportCall);
        let args = self.file.list(&arguments);
        Some(
            self.file
                .expr(ExprKind::ImportCall { args }, start, self.offset()),
        )
    }

    fn call(&mut self, callee: ExprId, start: u32) -> Option<ExprId> {
        let arguments = self.arguments()?;
        let is_require_call = self.file.is_js
            && arguments.len() == 1
            && matches!(self.file[callee].kind, ExprKind::Ident(known::require));
        if is_require_call {
            self.add_call_specifier_use(arguments[0], SpecifierKind::RequireCall);
        }
        let end = self.offset();
        let call = Call {
            callee,
            args: self.file.list(&arguments),
            type_args: ListAt::EMPTY,
            close_pos: end - 1,
            chain: Chain::No,
            is_pure: false,
        };
        let call = self.file.add_call(call);
        Some(self.file.expr(ExprKind::Call(call), start, end))
    }

    fn arguments(&mut self) -> Option<Vec<ExprId>> {
        let mut arguments = vec![self.concatenation()?];
        while self.eat(b", ") {
            arguments.push(self.object()?);
        }
        self.expect(b")")?;
        Some(arguments)
    }

    fn concatenation(&mut self) -> Option<ExprId> {
        let start = self.offset();
        let mut left = self.operand()?;
        while self.eat(b" + ") {
            let right = self.operand()?;
            let op = BinOp::Add;
            left = self
                .file
                .expr(ExprKind::Binary { op, left, right }, start, self.offset());
        }
        Some(left)
    }

    fn operand(&mut self) -> Option<ExprId> {
        if self.is_at(b"\"") {
            return self.string_literal();
        }
        let name = self.identifier()?;
        Some(self.add_name(name))
    }

    fn string_literal(&mut self) -> Option<ExprId> {
        let Token { text, start, end } = self.string()?;
        Some(self.file.expr(ExprKind::String(text), start, end))
    }

    fn property_key(&mut self) -> Option<Token> {
        let key = self.identifier()?;
        self.expect(b": ")?;
        Some(key)
    }

    fn object(&mut self) -> Option<ExprId> {
        let mut open: Vec<OpenObject> = Vec::new();
        loop {
            let start = self.offset();
            if self.eat(b"{ ") {
                open.push(OpenObject {
                    start,
                    key: self.property_key()?,
                    properties: Vec::new(),
                });
                continue;
            }
            let mut value = self.string_literal()?;
            loop {
                let object = open.last_mut()?;
                object.properties.push(Prop {
                    kind: PropKind::Init,
                    key: PropKey::Name(object.key.text),
                    name_kind: NameKind::Identifier,
                    value,
                    pos: object.key.start,
                    start: object.key.start,
                    end: self.offset(),
                    postfix_token: 0,
                });
                if self.eat(b", ") {
                    object.key = self.property_key()?;
                    break;
                }
                self.expect(b" }")?;
                let closed = open.pop()?;
                let properties = self.file.add_props(&closed.properties);
                value = self
                    .file
                    .expr(ExprKind::Object(properties), closed.start, self.offset());
                if open.is_empty() {
                    return Some(value);
                }
            }
        }
    }
}

pub(super) struct TestBuild<'a> {
    pub(super) host: &'a dyn CodeHost,
    pub(super) entry_points: &'a [&'a str],
    pub(super) roots: &'a [&'a str],
    pub(super) options: Options,
    pub(super) code: CodeOptions,
}

impl<'a> TestBuild<'a> {
    pub(super) fn new(host: &'a dyn CodeHost, entry_points: &'a [&'a str]) -> TestBuild<'a> {
        TestBuild {
            host,
            entry_points,
            roots: &[],
            options: Options::default(),
            code: CodeOptions::bun_run(b"/"),
        }
    }
}

pub(super) fn to_paths(paths: &[&str]) -> Vec<Vec<u8>> {
    paths.iter().map(|path| path.as_bytes().to_vec()).collect()
}

fn with_compile_inputs<'s, R>(
    session: &'s Session,
    build: &TestBuild<'_>,
    then: impl FnOnce(&CompileInputs<'_, 's>) -> R,
) -> R {
    let fold_options = FoldOptions {
        max_string_bytes: MAX_STRING_BYTES,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, session.arena());
    let entry_points = to_paths(build.entry_points);
    then(&CompileInputs {
        entry_points: &entry_points,
        main_module: MainModule::EntryPoint,
        code: &build.code,
        fold: &fold,
        atoms: Interner::new_in(session),
    })
}

pub(super) fn with_compile_context<R>(
    build: &TestBuild<'_>,
    test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R,
) -> R {
    let session = &Session::new();
    with_compile_inputs(session, build, |inputs| {
        let options: &Options = session.keep(build.options.clone());
        let resolving = Session::new();
        let resolver = Resolver::for_compile(&resolving, build.host, options, inputs.code);
        let compile = CompileLoad {
            host: build.host,
            inputs,
        };
        let context = CodeLoadContext::new(session, &resolver, options, compile);
        test(&context)
    })
}

pub(super) fn load_files<'s>(session: &'s Session, build: &TestBuild<'_>) -> Files<'s> {
    with_compile_inputs(session, build, |inputs| {
        let (options, roots) = (build.options.clone(), to_paths(build.roots));
        Files::load_for_compile(
            session,
            build.host,
            options,
            RootFileNames::Listed(&roots),
            inputs,
        )
    })
}
