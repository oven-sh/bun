use crate::host::{Provided, from_native, to_native};
use crate::{Checker, EarlyRun, FileId, FxHashMap, Libs, PlanOptions, Request, check_provided_then, parse_command_line, with_shared_run};
use bun_sema::check::JsonParseSchema;
use bun_threading::Guarded;

pub struct SchemasOfFile {
    pub text: Vec<u8>,
    pub schemas: Vec<JsonParseSchema>,
}

#[derive(Default)]
pub struct Answer {
    pub by_path: FxHashMap<Vec<u8>, SchemasOfFile>,
    pub files_loaded: usize,
}

impl Answer {
    fn has_unresolved_type(&self) -> bool {
        self.by_path.values().flat_map(|of_file| &of_file.schemas).any(|it| it.is_unresolved)
    }
}

pub struct Asked<'a> {
    pub cwd: &'a [u8],
    pub paths: &'a [Vec<u8>],
    pub read: &'a [(&'a [u8], &'a [u8])],
    pub libs: Libs<'a>,
    pub follows_every_import: bool,
}

#[derive(Clone, Copy)]
pub struct SharedParses(EarlyRun);

pub fn with_shared_parses<R>(then: impl FnOnce(SharedParses) -> R) -> R {
    with_shared_run(|run| then(SharedParses(run)))
}

pub fn json_parse_schemas(asked: &Asked<'_>, shared: SharedParses) -> Answer {
    if !asked.follows_every_import {
        let answer = load(asked, true, shared.0);
        if !answer.has_unresolved_type() {
            return answer;
        }
    }
    load(asked, false, shared.0)
}

fn load(asked: &Asked<'_>, on_demand: bool, run: EarlyRun) -> Answer {
    let (cwd, paths) = (asked.cwd, asked.paths);
    let found: Guarded<Answer> = Guarded::new(Answer::default());
    let named: Vec<Vec<u8>> = paths.iter().map(|path| from_native(path)).collect();
    let collect = |checker: &mut Checker<'_, '_>, visited: FileId| {
        let program = checker.p.files;
        let position_among_named = |name: &[u8]| named.iter().position(|named| if program.is_case_sensitive { named == name } else { named.eq_ignore_ascii_case(name) });
        let (name, text): (&[u8], &[u8]) = (program.module(visited).file_name(), &program.module(visited).hir.text[..]);
        let schemas = checker.json_parse_schemas(visited);
        let path = position_among_named(name).map_or_else(|| to_native(name).to_vec(), |at| paths[at].clone());
        let mut found = found.lock();
        found.files_loaded = program.modules.len();
        found.by_path.insert(path, SchemasOfFile { text: text.to_vec(), schemas });
    };
    let command_line = parse_command_line(&[b"--skipLibCheck"], cwd);
    let request = Request {
        cwd,
        project: None,
        listed_projects: None,
        build: false,
        errors: &[],
        paths,
        are_entry_points: true,
        is_one_program: false,
        code: &[],
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        compiler_options: &command_line.compiler_options,
        threads: 0,
        libs: asked.libs,
        progress: None,
        only: None,
        order: 1,
        digests: false,
        task_clock: None,
        plan_options: PlanOptions {
            after_file_is_for_checked_files: true,
            checks_only_named: true,
            reports_nothing_about_files: true,
            declares_bun_intrinsics: true,
            early_run: Some(run),
            ..Default::default()
        },
        retains_everything: false,
        stops_like_tsc: false,
        uses_typescript_wording: false,
        loaded: None,
        checked: None,
        compile: None,
        after_file: Some(&collect),
        before_visits: None,
        all_visited_once: None,
        declaration_file_emitted: None,
    };
    let mut provided = Provided { keeps_byte_order_marks: true, loads_what_these_need: on_demand.then(|| named.clone()), ..Default::default() };
    for &(path, text) in asked.read {
        provided.already_read.insert(from_native(path), text.to_vec().into());
    }
    check_provided_then(&request, provided, |_| ());
    core::mem::take(&mut *found.lock())
}
