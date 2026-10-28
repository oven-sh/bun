use crate::*;
use bun_sema::atom::{Atom, Interner};
use bun_sema::check::Checker;
use bun_sema::check::aot::{DiagnosticClass, Effect, FileOrigin};
use bun_sema::fold::{
    Constant, Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions,
};
use bun_sema::hir::{self, ExprId};
use bun_sema::hir_from_data::{DataValue, HostValue};
use bun_sema::program::{FileRole, HostLoader, HostModuleId};
use bun_sema::resolve::{
    CachedConfig, CodeHost, CodeOptions, CodeParseRequest, CodeRequest, ExternalKind, FinishedFile,
    HostPayload, HostResolution, LoaderRequest, MacroRequest, ParseOptions, ParsedCode, Paths,
};
use bun_sema_standalone as _;
use std::num::NonZeroUsize;
use std::sync::Once;

pub(super) const PROJECT: &[u8] = b"/project";

const TSCONFIG: &str = r#"{
    "compilerOptions": {
        "strict": true,
        "noLib": true,
        "types": [],
        "module": "preserve",
        "moduleResolution": "bundler",
        "jsx": "react-jsx"
    }
}"#;

pub(super) const GLOBAL_TYPES: &str = "interface Array<T> { length: number; [index: number]: T }
interface Boolean {}
interface CallableFunction {}
interface Function {}
interface IArguments {}
interface NewableFunction {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
";

pub(super) const DEPENDENCY_MANIFEST: &str =
    r#"{ "name": "dep", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }"#;

pub(super) const IMPORTS_DEPENDENCY: &str = r#"import { value } from "dep";
export const copy = value;
"#;

pub(super) const TYPE_ERROR: &str = "const wrong: string = 1;
export const value = 2;
";

pub(super) const FAILING_DEPENDENCY: [(&str, &str); 3] = [
    ("main.ts", IMPORTS_DEPENDENCY),
    ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
    ("node_modules/dep/index.ts", TYPE_ERROR),
];

pub(super) struct TestProgram<'a, 's> {
    pub loaded: &'a LoadedProgram<'s>,
    pub host: &'a dyn CodeHost,
    pub request: &'a CompileRequest<'a, 's>,
}

impl<'s> TestProgram<'_, 's> {
    pub(super) fn files(&self) -> &'s Files<'s> {
        self.loaded.files()
    }

    pub(super) fn file(&self, path: &str) -> FileId {
        self.find(path)
            .unwrap_or_else(|| panic!("{path} is not in the program"))
    }

    pub(super) fn find(&self, path: &str) -> Option<FileId> {
        self.files().by_path.get(&inside(PROJECT, path.as_bytes()))
    }
}

pub(super) struct CheckedBuild<T> {
    pub roles: RoleDecision,
    pub program: CheckedProgram<T>,
}

impl<T> CheckedBuild<T> {
    pub(super) fn diagnostics(&self) -> impl Iterator<Item = &BuildDiagnostic> {
        self.roles
            .diagnostics
            .iter()
            .chain(&self.program.diagnostics)
    }

    pub(super) fn demoted_files(&self) -> Vec<FileId> {
        self.roles.demoted.iter().map(|it| it.file).collect()
    }

    pub(super) fn reported(&self, file: FileId, code: u32) -> Vec<(DiagnosticClass, Effect)> {
        self.diagnostics()
            .filter(|it| it.diagnostic.file == Some(file) && it.diagnostic.code == code)
            .map(|it| (it.diagnostic.class, it.effect))
            .collect()
    }

    pub(super) fn has_diagnostics(&self, file: FileId) -> bool {
        self.diagnostics()
            .any(|it| it.diagnostic.file == Some(file))
    }

    pub(super) fn codes(&self) -> Vec<u32> {
        self.diagnostics().map(|it| it.diagnostic.code).collect()
    }

    pub(super) fn into_summary(self) -> BuildSummary<T> {
        let CheckedBuild { roles, program } = self;
        let incomplete = roles.incomplete.iter().chain(&program.incomplete);
        BuildSummary {
            incomplete: incomplete.map(|it| it.path.clone()).collect(),
            role_diagnostics: summarize(&roles.diagnostics),
            diagnostics: summarize(&program.diagnostics),
            roles: roles.roles,
            demoted: roles.demoted,
            checked: roles.checked,
            lowered: program.lowered,
        }
    }
}

