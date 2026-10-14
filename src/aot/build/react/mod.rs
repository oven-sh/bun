//! The React Compiler on the checker's HIR. The bundler runs it on its own parse of a file, which the code that is compiled ahead of time
//! is not made from. Here the same compiler runs on the tree that is: `adapter` converts a candidate function, `host` stands in for the
//! parser, and the lowering and the passes are the bundler's, unchanged.
//!
//! The output mode is always the client's: an executable renders, whatever `--target` the bundler was given. The files are the ones the
//! bundler takes: `.jsx` and `.tsx`, outside of `node_modules`.

mod adapter;
mod host;

use self::adapter::{Adapter, Numbering, SPARSE_STRIDE, skip_casts};
use super::{FileBuild, Shared};
use bun_ast::Stmt;
use bun_react_compiler::{
    CompileDiagnostic, Host as _, MemoStats, PendingCompile, ReactCompilerOptions, ReactCompilerState, analyze_pending, has_module_scope_opt_out, maybe_compile_pending,
};
use bun_sema::atom::{Atom, Atoms};
use bun_sema::check::{Checker, Program as Checked};
use bun_sema::hir::{self, ExprId, ExprKind, FnBody, FnId, FnKind, PatKind, StmtKind};
use bun_sema::program::FileId;
use bun_sema::util::InParallel;
use std::collections::BTreeMap;
use std::sync::{Mutex, PoisonError, RwLock};

/// A function in one of the places where the visit pass hands a function to the compiler.
struct Candidate {
    func: FnId,
    /// What the compiler takes for its name.
    name: Option<Vec<u8>>,
    in_react_hoc: bool,
}

struct Discovery<'p, 's> {
    hir: &'p hir::File<'s>,
    atoms: Atoms<'p, 's>,
    path: &'p [u8],
    found: Vec<Candidate>,
}

impl Discovery<'_, '_> {
    /// `is_react_hoc_callee` of the parser: by name.
    fn is_react_hoc_callee(&self, callee: ExprId) -> bool {
        let hir = self.hir;
        let name = match hir[skip_casts(hir, callee)].kind {
            ExprKind::Ident(name) => name,
            ExprKind::Dot { obj, name, .. } if matches!(hir[skip_casts(hir, obj)].kind, ExprKind::Ident(object) if self.atoms.bytes(object) == b"React") => name,
            _ => return false,
        };
        matches!(self.atoms.bytes(name), b"forwardRef" | b"memo")
    }

    /// `react_compiler_candidate_expr` of the parser.
    fn expr(&mut self, e: ExprId, binding: Option<Atom>) {
        let hir = self.hir;
        match hir[skip_casts(hir, e)].kind {
            ExprKind::Fn(func) => self.function(func, binding, false),
            ExprKind::Call(call) if self.is_react_hoc_callee(hir[call].callee) => {
                if let Some(first) = hir.ids(hir[call].args).next()
                    && let ExprKind::Fn(func) = hir[skip_casts(hir, first)].kind
                {
                    self.function(func, binding, true);
                }
            }
            _ => {}
        }
    }

    fn function(&mut self, func: FnId, binding: Option<Atom>, in_react_hoc: bool) {
        let declared = &self.hir[func];
        let own = (declared.kind != FnKind::Arrow && declared.name.is_some()).then_some(declared.name);
        let name = match own.or(binding) {
            Some(name) => Some(self.atoms.bytes(name).to_vec()),
            // `create_default_name` of the parser.
            None if declared.kind == FnKind::Decl => Some(format!("{}_default", bun_paths::fs::PathName::init(self.path).fmt_identifier()).into_bytes()),
            None => None,
        };
        self.found.push(Candidate { func, name, in_react_hoc });
    }

    fn run(mut self) -> Vec<Candidate> {
        let hir = self.hir;
        for stmt in hir.ids(hir.body) {
            match hir[stmt].kind {
                StmtKind::Fn(func) if matches!(hir[func].body, FnBody::Block(_)) => self.function(func, None, false),
                StmtKind::Var(decls) => {
                    for decl in decls.iter().map(|decl| &hir[decl]) {
                        if let PatKind::Ident(name) = hir[decl.pat].kind
                            && decl.init.is_some()
                        {
                            self.expr(decl.init, Some(name));
                        }
                    }
                }
                StmtKind::ExportDefault(e) | StmtKind::Expr(e) => self.expr(e, None),
                _ => {}
            }
        }
        self.found
    }
}

struct Bailout {
    diagnostic: CompileDiagnostic,
    /// Where it points to in the source. Only with `Numbering::Dense`.
    pos: Option<u32>,
}