#[derive(PartialEq, Eq, Debug)]
struct DiagnosticSummary {
    path: Vec<u8>,
    file: Option<FileId>,
    range: (u32, u32),
    code: u32,
    class: DiagnosticClass,
    effect: Effect,
    text: Vec<u8>,
    related: Vec<(Option<FileId>, u32, u32)>,
}

#[derive(PartialEq, Eq, Debug)]
pub(super) struct BuildSummary<T> {
    roles: Vec<FileRole>,
    demoted: Vec<Demotion>,
    checked: Vec<FileId>,
    lowered: Vec<(FileId, T)>,
    role_diagnostics: Vec<DiagnosticSummary>,
    diagnostics: Vec<DiagnosticSummary>,
    incomplete: Vec<Vec<u8>>,
}

fn summarize(diagnostics: &[BuildDiagnostic]) -> Vec<DiagnosticSummary> {
    let summaries = diagnostics.iter().map(|reported| {
        let diagnostic = &reported.diagnostic;
        let related = diagnostic.related.iter();
        DiagnosticSummary {
            path: diagnostic.path.clone(),
            file: diagnostic.file,
            range: (diagnostic.start, diagnostic.end),
            code: diagnostic.code,
            class: diagnostic.class,
            effect: reported.effect,
            text: diagnostic.text.clone(),
            related: related.map(|it| (it.file, it.code, it.start)).collect(),
        }
    });
    summaries.collect()
}

pub(super) fn codes(diagnostics: &[BuildDiagnostic]) -> Vec<u32> {
    diagnostics.iter().map(|it| it.diagnostic.code).collect()
}

pub(super) fn check<'s, T: Send>(
    program: &TestProgram<'_, 's>,
    lower: &(dyn Fn(&mut Checker<'_, 's>, FileId) -> T + Sync),
) -> CheckedBuild<T> {
    let files_to_lower = program.files().compiled_files();
    let (loaded, host, request) = (program.loaded, program.host, program.request);
    let roles = decide_roles(loaded, host, request, files_to_lower);
    let lower = |checker: &mut Checker<'_, 's>, file| Some(lower(checker, file));
    let program = check_and_lower(loaded, host, request, &roles, files_to_lower, &lower);
    CheckedBuild { roles, program }
}

pub(super) fn check_only(program: &TestProgram<'_, '_>) -> CheckedBuild<()> {
    check(program, &|_, _| ())
}

pub(super) fn project_disk(files: &[(&str, &str)], threads: usize) -> host::Disk {
    let defaults = [("tsconfig.json", TSCONFIG), ("globals.d.ts", GLOBAL_TYPES)];
    let mut already_read = host::AlreadyRead::default();
    for (path, text) in defaults.iter().chain(files) {
        already_read.insert(inside(PROJECT, path.as_bytes()), text.as_bytes().to_vec());
    }
    disk(threads, already_read, PROJECT)
}

pub(super) fn disk(threads: usize, already_read: host::AlreadyRead, root: &[u8]) -> host::Disk {
    static OUTPUT: Once = Once::new();
    OUTPUT.call_once(bun_core::output::stdio::init);
    host::Disk::with_already_read(threads, already_read, root)
}

pub(super) fn with_program<R>(
    files: &[(&str, &str)],
    entry_points: &[&str],
    threads: usize,
    then: impl FnOnce(&TestProgram<'_, '_>) -> R,
) -> R {
    let (disk, code) = (project_disk(files, threads), CodeOptions::bun_run(PROJECT));
    try_load(&disk, &code, Roots::Written(entry_points), &[], |loaded| {
        then(loaded.expect("load_program failed"))
    })
}

pub(super) fn with_conditions<R>(
    files: &[(&str, &str)],
    entry_points: &[&str],
    conditions: &[&str],
    then: impl FnOnce(&TestProgram<'_, '_>) -> R,
) -> R {
    let (disk, mut code) = (project_disk(files, 1), CodeOptions::bun_run(PROJECT));
    for condition in conditions {
        code.add_custom_condition(condition.as_bytes());
    }
    try_load(&disk, &code, Roots::Written(entry_points), &[], |loaded| {
        then(loaded.expect("load_program failed"))
    })
}

pub(super) fn with_runtime_project<R>(
    files: &[(&str, &str)],
    entry_paths: &[&str],
    then: impl FnOnce(&TestProgram<'_, '_>) -> R,
) -> R {
    let (disk, code) = (project_disk(files, 1), CodeOptions::bun_run(PROJECT));
    try_load(&disk, &code, Roots::Runtime(entry_paths), &[], |loaded| {
        then(loaded.expect("load_program failed"))
    })
}

pub(super) fn with_defines<R>(
    files: &[(&str, &str)],
    entry_points: &[&str],
    defines: &[(&str, &str)],
    then: impl FnOnce(&TestProgram<'_, '_>) -> R,
) -> R {
    let (disk, code) = (project_disk(files, 1), CodeOptions::bun_run(PROJECT));
    try_load(
        &disk,
        &code,
        Roots::Written(entry_points),
        defines,
        |loaded| then(loaded.expect("load_program failed")),
    )
}

pub(super) fn with_host<R>(
    host: &dyn CodeHost,
    directory: &[u8],
    entry_point: &str,
    then: impl FnOnce(&TestProgram<'_, '_>) -> R,
) -> R {
    let code = CodeOptions::bun_run(directory);
    try_load(host, &code, Roots::Written(&[entry_point]), &[], |loaded| {
        then(loaded.expect("load_program failed"))
    })
}

pub(super) fn load(files: &[(&str, &str)], entry_points: &[&str]) -> Result<(), LoadFailure> {
    load_with_host(&project_disk(files, 1), entry_points)
}

pub(super) fn load_with_host(
    host: &dyn CodeHost,
    entry_points: &[&str],
) -> Result<(), LoadFailure> {
    let code = CodeOptions::bun_run(PROJECT);
    try_load(host, &code, Roots::Written(entry_points), &[], |loaded| {
        loaded.map(|_| ())
    })
}

pub(super) fn load_with_tsconfig_override<R>(
    files: &[(&str, &str)],
    entry_point: &str,
    tsconfig_override: &str,
    then: impl FnOnce(Result<&TestProgram<'_, '_>, LoadFailure>) -> R,
) -> R {
    let code = CodeOptions {
        tsconfig_override: Some(inside(PROJECT, tsconfig_override.as_bytes())),
        ..CodeOptions::bun_run(PROJECT)
    };
    let entry_points = [entry_point];
    let roots = Roots::Written(&entry_points);
    try_load(&project_disk(files, 1), &code, roots, &[], then)
}

#[derive(Copy, Clone)]
enum Roots<'a> {
    Written(&'a [&'a str]),
    Runtime(&'a [&'a str]),
}

fn try_load<R>(
    host: &dyn CodeHost,
    code: &CodeOptions,
    roots: Roots<'_>,
    defines: &[(&str, &str)],
    then: impl FnOnce(Result<&TestProgram<'_, '_>, LoadFailure>) -> R,
) -> R {
    let session = Session::new();
    let (atoms, arena) = (Interner::new_in(&session), session.arena());
    let fold = FoldInputs::new(fold_options(defines, &atoms, arena), arena);
    let paths: Vec<Vec<u8>> = match roots {
        Roots::Written(specifiers) => specifiers.iter().map(|it| it.as_bytes().to_vec()).collect(),
        Roots::Runtime(paths) => paths
            .iter()
            .map(|it| inside(PROJECT, it.as_bytes()))
            .collect(),
    };
    let request = CompileRequest {
        entry_points: match roots {
            Roots::Written(_) => EntryPoints::Written(&paths),
            Roots::Runtime(_) => EntryPoints::Resolved(&paths),
        },
        code,
        fold: &fold,
        atoms,
        libs: Libs::Directory(&code.working_directory),
        project_origin: match roots {
            Roots::Written(_) => FileOrigin::NoFile,
            Roots::Runtime(_) => FileOrigin::Runtime,
        },
        threads: NonZeroUsize::new(host.threads()).unwrap_or(NonZeroUsize::MIN),
        progress: None,
        left_out_bodies: None,
    };
    match load_program(&session, host, &request) {
        Ok(loaded) => then(Ok(&TestProgram {
            loaded: &loaded,
            host,
            request: &request,
        })),
        Err(failure) => then(Err(failure)),
    }
}