enum Outcome {
    /// Its name is not that of a component or a hook, and nothing asks for it.
    Other,
    OptedOut(&'static str),
    /// It has the name, and does not look like one.
    NotReact,
    BailedOut(Vec<Bailout>),
    Compiled(MemoStats),
}

impl Outcome {
    fn agrees_with(&self, other: &Outcome) -> bool {
        match (self, other) {
            (Outcome::Other, Outcome::Other) | (Outcome::NotReact, Outcome::NotReact) => true,
            (Outcome::OptedOut(a), Outcome::OptedOut(b)) => a == b,
            (Outcome::Compiled(a), Outcome::Compiled(b)) => a == b,
            (Outcome::BailedOut(a), Outcome::BailedOut(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.diagnostic.category == b.diagnostic.category && a.diagnostic.reason == b.diagnostic.reason)
            }
            _ => false,
        }
    }
}

/// The compiler on one file, under one numbering.
struct Run<'a, 'c, 'p, 's> {
    adapter: Adapter<'a, 'c, 'p, 's>,
    state: ReactCompilerState,
    hir: &'p hir::File<'s>,
    module_opts_out: bool,
}

fn run<R>(build: &mut FileBuild<'_, '_, '_>, file: FileId, numbering: Numbering, with: impl FnOnce(&mut Run<'_, '_, '_, '_>) -> R) -> R {
    let hir = build.hir(file);
    let arena = bun_alloc::Arena::new();
    let mut allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _scope = allocator.enter();
    let mut adapter = Adapter::new(build, file, &arena, numbering);
    let module_opts_out = has_module_scope_opt_out(&adapter.directives(hir.body));
    let options = ReactCompilerOptions { enabled: true, is_dev: adapter.host.is_jsx_dev(), ..Default::default() };
    let state = ReactCompilerState::new(options, module_opts_out, adapter.import_bindings());
    let mut compiler = Run { adapter, state, hir, module_opts_out };
    with(&mut compiler)
}

impl Run<'_, '_, '_, '_> {
    /// `Err`: the visit pass does not hand it over.
    fn convert(&mut self, candidate: &Candidate) -> Result<(PendingCompile, Vec<Stmt>), Outcome> {
        let declared = &self.hir[candidate.func];
        let is_suppressed = self.adapter.is_under_a_suppression(candidate.func);
        let prologue = match declared.body {
            FnBody::Block(list) => self.adapter.directives(list),
            _ => Vec::new(),
        };
        if !self.state.may_compile(candidate.name.as_deref(), candidate.in_react_hoc, is_suppressed, &prologue) {
            return Err(if self.module_opts_out {
                Outcome::OptedOut("the module opts out")
            } else if is_suppressed {
                Outcome::OptedOut("a rule of react-hooks is disabled")
            } else if has_module_scope_opt_out(&prologue) {
                Outcome::OptedOut("a directive opts out")
            } else {
                Outcome::Other
            });
        }
        let function = self.adapter.function(candidate.func);
        let pending = PendingCompile {
            args: function.args,
            flags: function.flags,
            body_loc: function.body_loc,
            args_loc: function.body_loc,
            binding: None,
            in_react_hoc: candidate.in_react_hoc,
        };
        Ok((pending, function.body))
    }

    fn compile(&mut self, candidate: &Candidate) -> Outcome {
        let (pending, mut body) = match self.convert(candidate) {
            Ok(converted) => converted,
            Err(outcome) => return outcome,
        };
        let compiled = maybe_compile_pending(&mut self.state, &mut self.adapter.host, &pending, &mut body, candidate.name.as_deref());
        let diagnostics = self.state.take_diagnostics();
        match compiled {
            Some((_, result)) => Outcome::Compiled(result.memo),
            None if diagnostics.is_empty() => Outcome::NotReact,
            None => Outcome::BailedOut(
                (diagnostics.into_iter())
                    .map(|diagnostic| {
                        let pos = diagnostic.loc.and_then(|loc| self.adapter.pos(loc.start.index?));
                        Bailout { diagnostic, pos }
                    })
                    .collect(),
            ),
        }
    }