fn fold_options<'s>(
    defines: &[(&str, &str)],
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> FoldOptions<'s> {
    let defines = defines.iter().map(|(path, value)| {
        let mut names = strings::split(path.as_bytes(), b".").map(|name| atoms.intern(name));
        let root = DefineRoot::Global(names.next().expect("a define has a name"));
        let members: Vec<Atom> = names.collect();
        Define {
            path: DefinePath {
                root,
                members: arena.alloc_slice_copy(&members),
            },
            value: DefineValue::Constant(Constant::String(atoms.intern(value.as_bytes()))),
        }
    });
    FoldOptions {
        defines: arena.alloc_slice_fill_iter(defines),
        max_string_bytes: 4096,
        ..FoldOptions::default()
    }
}

fn check_request() -> Request<'static> {
    Request {
        cwd: PROJECT,
        project: None,
        listed_projects: None,
        build: false,
        errors: &[],
        paths: &[],
        are_entry_points: false,
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        compiler_options: &[],
        threads: 1,
        libs: Libs::Directory(PROJECT),
        progress: None,
        order: 1,
        plan_options: PlanOptions::default(),
        stops_like_tsc: false,
        uses_typescript_wording: false,
        loaded: None,
        after_file: None,
    }
}

fn run_bun_check(disk: &host::Disk, project: config::Project, loaded: &(dyn Fn(&Program) + Sync)) {
    let request = Request {
        loaded: Some(loaded),
        ..check_request()
    };
    check_project(disk, project, &request, Report::default(), Instant::now());
}