    /// The reactive function and what it refers to, as text. `None`: there is none.
    fn dump(&mut self, candidate: &Candidate) -> Option<String> {
        let (pending, mut body) = self.convert(candidate).ok()?;
        let analysis = analyze_pending(&mut self.state, &self.adapter.host, &pending, &mut body, candidate.name.as_deref());
        self.state.take_diagnostics();
        let analysis = analysis?;
        let env = &analysis.env;
        Some(format!("{:?}\n{:?}\n{:?}\n{:?}\n{:?}", analysis.function, env.scopes, env.identifiers, env.functions, env.get_outlined_functions()))
    }
}

/// A dump made with `Numbering::Sparse`, as `Numbering::Dense` would have it.
fn with_dense_locations(dump: &str) -> String {
    const INDEX: &str = "index: Some(";
    let mut dense = String::with_capacity(dump.len());
    let mut rest = dump;
    while let Some(at) = rest.find(INDEX) {
        let (before, after) = rest.split_at(at + INDEX.len());
        dense.push_str(before);
        let digits = after.find(')').unwrap_or(after.len());
        match after[..digits].parse::<u32>() {
            Ok(start) => dense.push_str(&(start / SPARSE_STRIDE).to_string()),
            Err(_) => dense.push_str(&after[..digits]),
        }
        rest = &after[digits..];
    }
    dense.push_str(rest);
    dense
}

/// Where two dumps part.
fn first_difference(a: &str, b: &str) -> String {
    let same = a.bytes().zip(b.bytes()).take_while(|(a, b)| a == b).count();
    let excerpt = |text: &str| String::from_utf8_lossy(&text.as_bytes()[same.saturating_sub(40)..text.len().min(same + 40)]).into_owned();
    format!("`{}` or `{}`", excerpt(a), excerpt(b))
}

#[derive(Default)]
struct Totals {
    files: usize,
    others: usize,
    opted_out: usize,
    not_react: usize,
    bailed_out: usize,
    compiled: usize,
    scopes: u32,
    slots: u32,
    values: u32,
    pruned_scopes: u32,
    outlined: u32,
    depend_on_locations: usize,
}

impl Totals {
    fn add(&mut self, other: &Totals) {
        self.files += other.files;
        self.others += other.others;
        self.opted_out += other.opted_out;
        self.not_react += other.not_react;
        self.bailed_out += other.bailed_out;
        self.compiled += other.compiled;
        self.scopes += other.scopes;
        self.slots += other.slots;
        self.values += other.values;
        self.pruned_scopes += other.pruned_scopes;
        self.outlined += other.outlined;
        self.depend_on_locations += other.depend_on_locations;
    }

    fn summary(&self) -> String {
        format!(
            "{} candidates: {} compiled, {} bailed out, {} neither component nor hook, {} opted out; {} scopes, {} slots, {} values, {} pruned scopes, {} outlined; {} other functions",
            self.compiled + self.bailed_out + self.not_react + self.opted_out,
            self.compiled,
            self.bailed_out,
            self.not_react,
            self.opted_out,
            self.scopes,
            self.slots,
            self.values,
            self.pruned_scopes,
            self.outlined,
            self.others
        )
    }
}

struct FileReport {
    path: String,
    lines: Vec<String>,
    totals: Totals,
    /// Category and reason of each bail-out.
    reasons: Vec<String>,
}

/// `--aot-explain=react` of the standalone checker: what the compiler makes of each file. Each call is for the hook of the driver's
/// `Request` that its description names.
pub struct Report<'a> {
    constants: &'a crate::Constants,
    checks_locations: bool,
    /// `None`: `begin` has not been called.
    shared: RwLock<Option<Shared<'a>>>,
    files: Mutex<Vec<FileReport>>,
}

impl<'a> Report<'a> {
    /// `checks_locations`: each function is also compiled with its locations renumbered, which is to make no difference.
    pub fn new(constants: &'a crate::Constants, checks_locations: bool) -> Report<'a> {
        Report { constants, checks_locations, shared: RwLock::new(None), files: Mutex::new(Vec::new()) }
    }

    /// `Request::loaded`
    pub fn begin(&self, program: &Checked<'_>, roots: &[FileId], in_parallel: InParallel<'_>) {
        *self.shared.write().unwrap_or_else(PoisonError::into_inner) = Some(Shared::new(program, &[roots.to_vec()], self.constants, in_parallel));
        self.files.lock().unwrap_or_else(PoisonError::into_inner).clear();
    }

    /// `Request::after_file`
    pub fn explain_file(&self, c: &mut Checker<'_, '_>, file: FileId) {
        let path = c.p.files.module(file).file_name();
        if !bun_sema::resolve::is_jsx_file_name(path) || bun_core::strings::contains(path, b"/node_modules/") {
            return;
        }
        let shared = self.shared.read().unwrap_or_else(PoisonError::into_inner);
        let shared = shared.as_ref().expect("`begin` comes first");
        let hir = c.hir(file);
        let shown = String::from_utf8_lossy(path).into_owned();
        let mut report = FileReport { path: shown.clone(), lines: Vec::new(), totals: Totals { files: 1, ..Default::default() }, reasons: Vec::new() };
        if hir.has_parse_diagnostics || hir.has_errors || hir.ran_out_of_stack {
            report.lines.push(format!("{shown}: it does not parse"));
            self.files.lock().unwrap_or_else(PoisonError::into_inner).push(report);
            return;
        }
        let candidates = Discovery { hir, atoms: c.atoms(), path, found: Vec::new() }.run();
        let mut build = FileBuild::new(c, shared, file);
        let all = |run: &mut Run<'_, '_, '_, '_>| candidates.iter().map(|candidate| run.compile(candidate)).collect::<Vec<Outcome>>();
        let outcomes = run(&mut build, file, Numbering::Dense, all);

        let line_of = |pos: u32| hir.text[..(pos as usize).min(hir.text.len())].iter().filter(|&&byte| byte == b'\n').count() + 1;
        let title = |candidate: &Candidate| {
            let name = candidate.name.as_deref().map_or("(anonymous)".into(), String::from_utf8_lossy);
            format!("{shown}:{}: {name}", line_of(hir[candidate.func].start))
        };
        let totals = &mut report.totals;
        for (candidate, outcome) in candidates.iter().zip(&outcomes) {
            match outcome {
                Outcome::Other => totals.others += 1,
                Outcome::OptedOut(why) => {
                    totals.opted_out += 1;
                    report.lines.push(format!("{}: opted out: {why}", title(candidate)));
                }
                Outcome::NotReact => {
                    totals.not_react += 1;
                    report.lines.push(format!("{}: neither component nor hook", title(candidate)));
                }
                Outcome::BailedOut(bailouts) => {
                    totals.bailed_out += 1;
                    for Bailout { diagnostic, pos } in bailouts {
                        let reason = format!("{:?}: {}", diagnostic.category, diagnostic.reason);
                        let description = diagnostic.description.as_deref().map_or(String::new(), |description| format!(". {description}"));
                        let line = pos.map_or(String::new(), |pos| format!(" (line {})", line_of(pos)));
                        report.lines.push(format!("{}: bailed out: {reason}{description}{line}", title(candidate)));
                        report.reasons.push(reason);
                    }
                }
                Outcome::Compiled(memo) => {
                    totals.compiled += 1;
                    totals.scopes += memo.blocks;
                    totals.slots += memo.slots;
                    totals.values += memo.values;
                    totals.pruned_scopes += memo.pruned_blocks;
                    totals.outlined += memo.outlined;
                    report.lines.push(format!(
                        "{}: compiled: {} scopes, {} slots, {} values, {} pruned scopes, {} outlined",
                        title(candidate),
                        memo.blocks,
                        memo.slots,
                        memo.values,
                        memo.pruned_blocks,
                        memo.outlined
                    ));
                }
            }
        }

        if self.checks_locations {
            let dumps = |run: &mut Run<'_, '_, '_, '_>| candidates.iter().map(|candidate| run.dump(candidate)).collect::<Vec<Option<String>>>();
            let dense = run(&mut build, file, Numbering::Dense, dumps);
            let sparse = run(&mut build, file, Numbering::Sparse, dumps);
            let shuffled = run(&mut build, file, Numbering::Shuffled, all);
            for (index, candidate) in candidates.iter().enumerate() {
                let sparse = sparse[index].as_deref().map(with_dense_locations);
                let difference = if dense[index] != sparse {
                    Some(match (&dense[index], &sparse) {
                        (Some(dense), Some(sparse)) => first_difference(dense, sparse),
                        _ => "analyzed or not".to_owned(),
                    })
                } else if !outcomes[index].agrees_with(&shuffled[index]) {
                    Some("another outcome in another order".to_owned())
                } else {
                    None
                };
                if let Some(difference) = difference {
                    report.totals.depend_on_locations += 1;
                    report.lines.push(format!("{}: depends on locations: {difference}", title(candidate)));
                }
            }
        }
        report.lines.insert(0, format!("{shown}: {}", report.totals.summary()));
        self.files.lock().unwrap_or_else(PoisonError::into_inner).push(report);
    }

    /// The lines to print, once all files are checked.
    pub fn finish(&self) -> Vec<String> {
        let mut files = std::mem::take(&mut *self.files.lock().unwrap_or_else(PoisonError::into_inner));
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let mut totals = Totals::default();
        let mut reasons: BTreeMap<&str, usize> = BTreeMap::new();
        let mut lines = Vec::new();
        for file in &files {
            totals.add(&file.totals);
            lines.extend(file.lines.iter().cloned());
            for reason in &file.reasons {
                *reasons.entry(reason).or_default() += 1;
            }
        }
        lines.push(format!("{} files: {}", totals.files, totals.summary()));
        let mut reasons: Vec<(&str, usize)> = reasons.into_iter().collect();
        reasons.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        lines.extend(reasons.into_iter().map(|(reason, count)| format!("{count} times: {reason}")));
        if self.checks_locations {
            lines.push(format!("{} functions depend on locations", totals.depend_on_locations));
        }
        lines
    }
}