fn read_from_bun_check<T: Send + Sync>(
    disk: &host::Disk,
    project: config::Project,
    read: impl Fn(&Files<'_>) -> T + Sync,
) -> T {
    let result = OnceLock::new();
    run_bun_check(disk, project, &|program| {
        result.get_or_init(|| read(program.files));
    });
    result.into_inner().expect("`bun check` loads the program")
}

pub(super) fn from_bun_check<T: Send + Sync>(
    files: &[(&str, &str)],
    read: impl Fn(&Files<'_>) -> T + Sync,
) -> T {
    let disk = project_disk(files, 1);
    let config_path = inside(PROJECT, b"tsconfig.json");
    let project = config::load_for_build(&disk, &Session::new(), &config_path);
    let project = project.expect("tsconfig.json cannot be read");
    read_from_bun_check(&disk, project, read)
}

pub(super) fn from_bun_check_without_configuration<T: Send + Sync>(
    files: &[(&str, &str)],
    roots: &[&str],
    read: impl Fn(&Files<'_>) -> T + Sync,
) -> T {
    let disk = project_disk(files, 1);
    let roots = roots.iter().map(|root| inside(PROJECT, root.as_bytes()));
    let roots: Vec<Vec<u8>> = roots.collect();
    let project = project_without_config(&disk, &check_request(), PROJECT, &roots);
    read_from_bun_check(&disk, project, read)
}

macro_rules! delegate_host_to_disk {
    () => {
        fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
            self.0.read(path)
        }
        fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
            self.0.read_source(path)
        }
        fn origin(&self, path: &[u8]) -> usize {
            self.0.origin(path)
        }
        fn take_unreadable(&self) -> Vec<Vec<u8>> {
            self.0.take_unreadable()
        }
        fn is_file(&self, path: &[u8]) -> bool {
            self.0.is_file(path)
        }
        fn is_dir(&self, path: &[u8]) -> bool {
            self.0.is_dir(path)
        }
        fn realpath(&self, path: &[u8]) -> Vec<u8> {
            self.0.realpath(path)
        }
        fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
            self.0.list_dir(path)
        }
        fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
            self.0.entries(path)
        }
        fn is_case_sensitive(&self) -> bool {
            self.0.is_case_sensitive()
        }
        fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
            self.0.script_kind(path)
        }
        fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
            self.0.extra_file_extensions()
        }
        fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>> {
            self.0.scripts_of_page(page)
        }
        fn parse<'s>(
            &self,
            arena: &'s Arena,
            path: &[u8],
            text: &[u8],
            atoms: &Interner<'s>,
            options: ParseOptions,
        ) -> hir::File<'s> {
            self.0.parse(arena, path, text, atoms, options)
        }
        fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
            self.0.parse_package_json(arena, text)
        }
        fn extended_config(&self, path: &[u8]) -> Option<CachedConfig> {
            self.0.extended_config(path)
        }
        fn cache_extended_config(&self, path: &[u8], parsed: &dyn Fn() -> CachedConfig) {
            self.0.cache_extended_config(path, parsed);
        }
        fn shared_paths(&self, paths: Arc<Paths>) -> Arc<Paths> {
            self.0.shared_paths(paths)
        }
        fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
            self.0.parallel(count, work);
        }
        fn parallel_while(
            &self,
            count: usize,
            work: &(dyn Fn(usize) + Sync),
            meanwhile: &mut dyn FnMut(),
        ) {
            self.0.parallel_while(count, work, meanwhile);
        }
        fn run_regions_inline(&self, work: &mut dyn FnMut()) {
            self.0.run_regions_inline(work);
        }
        fn is_single_threaded(&self) -> bool {
            self.0.is_single_threaded()
        }
        fn ends_the_process(&self, has_a_run: bool) -> bool {
            self.0.ends_the_process(has_a_run)
        }
        fn helpers_now(&self) -> Option<usize> {
            self.0.helpers_now()
        }
        fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
            self.0.with_helpers(helpers, count, work);
        }
        fn loaded(&self) {
            self.0.loaded();
        }
        fn threads(&self) -> usize {
            self.0.threads()
        }
        fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
            self.0.io_pool()
        }
    };
}

macro_rules! delegate_parsers_to_disk {
    () => {
        fn parse_runtime_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
            self.0.parse_runtime_package_json(arena, text)
        }
        fn parse_runtime_tsconfig(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
            self.0.parse_runtime_tsconfig(arena, text)
        }
        fn parse_code<'s>(
            &self,
            arena: &'s Arena,
            request: &CodeParseRequest<'_>,
            text: &[u8],
            atoms: &Interner<'s>,
        ) -> ParsedCode<'s> {
            self.0.parse_code(arena, request, text, atoms)
        }
    };
}

pub(super) struct ClaimsNodeFs<'a>(pub &'a host::Disk);

impl Host for ClaimsNodeFs<'_> {
    delegate_host_to_disk!();
}

impl CodeHost for ClaimsNodeFs<'_> {
    delegate_parsers_to_disk!();

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        match request.specifier {
            b"node:fs" => HostResolution::Module(HostModuleId(7)),
            _ => HostResolution::Unclaimed,
        }
    }
}

pub(super) struct SlowToQueueAgain<'a>(pub &'a host::Disk, pub Guarded<Vec<Vec<u8>>>);

impl SlowToQueueAgain<'_> {
    pub(super) fn times_queued(&self, path: &str) -> usize {
        let path = inside(PROJECT, path.as_bytes());
        self.1.lock().iter().filter(|&it| *it == path).count()
    }
}

impl Host for SlowToQueueAgain<'_> {
    delegate_host_to_disk!();
}

impl CodeHost for SlowToQueueAgain<'_> {
    delegate_parsers_to_disk!();

    fn is_read_by_plugin(&self, path: &[u8]) -> bool {
        let mut queued = self.1.lock();
        let is_queued_again = queued.iter().any(|it| it == path);
        queued.push(path.to_vec());
        drop(queued);
        if is_queued_again {
            std::thread::sleep(Duration::from_millis(200));
        }
        false
    }
}

#[derive(Default)]
pub(super) struct HostScript<'a> {
    pub attribute_loader: HostLoader,
    pub implied_files: &'a [(&'a str, &'a str)],
    pub evaluated_texts: &'a [&'a str],
    pub externals: &'a [&'a str],
    pub runtime_modules: &'a [&'a str],
    pub answers_macros: bool,
    pub macro_rounds: AtomicUsize,
}

impl HostScript<'_> {
    pub(super) fn macro_rounds(&self) -> usize {
        self.macro_rounds.load(Ordering::Relaxed)
    }
}

pub(super) struct ScriptedHost<'a>(pub &'a host::Disk, pub HostScript<'a>);

impl Host for ScriptedHost<'_> {
    delegate_host_to_disk!();
}

impl CodeHost for ScriptedHost<'_> {
    delegate_parsers_to_disk!();

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        let mut externals = self.1.externals.iter();
        match externals.any(|specifier| specifier.as_bytes() == request.specifier) {
            true => HostResolution::External {
                specifier: request.specifier.to_vec(),
                kind: ExternalKind::UncompiledCode,
            },
            false => HostResolution::Unclaimed,
        }
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        let mut modules = self.1.runtime_modules.iter();
        match modules.any(|module| module.as_bytes() == specifier) {
            true => HostResolution::Module(HostModuleId(7)),
            false => HostResolution::Unclaimed,
        }
    }

    fn loader_of(&self, request: &LoaderRequest<'_>) -> HostLoader {
        match request.type_attribute {
            Some(_) => self.1.attribute_loader,
            None => HostLoader::default(),
        }
    }

    fn is_evaluated_text(&self, path: &[u8]) -> bool {
        let mut texts = self.1.evaluated_texts.iter();
        texts.any(|text| inside(PROJECT, text.as_bytes()) == path)
    }

    fn run_macros<'s>(
        &self,
        arena: &'s Arena,
        _atoms: &Interner<'s>,
        request: &MacroRequest<'_, 's>,
        _payload: &mut Option<HostPayload>,
    ) -> &'s [(ExprId, HostValue<'s>)] {
        self.1.macro_rounds.fetch_add(1, Ordering::Relaxed);
        let pending = request.analysis.pending_macro_calls.first();
        let answered = pending.filter(|_| self.1.answers_macros);
        arena.alloc_slice_fill_iter(answered.map(|&call| (call, HostValue::Data(&DataValue::Null))))
    }

    fn finish_file(
        &self,
        request: &FinishedFile<'_, '_>,
        _payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        let is_importer = |file: &str| inside(PROJECT, file.as_bytes()) == request.path;
        let implied = self
            .1
            .implied_files
            .iter()
            .filter(|file| is_importer(file.0));
        implied
            .map(|file| HostResolution::Path(inside(PROJECT, file.1.as_bytes())))
            .collect()
    }
}

#[cfg(unix)]
pub(super) struct TemporaryDirectory(std::path::PathBuf);

#[cfg(unix)]
#[allow(clippy::disallowed_methods)]
impl TemporaryDirectory {
    pub(super) fn new(name: &str) -> TemporaryDirectory {
        let name = format!("bun_sema_driver_{name}_{}", std::process::id());
        let path = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        TemporaryDirectory(std::fs::canonicalize(&path).unwrap())
    }

    fn create_parent_directory(&self, path: &str) -> std::path::PathBuf {
        let path = self.0.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        path
    }

    pub(super) fn write(&self, path: &str, text: &str) {
        std::fs::write(self.create_parent_directory(path), text).unwrap();
    }

    pub(super) fn link(&self, path: &str, target: &str) {
        std::os::unix::fs::symlink(target, self.create_parent_directory(path)).unwrap();
    }

    pub(super) fn root(&self) -> Vec<u8> {
        host::from_native(self.0.as_os_str().as_encoded_bytes())
    }

    pub(super) fn path_of(&self, path: &str) -> Vec<u8> {
        host::from_native(self.0.join(path).as_os_str().as_encoded_bytes())
    }
}

#[cfg(unix)]
impl Drop for TemporaryDirectory {
    #[allow(clippy::disallowed_methods)]
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
