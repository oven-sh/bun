use bun_builtin_syntax::{Archive, Reason, Trigger};
use bun_resolve_builtins::HardcodedModule::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use bun_sema::check::Program;
use bun_sema::hir::{BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, PatKind, PropId, PropKey, PropKind, Span, SpecifierKind, StmtId, StmtKind, UnOp, VarKind};
use bun_sema::program::{Builtin, EVERY_ROOT, FileId, LoadedBy, Module, ReleasedRoot};
use bun_sema::util::{FxHashMap, FxHashSet};

#[derive(Clone, PartialEq, Eq)]
pub enum InclusionReason {
    Always,
    Named(Vec<u8>),
    Trigger(Vec<u8>),
    AnyName(&'static str),
    RequiredBy(u32),
}

#[derive(Clone)]
pub struct Included {
    pub id: u32,
    pub why: InclusionReason,
    pub loaded_by: LoadedBy,
}

pub struct Found {
    pub included: Vec<Included>,
    pub native: Vec<(Vec<u8>, Option<u32>)>,
    pub loader_entries: Vec<(&'static str, Vec<u8>, u32)>,
    pub loader_entry_sites: Vec<(u32, ExprId)>,
    pub file_loader_entry_sites: Vec<(u32, ExprId)>,
    pub runtime_use: RuntimeUse,
    interner: u64,
}

const PLACES_SHOWN_PER_REASON: usize = 4;
const PRELUDE_DIRECTORY: &[u8] = b"/.bun-aot-prelude/";
const HELPERS_OF_THE_BUNDLER: &[u8] = b"/.bun-aot-prelude/bun-wrap.js";

fn add_reason(reasons: &mut Vec<(&'static str, Vec<u8>)>, why: &'static str, path: &[u8]) {
    let mut alike = reasons.iter().filter(|reason| reason.0 == why);
    if !alike.clone().any(|reason| reason.1 == path) && alike.nth(PLACES_SHOWN_PER_REASON - 1).is_none() {
        reasons.push((why, path.to_vec()));
    }
}

const ESCAPES: [(&str, &[&[u8]]); 3] = [("the global object", &[b"global"]), ("Bun", &[b"Bun"]), ("process", &[b"process"])];

fn written_in_a_fact(name: &[u8]) -> &[u8] {
    if name == b"*" { b"\"*\"" } else { name }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Name {
    Member(u8, Atom),
    Native(Atom, Atom),
    NativeModule(Atom),
    Property(Atom),
    PropertyReadByProgram(Atom),
    KeyDefinedByProgram(Atom),
    SymbolNamedByProgram(Atom),
    ConstructorOfFunctions,
    ExportOfNodeModule(Atom),
    ServeOption(Atom),
    ServeRouteOption(Atom),
    Syntax(&'static str),
    Regexp(&'static str),
    PrintsObject,
    PrintsArguments,
    Value(Atom),
    Symbol(Atom),
    ListensFor(u8),
    Binding(Atom),
    LoadsPage,
}

impl Name {
    fn member(kind: usize, name: Atom) -> Name {
        Name::Member(kind as u8, name)
    }

    fn fact(self, atoms: &Interner<'_>) -> Vec<u8> {
        let written = |name: Atom| written_in_a_fact(atoms.bytes(name));
        match self {
            Name::Member(kind, name) => [GLOBALS.get(usize::from(kind)).map_or(&b"global"[..], |global| global.0), b" ", if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::Native(file, symbol) => [b"native ", atoms.bytes(file), b":", atoms.bytes(symbol)].concat(),
            Name::NativeModule(specifier) => [&b"native "[..], Alias::get(atoms.bytes(specifier), bun_ast::Target::Bun, Cfg::default()).map_or_else(|| atoms.bytes(specifier), |alias| alias.path.as_bytes())].concat(),
            Name::ConstructorOfFunctions => b"finds Function".to_vec(),
            Name::PrintsObject | Name::PrintsArguments => b"prints object".to_vec(),
            Name::LoadsPage => b"loader html".to_vec(),
            Name::ListensFor(event) => [b"process on:", EVENTS_OF_THE_CHANNEL[usize::from(event)]].concat(),
            Name::Binding(name) => [b"process binding:", atoms.bytes(name)].concat(),
            Name::Value(name) => [&b"value "[..], written(name)].concat(),
            Name::Symbol(name) => [&b"symbol "[..], if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::Property(name) => [&b"property "[..], if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::PropertyReadByProgram(name) => [b"program-property ", written(name)].concat(),
            Name::KeyDefinedByProgram(name) => [&b"program-defined-key "[..], if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::SymbolNamedByProgram(name) => [&b"program-symbol "[..], if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::ExportOfNodeModule(name) => [b"export node:module ", atoms.bytes(name)].concat(),
            Name::ServeOption(name) => [&b"serve-option "[..], if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::ServeRouteOption(name) => [&b"serve-route-option "[..], if name.is_some() { written(name) } else { b"*" }].concat(),
            Name::Syntax(name) => [b"syntax ", name.as_bytes()].concat(),
            Name::Regexp(what) => [b"regexp ", what.as_bytes()].concat(),
        }
    }
}

struct RuntimeSource {
    path: Vec<u8>,
    module: Option<Vec<u8>>,
    facts: Vec<Vec<u8>>,
    named_at: Vec<(ExprId, Name)>,
    escapes: Vec<(ExprId, &'static str)>,
    called_on_globals: FxHashSet<(usize, Atom)>,
    dispatched: Dispatched,
}

#[derive(Default)]
pub struct RuntimeUse {
    pub why_open: Vec<(&'static str, Vec<u8>)>,
    pub facts: Vec<Vec<u8>>,
    runtime_sources: Vec<RuntimeSource>,
    runs_in_place: bool,
    uncompiled_runtime_sources: Vec<Vec<u8>>,
    openings: Vec<(Vec<u8>, ExprId, &'static str)>,
    files_that_may_be_sloppy: Vec<Vec<u8>>,
    reading_any_property: Vec<Vec<u8>>,
    named_at: Vec<(Vec<u8>, Vec<(ExprId, Name)>)>,
    stored_on_globals: Vec<(Vec<u8>, ExprId, usize, Atom)>,
    called_on_globals: FxHashSet<(usize, Atom)>,
    listeners_of_the_global_object: Vec<(Vec<u8>, ExprId, Atom)>,
    dispatched: Dispatched,
    paths_as_written: FxHashMap<Vec<u8>, Vec<u8>>,
}

#[derive(Default, Clone)]
struct Dispatched {
    may_be_of_any_type: bool,
    types_and_classes: Vec<(Atom, Atom)>,
    names_stored_on_the_global_object: FxHashSet<Atom>,
}

impl Dispatched {
    fn add(&mut self, later: Dispatched) {
        self.may_be_of_any_type |= later.may_be_of_any_type;
        self.types_and_classes.extend(later.types_and_classes);
        self.names_stored_on_the_global_object.extend(later.names_stored_on_the_global_object);
    }

    fn may_be_of_type(&self, event: Atom) -> bool {
        self.may_be_of_any_type || self.types_and_classes.iter().any(|&(dispatched, class)| dispatched == event || self.names_stored_on_the_global_object.contains(&class))
    }
}

fn types_and_class_of_event_made_at(module: &Module<'_>, atoms: &Interner<'_>, global_objects: &[Atom], event: ExprId) -> Option<impl Iterator<Item = (Atom, Atom)>> {
    let (hir, bound) = (&module.hir, &module.bound);
    let made = match hir[event].kind {
        ExprKind::Ident(_) => {
            let holder = bound.expr_symbol[event.idx()].some()?;
            let made = initializer_of_variable_stored_once(module, holder)?;
            (mentions_of(module, |symbol| symbol == holder).len() == 1 && is_seen_only_in_its_file(module, holder)).then_some(made)?
        }
        _ => event,
    };
    let ExprKind::New(call) = hir[made].kind else { return None };
    if hir.is_in_with(hir[made].pos) {
        return None;
    }
    let class = match hir[hir[call].callee].kind {
        ExprKind::Ident(class) if is_free(module, hir[call].callee) => class,
        ExprKind::Dot { obj, name, .. } if matches!(hir[obj].kind, ExprKind::Ident(object) if global_objects.contains(&object) && is_free(module, obj)) => name,
        _ => return None,
    };
    let first = hir.ids(hir[call].args).next()?;
    let types = strings_written_or_held_by_a_constant(module, first)?;
    is_member_of(b"classes-of-events", atoms.bytes(class)).then(|| types.map(move |event| (event, class)))
}

impl RuntimeUse {
    pub fn what_the_flag_against_code_from_strings_would_do(&self) -> Option<&'static str> {
        bun_ast::type_tags::what_the_flag_against_code_from_strings_would_do(&self.text())
    }

    pub fn text(&self) -> Vec<u8> {
        let mut text = if self.why_open.is_empty() { b"closed\n".to_vec() } else { Vec::new() };
        let as_written = |path: &'_ Vec<u8>| self.paths_as_written.get(path).unwrap_or(path).as_slice().to_vec();
        for (why, path) in &self.why_open {
            let before_path: &[u8] = if path.is_empty() { b"" } else { b" in " };
            text.extend_from_slice(&[b"open ", why.as_bytes(), before_path, &as_written(path), b"\n"].concat());
        }
        let mut facts = self.facts.clone();
        if !self.why_open.is_empty() {
            facts.push(b"world open".to_vec());
        }
        if may_strings_become_code() {
            facts.push(b"text-to-code allowed".to_vec());
        }
        for source in &self.runtime_sources {
            facts.extend_from_slice(&source.facts);
            for escape in &source.escapes {
                for &kind in ESCAPES.iter().filter(|it| it.0 == escape.1).flat_map(|it| it.1) {
                    facts.push([kind, b" *"].concat());
                    facts.push([b"escapes ", kind, b" ", &source.path].concat());
                }
            }
        }
        facts.extend(self.reading_any_property.iter().map(|path| [b"escapes property ", &as_written(path)[..]].concat()));
        if facts.iter().any(|fact| fact.starts_with(b"escapes Bun ") || fact.starts_with(b"escapes global ")) {
            facts.extend([b"serve-option *".to_vec(), b"serve-route-option *".to_vec()]);
        }
        facts.sort_unstable();
        facts.dedup();
        for fact in &facts {
            text.extend_from_slice(fact);
            text.push(b'\n');
        }
        text
    }

    fn open_for(&mut self, reasons: Vec<(&'static str, Vec<u8>)>) {
        self.why_open.clear();
        for (why, path) in reasons {
            add_reason(&mut self.why_open, why, &path);
        }
        if self.runs_in_place {
            add_reason(&mut self.why_open, "it runs in place", b"");
        }
        for path in &self.uncompiled_runtime_sources {
            add_reason(&mut self.why_open, "something is not compiled", path);
        }
    }

    fn add_names_of(&mut self, scan: &Scan<'_, '_>) {
        let atoms = scan.atoms;
        self.facts.extend(scan.global_names.iter().map(|&name| [b"global ", atoms.bytes(name)].concat()));
        let read = scan.read.iter().filter(|read| read.1.is_some());
        self.facts.extend(read.map(|&(global, name)| [GLOBALS[global].0, b" ", atoms.bytes(name)].concat()));
        let escaping = (2..GLOBALS.len()).filter(|&global| scan.read.contains(&(global, Atom::NONE)));
        self.facts.extend(escaping.map(|global| [GLOBALS[global].0, b" *"].concat()));
        let kinds = GLOBALS.iter().map(|global| global.0).chain([&b"global"[..]]);
        self.facts.extend(kinds.zip(scan.touches_every_member_of).filter(|it| it.1).map(|it| [it.0, b" *"].concat()));
        self.facts.extend(scan.native_bindings.iter().map(|&(file, symbol)| [b"native ", atoms.bytes(file), b":", atoms.bytes(symbol)].concat()));
        self.facts.extend(scan.named_at.iter().filter(|named| matches!(named.2, Name::ExportOfNodeModule(_) | Name::ServeOption(_) | Name::ServeRouteOption(_))).map(|named| named.2.fact(atoms)));
        self.facts.sort_unstable();
        self.facts.dedup();
    }
}

const GLOBALS: [(&[u8], &[&[u8]]); 5] = [(b"process", &[b"process", b"node:process"]), (b"Bun", &[b"bun"]), (b"console", &[]), (b"performance", &[]), (b"Intl", &[])];
const BUN: usize = 1;
const PERFORMANCE: usize = 3;
const GLOBAL_OBJECT: usize = GLOBALS.len();
const GLOBAL_OBJECTS: [&[u8]; 4] = [b"globalThis", b"global", b"self", b"window"];
const SAFE_REQUIRE_PROPERTIES: [&[u8]; 4] = [b"resolve", b"cache", b"main", b"extensions"];
const OF_MODULE: [&[u8]; 7] = [b"exports", b"id", b"filename", b"path", b"paths", b"loaded", b"constructor"];
const SAFE_FUNCTION_PROPERTIES: [&[u8]; 3] = [b"prototype", b"name", b"length"];
const SAFE_IMPORT_META_PROPERTIES: [&[u8]; 9] = [b"url", b"dir", b"dirname", b"file", b"filename", b"path", b"main", b"env", b"resolve"];
const EVENTS_OF_THE_CHANNEL: [&[u8]; 2] = [b"message", b"disconnect"];
const LISTENS: [&[u8]; 5] = [b"on", b"once", b"addListener", b"prependListener", b"prependOnceListener"];
const MODULES_WITH_LOADER_ACCESS: [&[u8]; 14] = [b"cluster", b"node:cluster", b"module", b"node:module", b"vm", b"node:vm", b"repl", b"node:repl", b"worker_threads", b"node:worker_threads", b"inspector", b"node:inspector", b"inspector/promises", b"node:inspector/promises"];
const SAFE_CLUSTER_EXPORTS: [&[u8]; 12] = [b"isPrimary", b"isMaster", b"isWorker", b"fork", b"setupPrimary", b"setupMaster", b"settings", b"workers", b"disconnect", b"schedulingPolicy", b"SCHED_NONE", b"SCHED_RR"];
const SAFE_NODE_MODULE_EXPORTS: [&[u8]; 5] = [b"builtinModules", b"isBuiltin", b"SourceMap", b"findSourceMap", b"syncBuiltinESMExports"];
const SAFE_WORKER_THREADS_EXPORTS: [&[u8]; 13] = [
    b"isMainThread",
    b"parentPort",
    b"workerData",
    b"threadId",
    b"resourceLimits",
    b"MessageChannel",
    b"MessagePort",
    b"BroadcastChannel",
    b"receiveMessageOnPort",
    b"markAsUntransferable",
    b"getEnvironmentData",
    b"setEnvironmentData",
    b"SHARE_ENV",
];

const RETURN_THE_RECEIVER: [&[u8]; 9] = [b"on", b"once", b"addListener", b"prependListener", b"prependOnceListener", b"off", b"removeListener", b"removeAllListeners", b"setMaxListeners"];

fn member_that_opens_the_world(atoms: &Interner<'_>, global: usize, name: Atom) -> Option<&'static str> {
    match (global, atoms.bytes(Some(name).filter(|name| name.is_some())?)) {
        (0, b"dlopen") => Some("process.dlopen"),
        (0, b"binding" | b"_linkedBinding") => Some("process.binding"),
        (1, b"FFI") => Some("bun:ffi"),
        (1, b"ModuleGraph") => Some("Bun.ModuleGraph"),
        _ => None,
    }
}

fn binding_asked_for_by_name(module: &Module<'_>, atoms: &Interner<'_>, global: usize, name: Atom, member: ExprId) -> Option<Atom> {
    let hir = &module.hir;
    if global != 0 || name.is_none() || atoms.bytes(name) != b"binding" {
        return None;
    }
    let member = member.some()?;
    let Parent::Expr(around) = module.bound.expr_parent[member.idx()] else { return None };
    match hir[around].kind {
        ExprKind::Call(call) if hir[call].callee == member && !hir[call].args.is_empty() => match hir[hir.id_at(hir[call].args, 0)].kind {
            ExprKind::String(asked) => Some(asked),
            _ => None,
        },
        _ => None,
    }
}

const NATIVE_ADDON: &str = "a native addon";
const APP_OF_A_SERVER: &str = "the app option of Bun.serve";
const STYLE_OF_A_ROUTE: &str = "a route of Bun.serve with a style";
const OPTIONS_OF_A_SERVER_THAT_ARE_NOT_SEEN: &str = "options of Bun.serve that are not seen";

fn module_that_opens_the_world(atoms: &Interner<'_>, specifier: Atom) -> Option<&'static str> {
    match atoms.bytes(Some(specifier).filter(|specifier| specifier.is_some())?) {
        b"bun:internal-for-testing" => Some("bun:internal-for-testing"),
        b"bun:ffi" => Some("bun:ffi"),
        b"bun:jsc" => Some("bun:jsc"),
        b"bun:main" => Some("bun:main"),
        b"bun:wrap" => Some("bun:wrap"),
        url if [&b"http://"[..], b"https://", b"data:", b"file:", b"blob:"].iter().any(|scheme| url.starts_with(scheme)) => Some("an import of a URL"),
        path if path.ends_with(b".node") => Some(NATIVE_ADDON),
        _ => None,
    }
}

const NATIVE_FUNCTIONS: [&[u8]; 9] = [b"queueMicrotask", b"setTimeout", b"setInterval", b"setImmediate", b"clearTimeout", b"clearInterval", b"clearImmediate", b"fetch", b"structuredClone"];

const EVENT_TARGET_FUNCTIONS: [&[u8]; 3] = [b"addEventListener", b"removeEventListener", b"dispatchEvent"];
const REACH_LISTENERS: [&[u8]; 2] = [b"addEventListener", b"dispatchEvent"];
const EVENTS_OF_THE_GLOBAL_OBJECT: [&[u8]; 3] = [b"message", b"messageerror", b"error"];
const LOOK_UP_A_MEMBER: [&[u8]; 4] = [b"hasOwnProperty", b"propertyIsEnumerable", b"__lookupGetter__", b"__lookupSetter__"];
const HAND_THE_RECEIVER_ON: [&[u8]; 3] = [b"valueOf", b"__defineGetter__", b"__defineSetter__"];
const LEAD_TO_THE_PROTOTYPE: [&[u8]; 2] = [b"__proto__", b"constructor"];
const OF_A_DESCRIPTOR_WITH_A_VALUE: [&[u8]; 4] = [b"value", b"writable", b"enumerable", b"configurable"];

fn is_read_only_by_literal_names(module: &Module<'_>, atoms: &Interner<'_>, start: ExprId, is_itself: &dyn Fn(Atom) -> bool, reads: &mut Vec<(Atom, ExprId)>, looked_up: &mut Vec<Atom>, stored_under_any_name: &mut Vec<(ExprId, ExprId)>) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_receiver_of_native_function = |call: bun_sema::hir::CallId, e: ExprId| {
        !hir[call].args.is_empty()
            && hir.id_at(hir[call].args, 0) == e
            && matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, name, .. } if matches!(atoms.bytes(name), b"bind" | b"call" | b"apply")
                && match hir[obj].kind {
                    ExprKind::Ident(function) => bound.expr_symbol[obj.idx()].is_none() && NATIVE_FUNCTIONS.contains(&atoms.bytes(function)),
                    ExprKind::Dot { obj: holder, name: function, .. } => {
                        matches!((hir[holder].kind, hir[e].kind), (ExprKind::Ident(holder_name), ExprKind::Ident(receiver)) if holder_name == receiver && bound.expr_symbol[holder.idx()] == bound.expr_symbol[e.idx()])
                            && (NATIVE_FUNCTIONS.contains(&atoms.bytes(function)) || EVENT_TARGET_FUNCTIONS.contains(&atoms.bytes(function)))
                    }
                    _ => false,
                })
    };
    let initializer_of_constant = |e: ExprId| {
        let symbol = bound.expr_symbol[e.idx()];
        if symbol.is_none() || !is_never_stored_to(module, symbol) {
            return None;
        }
        match bound.symbols[symbol.idx()].decls[..] {
            [Decl::Var(pat) | Decl::Require(pat)] => match bound.pat_parent[pat.idx()] {
                PatParent::Var(declaration) if hir[declaration].pat == pat && hir[declaration].init.is_some() => Some(hir[declaration].init),
                _ => None,
            },
            _ => None,
        }
    };
    let creates_symbol = |e: ExprId| {
        matches!(hir[e].kind, ExprKind::Call(call) if match hir[hir[call].callee].kind {
            ExprKind::Ident(function) => atoms.bytes(function) == b"Symbol" && bound.expr_symbol[hir[call].callee.idx()].is_none(),
            ExprKind::Dot { obj, name, .. } => atoms.bytes(name) == b"for" && matches!(hir[obj].kind, ExprKind::Ident(function) if atoms.bytes(function) == b"Symbol" && bound.expr_symbol[obj.idx()].is_none()),
            _ => false,
        })
    };
    let is_symbol = |key: ExprId| creates_symbol(key) || matches!(hir[key].kind, ExprKind::Ident(_)) && initializer_of_constant(key).is_some_and(&creates_symbol);
    let is_only_compared = |e: ExprId| matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } | ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, .. }));
    let is_nullish_literal = |e: ExprId| matches!(hir[e].kind, ExprKind::Null) || matches!(hir[e].kind, ExprKind::Ident(name) if atoms.bytes(name) == b"undefined" && bound.expr_symbol[e.idx()].is_none());
    let is_first_argument_of = |call: bun_sema::hir::CallId, e: ExprId, function_of_object: &[u8]| {
        !hir[call].args.is_empty()
            && hir.id_at(hir[call].args, 0) == e
            && matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, name, .. } if atoms.bytes(name) == function_of_object && matches!(hir[obj].kind, ExprKind::Ident(object) if atoms.bytes(object) == b"Object" && bound.expr_symbol[obj.idx()].is_none()))
    };
    let receives_property = |call: bun_sema::hir::CallId, e: ExprId| is_first_argument_of(call, e, b"defineProperty");
    let reads_own_property = |call: bun_sema::hir::CallId, e: ExprId| {
        module.builtin.is_some() && hir[call].args.len() == 2 && hir.id_at(hir[call].args, 0) == e && matches!(hir[hir[call].callee].kind, ExprKind::Ident(intrinsic) if atoms.bytes(intrinsic) == b"$getByIdDirect")
    };
    let constant_string = |key: ExprId| {
        let mut written = if matches!(hir[key].kind, ExprKind::Ident(_)) { initializer_of_constant(key)? } else { key };
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) = hir[written].kind {
            written = expr;
        }
        match hir[written].kind {
            ExprKind::String(name) => Some(name),
            _ => None,
        }
    };
    let mentions_arguments = |function: bun_sema::hir::FnId| {
        let (from, to) = match bound.fns[function.idx()].owner {
            FnOwner::Expr(owner) => (hir[owner].pos, hir[owner].end),
            FnOwner::Stmt(owner) => (hir[owner].start, hir[owner].loc.end),
            _ => return true,
        };
        bound.arguments_objects.iter().any(|&mention| (from..to).contains(&hir[mention].pos))
    };
    let receiving_parameter = |call: bun_sema::hir::CallId, e: ExprId| {
        let index = hir.ids(hir[call].args).position(|argument: ExprId| argument == e)?;
        if hir.ids(hir[call].args).take(index + 1).any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return None;
        }
        let callee = hir[call].callee;
        let function = match hir[callee].kind {
            ExprKind::Fn(function) => function,
            ExprKind::Ident(_) if bound.expr_symbol[callee.idx()].is_some() => match bound.symbols[bound.expr_symbol[callee.idx()].idx()].decls[..] {
                [Decl::Fn(function)] if is_never_stored_to(module, bound.expr_symbol[callee.idx()]) => function,
                _ => match hir[initializer_of_constant(callee)?].kind {
                    ExprKind::Fn(function) => function,
                    _ => return None,
                },
            },
            _ => return None,
        };
        if mentions_arguments(function) {
            return None;
        }
        let parameter = &hir[hir[function].params.iter().nth(index)?];
        (matches!(hir[parameter.pat].kind, PatKind::Ident(_)) && !parameter.flags.contains(Flags::REST)).then(|| bound.pat_symbol[parameter.pat.idx()])
    };
    let is_imported = |decl: &Decl| matches!(decl, Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) | Decl::ImportEquals(_));
    let is_free_or_imported = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()].some().is_none_or(|symbol| !is_made_by_the_program(module, symbol) || bound.symbols[symbol.idx()].decls.iter().all(is_imported));
    let is_start_written_by_name = match hir[start].kind {
        ExprKind::Ident(_) => is_free_or_imported(start),
        ExprKind::Call(_) | ExprKind::Await(_) => true,
        _ => member_at(module, start).is_some_and(|(obj, name)| (name == known::default || !is_itself(name)) && is_free_or_imported(without_assertions(module, obj))),
    };
    let mut pending = vec![start];
    let mut written_itself = vec![start];
    let mut holders: Vec<SymbolId> = Vec::new();
    let mut seen: FxHashSet<ExprId> = FxHashSet::default();
    while let Some(e) = pending.pop() {
        if !seen.insert(e) {
            continue;
        }
        let mut holder = SymbolId::NONE;
        match bound.expr_parent[e.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } | ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, .. } => {}
                ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq, left, right } if is_nullish_literal(if left == e { right } else { left }) => {}
                ExprKind::Binary { op: BinOp::In, left, right } if right == e => looked_up.push(constant_string(left).unwrap_or(Atom::NONE)),
                ExprKind::Binary { op: BinOp::And | BinOp::Comma, left, .. } if left == e => {}
                ExprKind::Cond { test, .. } if test == e => {}
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) => {
                    if written_itself.contains(&e) {
                        written_itself.push(around);
                    }
                    pending.push(around);
                }
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, .. } | ExprKind::Cond { .. } => pending.push(around),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => {
                    let (name, may_have_any_name) = match hir[around].kind {
                        ExprKind::Index { index, .. } => (constant_string(index), is_symbol(index)),
                        ExprKind::Dot { name, .. } => (Some(name), false),
                        _ => (None, false),
                    };
                    let call = match bound.expr_parent[around.idx()] {
                        Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(it) | ExprKind::TaggedTemplate(it) if hir[it].callee == around) => Some(call),
                        _ => None,
                    };
                    match (name, call) {
                        (Some(name), _) if is_itself(name) => pending.push(around),
                        (Some(name), Some(call)) if atoms.bytes(name) == b"valueOf" => pending.push(call),
                        (Some(name), Some(_)) if HAND_THE_RECEIVER_ON.contains(&atoms.bytes(name)) => return false,
                        (Some(name), _) if LEAD_TO_THE_PROTOTYPE.contains(&atoms.bytes(name)) && !is_only_compared(around) => return false,
                        (Some(name), _) => {
                            reads.push((name, around));
                            if matches!(hir[around].kind, ExprKind::Index { index, .. } if bound.expr_symbol[index.idx()].some().is_some_and(|holder| is_hoisted(module, holder))) {
                                reads.push((known::undefined, around));
                            }
                        }
                        (None, None) if may_have_any_name => {}
                        (None, None) => match bound.expr_parent[around.idx()] {
                            Parent::Expr(store) => match hir[store].kind {
                                ExprKind::Assign { op: None, target, value } if target == around => stored_under_any_name.push((around, value)),
                                _ => return false,
                            },
                            _ => return false,
                        },
                        (None, _) => return false,
                    }
                }
                ExprKind::Assign { op: None, target, .. } if target == e => {}
                ExprKind::Assign { op: None, target, value } if value == e && matches!(hir[target].kind, ExprKind::Ident(_)) => {
                    holder = bound.expr_symbol[target.idx()];
                    if holder.is_none() {
                        return false;
                    }
                    pending.push(around);
                }
                ExprKind::Call(call) if is_receiver_of_native_function(call, e) => {}
                ExprKind::Call(call) if is_first_argument_of(call, e, b"getPrototypeOf") && is_only_compared(around) => {}
                ExprKind::Call(call) if is_first_argument_of(call, e, b"getOwnPropertyDescriptor") => match hir.ids(hir[call].args).nth(1).and_then(constant_string) {
                    Some(name) if !is_itself(name) => reads.push((name, ExprId::NONE)),
                    _ => return false,
                },
                ExprKind::Call(call) if receives_property(call, e) => {
                    let gives_a_primitive = || {
                        hir[call].args.len() == 3
                            && constant_string(hir.id_at(hir[call].args, 1)).is_some()
                            && matches!(hir[hir.id_at(hir[call].args, 2)].kind, ExprKind::Object(props) if props.iter().map(|prop| &hir[prop]).all(|prop| {
                                matches!(prop.key, PropKey::Name(key) if matches!(atoms.bytes(key), b"value" | b"writable" | b"enumerable" | b"configurable")) && prop.kind == PropKind::Init && prop.value.is_some() && is_surely_primitive(module, atoms, prop.value, MOST_STEPS_TO_A_STORED_VALUE)
                            }))
                    };
                    let is_judged_where_it_is_written = written_itself.contains(&e) && is_start_written_by_name;
                    if hir[call].args.len() < 2 || !is_judged_where_it_is_written && !gives_a_primitive() {
                        return false;
                    }
                    let key = hir.id_at(hir[call].args, 1);
                    match constant_string(key) {
                        Some(name) if !is_itself(name) => reads.push((name, ExprId::NONE)),
                        None if is_symbol(key) => {}
                        _ => return false,
                    }
                    pending.push(around);
                }
                ExprKind::Call(call) if reads_own_property(call, e) => match hir[hir.id_at(hir[call].args, 1)].kind {
                    ExprKind::String(name) if !is_itself(name) => reads.push((name, ExprId::NONE)),
                    _ => return false,
                },
                ExprKind::Call(call) => match receiving_parameter(call, e) {
                    Some(parameter) => holder = parameter,
                    None => return false,
                },
                _ => return false,
            },
            Parent::Stmt(around) => {
                if !matches!(hir[around].kind, StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. }) {
                    return false;
                }
            }
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Ident(_) if !hir[declaration].flags.contains(Flags::EXPORT) => holder = bound.pat_symbol[hir[declaration].pat.idx()],
                PatKind::Object(props) => {
                    for prop in props.iter().map(|prop| &hir[prop]) {
                        match (prop.key, hir[prop.value].kind) {
                            _ if prop.is_rest => return false,
                            (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) if !is_itself(name) => reads.push((name, ExprId::NONE)),
                            _ => return false,
                        }
                    }
                }
                _ => return false,
            },
            Parent::ParamDefault(parameter) if matches!(hir[hir[parameter].pat].kind, PatKind::Ident(_)) => holder = bound.pat_symbol[hir[parameter].pat.idx()],
            _ => return false,
        }
        if holder.is_some() && !holders.contains(&holder) {
            holders.push(holder);
            let symbol = &bound.symbols[holder.idx()];
            let is_plain = !symbol.flags.contains(SymFlags::MERGED)
                && symbol.decls.iter().all(|&decl| match decl {
                    Decl::Var(_) | Decl::Require(_) => true,
                    Decl::Param(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Param(parameter) if !hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY) && !mentions_arguments(bound.param_fn[parameter.idx()])),
                    _ => false,
                })
                && !hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name));
            if !is_plain {
                return false;
            }
            let mentions = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))).map(|it| ExprId::from(it.0 as u32));
            pending.extend(mentions.filter(|&mention| bound.expr_symbol[mention.idx()] == holder && bound.expr_parent[mention.idx()] != Parent::None && !bound.is_in_type_query(mention)));
        }
    }
    true
}

fn string_arguments_for_parameter(module: &Module<'_>, e: ExprId) -> Option<Vec<Atom>> {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_stored_once = |symbol: SymbolId| symbol.is_some() && bound.symbols[symbol.idx()].decls.len() == 1 && is_never_stored_to(module, symbol);
    let taken = bound.expr_symbol[e.idx()];
    if !matches!(hir[e].kind, ExprKind::Ident(_)) || !is_stored_once(taken) {
        return None;
    }
    let Decl::Param(pat) = bound.symbols[taken.idx()].decls[0] else { return None };
    let PatParent::Param(parameter) = bound.pat_parent[pat.idx()] else { return None };
    let function = bound.param_fn[parameter.idx()];
    let index = hir[function].params.iter().position(|it| it == parameter)?;
    let (from, to, holder, is_exported) = match bound.fns[function.idx()].owner {
        FnOwner::Stmt(owner) => (hir[owner].start, hir[owner].loc.end, bound.fn_symbol[function.idx()], hir[function].flags.intersects(Flags::EXPORT | Flags::DEFAULT)),
        FnOwner::Expr(owner) => match bound.expr_parent[owner.idx()] {
            Parent::VarInit(declaration) if matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)) => (hir[owner].pos, hir[owner].end, bound.pat_symbol[hir[declaration].pat.idx()], hir[declaration].flags.contains(Flags::EXPORT)),
            _ => return None,
        },
        _ => return None,
    };
    if is_exported
        || !is_stored_once(holder)
        || !matches!(hir[pat].kind, PatKind::Ident(_))
        || hir[parameter].default.is_some()
        || hir[function].params.iter().take(index + 1).any(|it| hir[it].flags.contains(Flags::REST))
        || bound.arguments_objects.iter().any(|&mention| (from..to).contains(&hir[mention].pos))
        || hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == bound.symbols[holder.idx()].name))
    {
        return None;
    }
    let mut handed = Vec::new();
    for (mention, expr) in hir.exprs.iter().enumerate() {
        let mention = ExprId::from(mention as u32);
        if !matches!(expr.kind, ExprKind::Ident(_)) || bound.expr_symbol[mention.idx()] != holder || bound.expr_parent[mention.idx()] == Parent::None {
            continue;
        }
        let Parent::Expr(around) = bound.expr_parent[mention.idx()] else { return None };
        let ExprKind::Call(call) = hir[around].kind else { return None };
        if hir[call].callee != mention || hir.ids(hir[call].args).take(index + 1).any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return None;
        }
        match hir.ids(hir[call].args).nth(index).map(|argument: ExprId| hir[argument].kind) {
            Some(ExprKind::String(specifier)) => handed.push(specifier),
            None => {}
            Some(_) => return None,
        }
    }
    Some(handed)
}

fn cannot_name_builtin_module(module: &Module<'_>, atoms: &Interner<'_>, mut e: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_node_path = |specifier: Atom| specifier.is_some() && matches!(atoms.bytes(specifier), b"path" | b"node:path");
    let requires_node_path = |e: ExprId| matches!(hir[e].kind, ExprKind::Call(call) if hir[call].args.len() == 1 && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) && matches!(hir[hir.id_at(hir[call].args, 0)].kind, ExprKind::String(specifier) if is_node_path(specifier)));
    let declarations_of = |e: ExprId| {
        let symbol = bound.expr_symbol[e.idx()];
        let is_constant = symbol.is_some() && is_never_stored_to(module, symbol);
        is_constant.then(|| &bound.symbols[symbol.idx()].decls[..])
    };
    let function_of_node_path = |callee: ExprId| match hir[callee].kind {
        ExprKind::Dot { obj, name, .. } if matches!(hir[obj].kind, ExprKind::Ident(_)) => match declarations_of(obj) {
            Some(&[Decl::Var(pat) | Decl::Require(pat)]) => match bound.pat_parent[pat.idx()] {
                bun_sema::bind::PatParent::Var(declaration) if hir[declaration].pat == pat && hir[declaration].init.is_some() && requires_node_path(hir[declaration].init) => Some(name),
                _ => None,
            },
            Some(&[Decl::ImportDefault(import) | Decl::ImportNamespace(import)]) if !hir[import].type_only && is_node_path(hir[import].spec) => Some(name),
            _ => None,
        },
        ExprKind::Ident(_) => match declarations_of(callee) {
            Some(&[Decl::ImportSpec(spec)]) if !hir[spec].type_only && !hir[hir[spec].import].type_only && is_node_path(hir[hir[spec].import].spec) => Some(hir[spec].imported),
            _ => None,
        },
        _ => None,
    };
    let mut must_be_absolute = false;
    loop {
        let is_path_head = |text: Atom| matches!(atoms.bytes(text).first(), Some(b'/')) || !must_be_absolute && matches!(atoms.bytes(text).first(), Some(b'.' | b'@'));
        match hir[e].kind {
            ExprKind::String(text) => return is_path_head(text),
            ExprKind::Template { exprs } if !exprs.is_empty() && atoms.bytes(hir.id_at(hir.template_texts(exprs), 0)).is_empty() => e = hir.id_at(exprs, 0),
            ExprKind::Template { exprs } => return is_path_head(hir.id_at(hir.template_texts(exprs), 0)),
            ExprKind::Binary { op: BinOp::Add, left, .. } => e = left,
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => e = expr,
            ExprKind::Ident(name) => {
                let symbol = bound.expr_symbol[e.idx()];
                return matches!(atoms.bytes(name), b"__dirname" | b"__filename") && (symbol.is_none() || bound.symbols[symbol.idx()].decls.iter().all(|&decl| matches!(decl, Decl::CommonJsVariable)));
            }
            ExprKind::Dot { obj, name, .. } => return matches!(hir[obj].kind, ExprKind::ImportMeta) && matches!(atoms.bytes(name), b"dirname" | b"dir" | b"filename" | b"path" | b"url"),
            ExprKind::Call(call) => match function_of_node_path(hir[call].callee).map(|name| atoms.bytes(name)) {
                Some(b"resolve") => return true,
                Some(b"join") if !hir[call].args.is_empty() => {
                    must_be_absolute = true;
                    e = hir.id_at(hir[call].args, 0);
                }
                _ => return false,
            },
            _ => return false,
        }
    }
}

type GlobalObjectReads = (Vec<(Atom, ExprId)>, Vec<(usize, Atom, ExprId)>, Vec<(usize, Atom)>, Vec<(usize, ExprId, ExprId)>);

fn is_deleted(module: &Module<'_>, member: ExprId) -> bool {
    let Some(mut operand) = member.some() else { return false };
    loop {
        let Parent::Expr(around) = module.bound.expr_parent[operand.idx()] else { return false };
        match module.hir[around].kind {
            ExprKind::Unary { op: UnOp::Delete, .. } => return true,
            ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) => operand = around,
            _ => return false,
        }
    }
}

fn looked_up_through(module: &Module<'_>, atoms: &Interner<'_>, name: Atom, member: ExprId) -> Option<Atom> {
    if is_deleted(module, member) {
        return Some(Atom::NONE);
    }
    let (hir, member) = (&module.hir, member.some()?);
    let Parent::Expr(around) = module.bound.expr_parent[member.idx()] else { return None };
    match hir[around].kind {
        ExprKind::Call(call) if hir[call].callee == member && LOOK_UP_A_MEMBER.contains(&atoms.bytes(name)) => match hir.ids(hir[call].args).next().map(|argument: ExprId| hir[argument].kind) {
            Some(ExprKind::String(asked)) => Some(asked),
            _ => Some(Atom::NONE),
        },
        _ => None,
    }
}

fn why_it_escapes(holder: usize, if_global_object: &'static str) -> &'static str {
    match holder {
        0 => "process",
        1 => "Bun",
        _ => if_global_object,
    }
}

const STORED_ON_THE_GLOBAL_OBJECT: &str = "what may be a function that sees the global object, stored on it";
const STORED_UNDER_ANY_NAME: &str = "what may be an object or a function, stored on the global object under a name that is computed";

#[derive(Default)]
struct StoredOnGlobals {
    may_see_the_global: Vec<(usize, ExprId)>,
    may_stand_under_any_name: Vec<(usize, ExprId)>,
    may_see_the_global_if_called: Vec<(usize, Atom, ExprId)>,
    called: Vec<(usize, Atom)>,
    names_stored_on_the_global_object: Vec<Atom>,
}

const MOST_STEPS_TO_A_STORED_VALUE: u32 = 8;

fn may_be_called_by_native_code(holder: usize, name: &[u8]) -> bool {
    let host = GLOBALS.get(holder).map_or(&b"global"[..], |global| global.0);
    matches!(name, b"then" | b"toJSON") || is_member_of(&[b"functions-of-", host].concat(), name)
}

fn is_imported_from_builtin_module(module: &Module<'_>, atoms: &Interner<'_>, value: ExprId) -> bool {
    let hir = &module.hir;
    let is_builtin_module = |specifier: Atom| specifier.is_some() && Alias::get(atoms.bytes(specifier), bun_ast::Target::Bun, Cfg::default()).is_some();
    module.bound.expr_symbol[value.idx()].some().is_some_and(|symbol| {
        module.bound.symbols[symbol.idx()].decls.iter().all(|&decl| match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => is_builtin_module(hir[import].spec),
            Decl::ImportSpec(spec) => is_builtin_module(hir[hir[spec].import].spec),
            _ => false,
        })
    })
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum FunctionThatSeesItsReceiver {
    None,
    ExportedByBuiltinModule,
    WrittenByTheProgram,
}

fn function_that_may_see_the_global(module: &Module<'_>, atoms: &Interner<'_>, value: ExprId, is_handed_events: bool, steps_left: u32) -> FunctionThatSeesItsReceiver {
    use FunctionThatSeesItsReceiver::{ExportedByBuiltinModule, None as NoFunction, WrittenByTheProgram};
    let (hir, bound) = (&module.hir, &module.bound);
    let at = |value: ExprId| if steps_left == 0 { WrittenByTheProgram } else { function_that_may_see_the_global(module, atoms, value, is_handed_events, steps_left - 1) };
    let if_so = |sees_its_receiver: bool| if sees_its_receiver { WrittenByTheProgram } else { NoFunction };
    match hir[value].kind {
        ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Template { .. } | ExprKind::Unary { .. } => NoFunction,
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Class(_) => NoFunction,
        ExprKind::Fn(function) => if_so(is_handed_events || hir[function].kind != FnKind::Arrow && mentions_its_receiver(module, function)),
        ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } | ExprKind::Cond { yes: left, no: right, .. } => at(left).max(at(right)),
        ExprKind::Binary { op: BinOp::Comma, right: inner, .. } | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } | ExprKind::AsConst(inner) | ExprKind::NonNull(inner) => at(inner),
        ExprKind::Binary { .. } => NoFunction,
        ExprKind::Ident(name) if is_free(module, value) && is_member_of(b"global", atoms.bytes(name)) => NoFunction,
        ExprKind::Ident(_) if is_imported_from_builtin_module(module, atoms, value) => ExportedByBuiltinModule,
        ExprKind::Ident(_) => match bound.expr_symbol[value.idx()].some().filter(|&holder| is_never_stored_to(module, holder)).map(|holder| (holder, &bound.symbols[holder.idx()].decls[..])) {
            Some((_, &[Decl::Fn(function)])) => if_so(is_handed_events || matches!(hir[function].body, FnBody::None) || mentions_its_receiver(module, function)),
            Some((_, &[Decl::Class(_)])) => NoFunction,
            Some((holder, _)) => initializer_of_variable_stored_once(module, holder).map_or(WrittenByTheProgram, at),
            None => WrittenByTheProgram,
        },
        _ => WrittenByTheProgram,
    }
}

impl StoredOnGlobals {
    fn add(&mut self, module: &Module<'_>, atoms: &Interner<'_>, holder: usize, name: Atom, value: ExprId, at: ExprId) {
        let is_handed_events = holder == GLOBAL_OBJECT && atoms.bytes(name).starts_with(b"on");
        if holder == GLOBAL_OBJECT {
            self.names_stored_on_the_global_object.push(name);
        }
        if is_surely_primitive(module, atoms, value, MOST_STEPS_TO_A_STORED_VALUE) {
            return;
        }
        let stored = function_that_may_see_the_global(module, atoms, value, is_handed_events, MOST_STEPS_TO_A_STORED_VALUE);
        let stands_for_what_the_runtime_made = stored == FunctionThatSeesItsReceiver::ExportedByBuiltinModule && holder == GLOBAL_OBJECT;
        match stored {
            FunctionThatSeesItsReceiver::None => {}
            _ if is_handed_events || !stands_for_what_the_runtime_made && may_be_called_by_native_code(holder, atoms.bytes(name)) => self.may_see_the_global.push((holder, at)),
            _ => self.may_see_the_global_if_called.push((holder, name, at)),
        }
    }

    fn add_what_is_not_seen(&mut self, atoms: &Interner<'_>, holder: usize, name: Atom, at: ExprId) {
        if holder == GLOBAL_OBJECT {
            self.names_stored_on_the_global_object.push(name);
        }
        if holder == GLOBAL_OBJECT && atoms.bytes(name).starts_with(b"on") || may_be_called_by_native_code(holder, atoms.bytes(name)) {
            self.may_see_the_global.push((holder, at));
        } else {
            self.may_see_the_global_if_called.push((holder, name, at));
        }
    }

    fn add_under_any_name(&mut self, module: &Module<'_>, atoms: &Interner<'_>, holder: usize, at: ExprId, value: ExprId) {
        if !is_surely_primitive(module, atoms, value, MOST_STEPS_TO_A_STORED_VALUE) {
            self.may_stand_under_any_name.push((holder, at));
        }
    }

    fn add_member(&mut self, module: &Module<'_>, atoms: &Interner<'_>, holder: usize, name: Atom, member: ExprId) {
        let Some(member) = member.some() else { return };
        let written = with_assertions(module, member);
        if is_target_in_a_pattern(module, written) {
            self.add_what_is_not_seen(atoms, holder, name, member);
        }
        match module.bound.expr_parent[written.idx()] {
            Parent::Expr(around) => match module.hir[around].kind {
                ExprKind::Assign { target, value, .. } if target == written => self.add(module, atoms, holder, name, value, member),
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) if module.hir[call].callee == written => self.called.push((holder, name)),
                _ => {}
            },
            Parent::Decorator(..) => self.called.push((holder, name)),
            _ => {}
        }
    }
}

fn mentions_of_destructured_property(module: &Module<'_>, name: Atom) -> Option<Vec<ExprId>> {
    let (hir, bound) = (&module.hir, &module.bound);
    let mut holders: Vec<SymbolId> = Vec::new();
    for declaration in hir.var_decls.iter() {
        let PatKind::Object(props) = hir[declaration.pat].kind else { continue };
        for prop in props.iter().map(|prop| &hir[prop]) {
            let is_the_property = match (prop.key, hir[prop.value].kind) {
                (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => key == name,
                _ => false,
            };
            if !is_the_property {
                continue;
            }
            if !matches!(hir[prop.value].kind, PatKind::Ident(_)) || declaration.flags.contains(Flags::EXPORT) {
                return None;
            }
            holders.push(bound.pat_symbol[prop.value.idx()]);
        }
    }
    let is_constant = |holder: SymbolId| {
        let symbol = &bound.symbols[holder.idx()];
        symbol.decls.len() == 1 && is_never_stored_to(module, holder) && !hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name))
    };
    if holders.is_empty() || !holders.iter().all(|&holder| is_constant(holder)) {
        return None;
    }
    let identifiers = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))).map(|it| ExprId::from(it.0 as u32));
    Some(identifiers.filter(|&mention| holders.contains(&bound.expr_symbol[mention.idx()]) && bound.expr_parent[mention.idx()] != Parent::None && !bound.is_in_type_query(mention)).collect())
}

fn is_operand_of_type_query(module: &Module<'_>, mut e: ExprId) -> bool {
    if module.bound.type_query_operands.is_empty() {
        return false;
    }
    loop {
        if module.bound.is_in_type_query(e) {
            return true;
        }
        match module.bound.expr_parent[e.idx()] {
            Parent::Expr(around) if matches!(module.hir[around].kind, ExprKind::Dot { obj, .. } if obj == e) => e = around,
            _ => return false,
        }
    }
}

fn may_strings_become_code() -> bool {
    bun_core::code_generation_from_strings_in_built_executable() == bun_core::CodeGenerationFromStrings::Allowed
}

fn reads_of_global_object(module: &Module<'_>, atoms: &Interner<'_>, global_objects: &[Atom], globals: &[Option<Atom>; GLOBALS.len()], get_builtin_module: Option<Atom>, e: ExprId) -> Option<GlobalObjectReads> {
    let is = |name: Atom, text: &[u8]| atoms.bytes(name) == text;
    let is_global_object = |name: Atom| global_objects.contains(&name);
    let mut reads = Vec::new();
    let mut looked_up = Vec::new();
    let mut stored_under_any_name = Vec::new();
    if !is_read_only_by_literal_names(module, atoms, e, &is_global_object, &mut reads, &mut looked_up, &mut stored_under_any_name) {
        return None;
    }
    let mut stored: Vec<(usize, ExprId, ExprId)> = stored_under_any_name.drain(..).map(|(at, value)| (GLOBAL_OBJECT, at, value)).collect();
    if reads.iter().any(|it| is(it.0, b"__lookupGetter__") && looked_up_through(module, atoms, it.0, it.1).is_some_and(|asked| asked.is_none() || is_global_object(asked))) {
        return None;
    }
    looked_up.extend(reads.iter().filter_map(|it| looked_up_through(module, atoms, it.0, it.1)));
    let mut touched: Vec<(usize, Atom)> = looked_up.drain(..).map(|name| (GLOBAL_OBJECT, name)).collect();
    let mut found = Vec::new();
    for &(name, member) in &reads {
        if matches!(name, known::require | known::module) || matches!(name, known::eval | known::Function) && may_strings_become_code() || is(name, b"Worker") || is(name, b"ShadowRealm") {
            return None;
        }
        let Some(global) = globals.iter().position(|&global| global == Some(name)) else { continue };
        if global >= PERFORMANCE {
            touched.push((global, Atom::NONE));
            continue;
        }
        let members = if member.is_some() { vec![member] } else { mentions_of_destructured_property(module, name)? };
        let mut of_global = Vec::new();
        if !members.into_iter().all(|member| is_read_only_by_literal_names(module, atoms, member, &|name| name == known::default, &mut of_global, &mut looked_up, &mut stored_under_any_name)) || of_global.iter().any(|it| Some(it.0) == get_builtin_module || is(it.0, b"mainModule") || RETURN_THE_RECEIVER.contains(&atoms.bytes(it.0))) {
            return None;
        }
        looked_up.extend(of_global.iter().filter_map(|it| looked_up_through(module, atoms, it.0, it.1)));
        touched.extend(looked_up.drain(..).map(|name| (global, name)));
        touched.extend(stored_under_any_name.first().map(|_| (global, Atom::NONE)));
        stored.extend(stored_under_any_name.drain(..).map(|(at, value)| (global, at, value)));
        found.extend(of_global.into_iter().map(|it| (global, it.0, it.1)));
    }
    Some((reads, found, touched, stored))
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum EvaluatorUse {
    Calls,
    Value,
}

fn use_of_evaluator(module: &Module<'_>, evaluator: ExprId) -> EvaluatorUse {
    let (hir, bound) = (&module.hir, &module.bound);
    let use_of = |mention: ExprId| match bound.expr_parent[mention.idx()] {
        Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == mention) => EvaluatorUse::Calls,
        _ => EvaluatorUse::Value,
    };
    let Parent::VarInit(declaration) = bound.expr_parent[evaluator.idx()] else { return use_of(evaluator) };
    if !matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)) || hir[declaration].flags.contains(Flags::EXPORT) {
        return EvaluatorUse::Value;
    }
    let holder = bound.pat_symbol[hir[declaration].pat.idx()];
    let symbol = &bound.symbols[holder.idx()];
    if symbol.decls.len() != 1 || symbol.flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED) || !bound.assignments_to(holder).is_empty() || hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name)) {
        return EvaluatorUse::Value;
    }
    let identifiers = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))).map(|it| ExprId::from(it.0 as u32));
    let mentions = identifiers.filter(|&mention| bound.expr_symbol[mention.idx()] == holder && bound.expr_parent[mention.idx()] != Parent::None && !bound.is_in_type_query(mention));
    mentions.map(use_of).max().unwrap_or(EvaluatorUse::Calls)
}

fn mentions_its_receiver(module: &Module<'_>, function: FnId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::This | ExprKind::Super)).any(|(index, _)| {
        let mut owner = function_around(module, bound.expr_parent[index]);
        while owner.is_some() && hir[owner].kind == FnKind::Arrow {
            owner = bound.fns[owner.idx()].enclosing;
        }
        owner == function
    })
}

fn is_value_thrown_away(module: &Module<'_>, mut e: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    loop {
        match bound.expr_parent[e.idx()] {
            Parent::Stmt(statement) => return matches!(hir[statement].kind, StmtKind::Expr(_)),
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Unary { op: UnOp::Void, .. } => return true,
                ExprKind::Binary { op: BinOp::Comma, left, .. } if left == e => return true,
                ExprKind::Binary { op: BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish, .. } => e = around,
                ExprKind::Cond { yes, no, .. } if yes == e || no == e => e = around,
                _ => return false,
            },
            _ => return false,
        }
    }
}

fn keeps_the_receiver_to_itself(module: &Module<'_>, method: ExprId, takes_listener: bool) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let Parent::Expr(around) = bound.expr_parent[method.idx()] else { return false };
    let ExprKind::Call(call) = hir[around].kind else { return false };
    if hir[call].callee != method || !is_value_thrown_away(module, around) {
        return false;
    }
    if !takes_listener {
        return true;
    }
    let Some(mut listener) = hir.ids(hir[call].args).nth(1) else { return false };
    if hir.ids(hir[call].args).take(2).any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_))) {
        return false;
    }
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) = hir[listener].kind {
        listener = expr;
    }
    let function = match hir[listener].kind {
        ExprKind::Fn(function) => function,
        ExprKind::Ident(_) => {
            let Some(symbol) = bound.expr_symbol[listener.idx()].some() else { return false };
            let declared = &bound.symbols[symbol.idx()];
            if !is_never_stored_to(module, symbol) {
                return false;
            }
            match declared.decls[..] {
                [Decl::Fn(function)] => function,
                [Decl::Var(pat)] => match bound.pat_parent[pat.idx()] {
                    PatParent::Var(declaration) if hir[declaration].pat == pat && hir[declaration].init.is_some() => match hir[hir[declaration].init].kind {
                        ExprKind::Fn(function) => function,
                        _ => return false,
                    },
                    _ => return false,
                },
                _ => return false,
            }
        }
        _ => return false,
    };
    hir[function].kind == FnKind::Arrow || !mentions_its_receiver(module, function)
}

fn member_at(module: &Module<'_>, e: ExprId) -> Option<(ExprId, Atom)> {
    match module.hir[e].kind {
        ExprKind::Dot { obj, name, .. } => Some((obj, name)),
        ExprKind::Index { obj, index, .. } => match module.hir[index].kind {
            ExprKind::String(name) => Some((obj, name)),
            _ => None,
        },
        _ => None,
    }
}

fn is_member_of(host: &[u8], name: &[u8]) -> bool {
    let lines = bun_core::strings::split(include_bytes!("members-of-host-objects.txt"), b"\n");
    lines.map(|line| bun_core::strings::split(line.trim_ascii_end(), b" ")).any(|mut words| {
        let is_of_host = words.next().is_some_and(|first| first == host || !cfg!(windows) && first.strip_suffix(b"-not-on-windows") == Some(host));
        is_of_host && words.any(|member| member == name)
    })
}

const MOST_STEPS_TO_NODE_EVENTS: usize = 8;

fn is_event_emitter(module: &Module<'_>, atoms: &Interner<'_>, module_loaded_by: &dyn Fn(&bun_sema::hir::Call) -> Option<Atom>, e: ExprId, steps_left: usize) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let Some(steps_left) = steps_left.checked_sub(1) else { return true };
    let is_node_events = |specifier: Atom| specifier.is_some() && matches!(atoms.bytes(specifier), b"events" | b"node:events");
    let is_itself = |name: Atom| name == known::default || atoms.bytes(name) == b"EventEmitter";
    let is_one = |e: ExprId| e.is_some() && is_event_emitter(module, atoms, module_loaded_by, e, steps_left);
    let e = without_assertions(module, e);
    match hir[e].kind {
        ExprKind::Call(call) => module_loaded_by(&hir[call]).is_some_and(is_node_events),
        ExprKind::Ident(_) => bound.expr_symbol[e.idx()].some().is_some_and(|symbol| {
            bound.symbols[symbol.idx()].decls.iter().any(|&decl| match decl {
                Decl::ImportDefault(import) | Decl::ImportNamespace(import) => !hir[import].type_only && is_node_events(hir[import].spec),
                Decl::ImportSpec(spec) => !hir[spec].type_only && !hir[hir[spec].import].type_only && is_itself(hir[spec].imported) && is_node_events(hir[hir[spec].import].spec),
                Decl::Var(pat) | Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                    PatParent::Var(declaration) => is_one(hir[declaration].init),
                    PatParent::Prop(outer, prop) => {
                        let is_taken_out = match (hir[prop].key, hir[pat].kind) {
                            (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => is_itself(key),
                            _ => false,
                        };
                        is_taken_out && matches!(bound.pat_parent[outer.idx()], PatParent::Var(declaration) if is_one(hir[declaration].init))
                    }
                    _ => false,
                },
                _ => false,
            })
        }),
        _ => member_at(module, e).is_some_and(|(obj, name)| is_itself(name) && is_one(obj)),
    }
}

const READ_THEIR_FIRST_ARGUMENT: [&[u8]; 16] = [
    b"create",
    b"entries",
    b"getOwnPropertyDescriptor",
    b"getOwnPropertyDescriptors",
    b"getOwnPropertyNames",
    b"getOwnPropertySymbols",
    b"getPrototypeOf",
    b"has",
    b"hasOwn",
    b"is",
    b"isExtensible",
    b"isFrozen",
    b"isSealed",
    b"keys",
    b"ownKeys",
    b"values",
];
const READ_THEIR_LATER_ARGUMENTS: [&[u8]; 3] = [b"assign", b"is", b"setPrototypeOf"];
const WRITE_THE_RECEIVER: [&[u8]; 2] = [b"__defineGetter__", b"__defineSetter__"];

fn is_object_only_read(module: &Module<'_>, atoms: &Interner<'_>, start: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_function_of_object = |callee: ExprId, names: &[&[u8]]| member_at(module, callee).is_some_and(|(holder, name)| names.contains(&atoms.bytes(name)) && matches!(hir[holder].kind, ExprKind::Ident(holder_name) if matches!(atoms.bytes(holder_name), b"Object" | b"Reflect") && is_free(module, holder)));
    let mut pending = vec![start];
    let mut holders: Vec<SymbolId> = Vec::new();
    let mut seen: FxHashSet<ExprId> = FxHashSet::default();
    while let Some(e) = pending.pop() {
        if !seen.insert(e) {
            continue;
        }
        let mut holder = SymbolId::NONE;
        match bound.expr_parent[e.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } | ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. } => {}
                ExprKind::Binary { op: BinOp::In, right, .. } if right == e => {}
                ExprKind::Binary { op: BinOp::And | BinOp::Comma, left, .. } if left == e => {}
                ExprKind::Cond { test, .. } if test == e => {}
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, .. } | ExprKind::Cond { .. } => pending.push(around),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => {
                    if is_assignment_target(module, around) || is_deleted(module, around) || member_at(module, around).is_some_and(|member| WRITE_THE_RECEIVER.contains(&atoms.bytes(member.1))) {
                        return false;
                    }
                }
                ExprKind::Assign { op: None, target, .. } if target == e => {}
                ExprKind::Assign { op: None, target, value } if value == e => {
                    match hir[target].kind {
                        ExprKind::Ident(_) if bound.expr_symbol[target.idx()].is_some() => holder = bound.expr_symbol[target.idx()],
                        _ if member_at(module, target).is_some_and(|member| atoms.bytes(member.1) == b"__proto__") => {}
                        _ => return false,
                    }
                    pending.push(around);
                }
                ExprKind::Call(call) => match hir.ids(hir[call].args).position(|argument: ExprId| argument == e) {
                    Some(0) if is_function_of_object(hir[call].callee, &READ_THEIR_FIRST_ARGUMENT) => {}
                    Some(1..) if is_function_of_object(hir[call].callee, &READ_THEIR_LATER_ARGUMENTS) => {}
                    _ => return false,
                },
                _ => return false,
            },
            Parent::Stmt(around) => {
                if !matches!(hir[around].kind, StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::ForIn { .. }) {
                    return false;
                }
            }
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Ident(_) => holder = bound.pat_symbol[hir[declaration].pat.idx()],
                PatKind::Object(_) => {}
                _ => return false,
            },
            _ => return false,
        }
        if holder.is_some() && !holders.contains(&holder) {
            holders.push(holder);
            let symbol = &bound.symbols[holder.idx()];
            if symbol.flags.contains(SymFlags::MERGED) || !symbol.decls.iter().all(|&decl| matches!(decl, Decl::Var(_) | Decl::Require(_))) || !is_seen_only_in_its_file(module, holder) {
                return false;
            }
            pending.extend(mentions_of(module, |mentioned| mentioned == holder));
        }
    }
    true
}

#[derive(Default)]
struct CreatedRequires {
    holders: Vec<SymbolId>,
    called_at_once: Vec<ExprId>,
    is_one_handed_on: bool,
}

impl CreatedRequires {
    fn of(module: &Module<'_>, atoms: &Interner<'_>) -> CreatedRequires {
        let (hir, bound) = (&module.hir, &module.bound);
        let is_node_module = |specifier: Atom| specifier.is_some() && matches!(atoms.bytes(specifier), b"module" | b"node:module");
        let mut found = CreatedRequires::default();
        let names_node_module = |call: &bun_sema::hir::Call| matches!(hir.ids(call.args).next().map(|argument: ExprId| hir[argument].kind), Some(ExprKind::String(specifier)) if is_node_module(specifier));
        if !hir.specifier_uses.iter().any(|used| is_node_module(used.spec)) && !hir.calls.iter().any(names_node_module) {
            return found;
        }
        let requires_node_module = |e: ExprId| matches!(hir[e].kind, ExprKind::Call(call) if !hir[call].args.is_empty() && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) && matches!(hir[hir.id_at(hir[call].args, 0)].kind, ExprKind::String(specifier) if is_node_module(specifier)));
        let is_create_require = |symbol: SymbolId| {
            bound.symbols[symbol.idx()].decls.iter().any(|&decl| match decl {
                Decl::ImportSpec(spec) => atoms.bytes(hir[spec].imported) == b"createRequire" && is_node_module(hir[hir[spec].import].spec),
                Decl::Var(pat) | Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                    PatParent::Prop(outer, prop) => {
                        let is_the_property = match (hir[prop].key, hir[pat].kind) {
                            (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => atoms.bytes(key) == b"createRequire",
                            _ => false,
                        };
                        is_the_property && matches!(bound.pat_parent[outer.idx()], PatParent::Var(declaration) if hir[declaration].init.is_some() && requires_node_module(hir[declaration].init))
                    }
                    _ => false,
                },
                _ => false,
            })
        };
        let is_constant = |holder: SymbolId| {
            let symbol = &bound.symbols[holder.idx()];
            symbol.decls.len() == 1
                && !symbol.flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
                && bound.assignments_to(holder).is_empty()
                && !hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name))
        };
        for (index, _) in hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))) {
            let e = ExprId::from(index as u32);
            if bound.expr_symbol[index].is_none() || bound.expr_parent[index] == Parent::None || bound.is_in_type_query(e) || !is_create_require(bound.expr_symbol[index]) {
                continue;
            }
            let created = match bound.expr_parent[index] {
                Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) if hir[call].callee == e) => around,
                _ => {
                    found.is_one_handed_on = true;
                    continue;
                }
            };
            match bound.expr_parent[created.idx()] {
                Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Dot { obj, name, .. } if obj == created && atoms.bytes(name) == b"resolve") => {}
                Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) if hir[call].callee == created) => found.called_at_once.push(created),
                Parent::VarInit(declaration) if matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)) && !hir[declaration].flags.contains(Flags::EXPORT) && is_constant(bound.pat_symbol[hir[declaration].pat.idx()]) => found.holders.push(bound.pat_symbol[hir[declaration].pat.idx()]),
                _ => found.is_one_handed_on = true,
            }
        }
        found
    }
}

fn is_made_by_the_program(module: &Module<'_>, symbol: SymbolId) -> bool {
    let hir = &module.hir;
    module.bound.symbols[symbol.idx()].decls.iter().any(|&decl| match decl {
        Decl::Fn(f) => !matches!(hir[f].body, FnBody::None),
        Decl::Var(_) | Decl::Class(_) | Decl::Module(_) | Decl::Enum(_) => !hir.is_ambient(hir.node(decl)),
        Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) | Decl::CommonJsVariable => false,
        _ => true,
    })
}

fn is_free(module: &Module<'_>, e: ExprId) -> bool {
    module.bound.expr_symbol[e.idx()].some().is_none_or(|symbol| !is_made_by_the_program(module, symbol))
}

fn is_free_in(module: &Module<'_>, mut scope: bun_sema::bind::ScopeId, name: Atom) -> bool {
    let bound = &module.bound;
    while scope.is_some() {
        if let Some(symbol) = bound.lookup(bound.scopes[scope.idx()].locals, name) {
            return !is_made_by_the_program(module, symbol);
        }
        scope = bound.scopes[scope.idx()].parent;
    }
    true
}

const ANY_OPTION_OF_A_SERVER: [Name; 2] = [Name::ServeOption(Atom::NONE), Name::ServeRouteOption(Atom::NONE)];
const METHODS_OF_A_ROUTE: [&[u8]; 9] = [b"CONNECT", b"DELETE", b"GET", b"HEAD", b"OPTIONS", b"PATCH", b"POST", b"PUT", b"TRACE"];
const MOST_STEPS_TO_A_LITERAL: usize = 8;
const MOST_VARIABLES_FOLLOWED_IN_A_FILE: u32 = 256;

fn without_assertions(module: &Module<'_>, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) = module.hir[e].kind {
        e = expr;
    }
    e
}

fn is_target_in_a_pattern(module: &Module<'_>, e: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let mut at = e;
    loop {
        at = match bound.expr_parent[at.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Assign { op: None, target, .. } if target == at && matches!(hir[at].kind, ExprKind::Array(_) | ExprKind::Object(_)) => return true,
                ExprKind::Assign { op: None, target, .. } if target == at => around,
                ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) => around,
                _ => return false,
            },
            Parent::Prop(prop) => bound.prop_owner[prop.idx()],
            Parent::Stmt(head) => return matches!(bound.stmt_parent[head.idx()], Parent::Stmt(around) if around.is_some() && matches!(hir[around].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == head)),
            _ => return false,
        };
    }
}

fn with_assertions(module: &Module<'_>, mut e: ExprId) -> ExprId {
    while let Parent::Expr(around) = module.bound.expr_parent[e.idx()]
        && matches!(module.hir[around].kind, ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_))
    {
        e = around;
    }
    e
}

fn mentions_of(module: &Module<'_>, is_meant: impl Fn(SymbolId) -> bool) -> Vec<ExprId> {
    let (hir, bound) = (&module.hir, &module.bound);
    let identifiers = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))).map(|it| ExprId::from(it.0 as u32));
    identifiers.filter(|&mention| bound.expr_symbol[mention.idx()].some().is_some_and(&is_meant) && bound.expr_parent[mention.idx()] != Parent::None && !bound.is_in_type_query(mention)).collect()
}

fn is_exported_by_name(module: &Module<'_>, name: Atom) -> bool {
    let hir = &module.hir;
    hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == name))
}

fn strings_written_or_held_by_a_constant(module: &Module<'_>, e: ExprId) -> Option<impl Iterator<Item = Atom>> {
    let hir = &module.hir;
    let (mut written, before_it_is_initialized) = match hir[e].kind {
        ExprKind::Ident(_) => {
            let holder = module.bound.expr_symbol[e.idx()].some()?;
            (initializer_of_variable_stored_once(module, holder)?, is_hoisted(module, holder).then_some(known::undefined))
        }
        _ => (e, None),
    };
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) = hir[written].kind {
        written = expr;
    }
    match hir[written].kind {
        ExprKind::String(text) => Some(std::iter::once(text).chain(before_it_is_initialized)),
        _ => None,
    }
}

fn is_hoisted(module: &Module<'_>, holder: SymbolId) -> bool {
    let is_var = |decl: &Decl| matches!(*decl, Decl::Var(pat) if matches!(module.bound.pat_parent[pat.idx()], PatParent::Var(declaration) if module.hir[declaration].kind == VarKind::Var));
    module.bound.symbols[holder.idx()].decls.iter().any(is_var)
}

fn initializer_of_variable_stored_once(module: &Module<'_>, holder: SymbolId) -> Option<ExprId> {
    let (hir, bound) = (&module.hir, &module.bound);
    let symbol = &bound.symbols[holder.idx()];
    let [Decl::Var(pat)] = symbol.decls[..] else { return None };
    let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return None };
    let is_stored_once = hir[declaration].pat == pat && hir[declaration].init.is_some() && is_never_stored_to(module, holder);
    is_stored_once.then(|| hir[declaration].init)
}

fn is_seen_only_in_its_file(module: &Module<'_>, holder: SymbolId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let symbol = &bound.symbols[holder.idx()];
    let is_exported_where_declared = |decl: &Decl| matches!(*decl, Decl::Var(pat) if matches!(bound.pat_parent[pat.idx()], PatParent::Var(declaration) if hir[declaration].flags.contains(Flags::EXPORT)));
    !symbol.decls.iter().any(is_exported_where_declared) && !is_exported_by_name(module, symbol.name)
}

type ModuleOf<'a, 'm> = &'a dyn Fn(u32) -> Option<&'a Module<'m>>;

fn is_assignment_target(module: &Module<'_>, mut e: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    loop {
        match bound.expr_parent[e.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Assign { target, .. } if target == e => return true,
                ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => return true,
                ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) => e = around,
                _ => return false,
            },
            Parent::Prop(prop) => e = bound.prop_owner[prop.idx()],
            Parent::Stmt(head) => return matches!(bound.stmt_parent[head.idx()], Parent::Stmt(around) if matches!(hir[around].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == head)),
            _ => return false,
        }
    }
}

fn is_never_stored_to(module: &Module<'_>, holder: SymbolId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let symbol = &bound.symbols[holder.idx()];
    let is_const = |decl: &Decl| matches!(*decl, Decl::Var(pat) | Decl::Require(pat) if matches!(bound.pat_parent[pat.idx()], PatParent::Var(declaration) if bound.is_const(hir, declaration)));
    !symbol.flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED) && bound.assignments_to(holder).is_empty() && (symbol.decls.iter().all(is_const) || !mentions_of(module, |symbol| symbol == holder).into_iter().any(|mention| is_assignment_target(module, mention)))
}

fn is_function_stored_once(module: &Module<'_>, holder: SymbolId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let symbol = &bound.symbols[holder.idx()];
    match symbol.decls[..] {
        [Decl::Fn(function)] => !matches!(hir[function].body, FnBody::None) && is_never_stored_to(module, holder),
        _ => initializer_of_variable_stored_once(module, holder).is_some_and(|init| matches!(hir[without_assertions(module, init)].kind, ExprKind::Fn(_))),
    }
}

fn is_in_prelude(module: &Module<'_>) -> bool {
    bun_core::strings::contains(module.path.text, PRELUDE_DIRECTORY)
}

struct OptionsOfServers<'a, 'm, 's> {
    module: &'a Module<'m>,
    atoms: &'a Interner<'s>,
    module_of: ModuleOf<'a, 'm>,
    number_of_files: u32,
    callees: FxHashSet<ExprId>,
    serves_its_default_export: bool,
    variables_left: std::cell::Cell<u32>,
}

impl<'a, 'm> OptionsOfServers<'a, 'm, '_> {
    fn goes_only_to_servers(&self, e: ExprId, steps_left: usize) -> bool {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let e = with_assertions(self.module, e);
        match bound.expr_parent[e.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Call(call) => self.callees.contains(&hir[call].callee) && !hir[call].args.is_empty() && hir.id_at(hir[call].args, 0) == e,
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } => true,
                ExprKind::Cond { test, .. } if test == e => true,
                ExprKind::Binary { op: BinOp::And, left, .. } if left == e => true,
                ExprKind::Cond { .. } | ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => self.goes_only_to_servers(around, steps_left),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => self.only_reads_what_is_not_followed(e, around),
                _ => false,
            },
            Parent::Prop(prop) => {
                let literal = bound.prop_owner[prop.idx()];
                matches!(hir[literal].kind, ExprKind::Object(_)) && matches!(hir[prop].kind, PropKind::Init | PropKind::Shorthand | PropKind::Spread) && self.goes_only_to_servers(literal, steps_left)
            }
            Parent::VarInit(declaration) if steps_left > 0 && matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)) => self.holds_what_goes_only_to_servers(bound.pat_symbol[hir[declaration].pat.idx()], steps_left - 1),
            Parent::Stmt(statement) => self.serves_its_default_export && matches!(hir[statement].kind, StmtKind::ExportDefault(_)),
            _ => false,
        }
    }

    fn only_reads_what_is_not_followed(&self, mention: ExprId, member: ExprId) -> bool {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let Some((_, name)) = member_at(self.module, member) else { return false };
        let written = with_assertions(self.module, member);
        let is_callee = matches!(bound.expr_parent[written.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == written));
        if is_callee || is_assignment_target(self.module, written) || is_deleted(self.module, member) || matches!(self.atoms.bytes(name), b"routes" | b"static" | b"__proto__" | b"constructor") {
            return false;
        }
        let Some(holder) = bound.expr_symbol[without_assertions(self.module, mention).idx()].some() else { return false };
        let Some(init) = initializer_of_variable_stored_once(self.module, holder) else { return false };
        let ExprKind::Object(props) = hir[without_assertions(self.module, init)].kind else { return false };
        props.iter().all(|prop| {
            self.own_name(prop).is_some_and(|own| {
                let value = without_assertions(self.module, hir[prop].value);
                own != name || hir[prop].kind == PropKind::Method || is_surely_primitive(self.module, self.atoms, value, MOST_STEPS_TO_A_STORED_VALUE) || matches!(hir[value].kind, ExprKind::Fn(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_))
            })
        })
    }

    fn holds_what_goes_only_to_servers(&self, holder: SymbolId, steps_left: usize) -> bool {
        let Some(variables_left) = self.variables_left.get().checked_sub(1) else { return false };
        self.variables_left.set(variables_left);
        initializer_of_variable_stored_once(self.module, holder).is_some()
            && is_seen_only_in_its_file(self.module, holder)
            && mentions_of(self.module, |symbol| symbol == holder).into_iter().all(|mention| self.goes_only_to_servers(mention, steps_left))
    }

    fn is_function(&self, e: ExprId) -> bool {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let Some(holder) = bound.expr_symbol[e.idx()].some() else { return false };
        let Some(variables_left) = self.variables_left.get().checked_sub(1) else { return false };
        self.variables_left.set(variables_left);
        match bound.symbols[holder.idx()].decls[..] {
            [Decl::ImportSpec(spec)] => !hir[spec].type_only && !hir[hir[spec].import].type_only && self.is_function_exported_by(hir[hir[spec].import].spec, hir[spec].imported),
            [Decl::ImportDefault(import)] => !hir[import].type_only && self.is_function_exported_by(hir[import].spec, known::default),
            _ => is_function_stored_once(self.module, holder),
        }
    }

    fn is_function_exported_by(&self, specifier: Atom, name: Atom) -> bool {
        let Some(exporting) = self.module.imported_file(specifier).and_then(|file| (self.module_of)(file.0)) else { return false };
        let bound = &exporting.bound;
        let Some(exported) = bound.file_symbol.some().and_then(|file| bound.lookup(bound.symbols[file.idx()].exports, name)) else { return false };
        let locals = (0..bound.symbols.len()).map(|symbol| SymbolId::from(symbol as u32)).filter(|&symbol| bound.symbols[symbol.idx()].export_symbol == exported);
        !exporting.is_commonjs() && is_function_stored_once(exporting, exported) && locals.into_iter().all(|local| is_function_stored_once(exporting, local))
    }

    fn default_export_at(&self, e: ExprId) -> Option<(&'a Module<'m>, ExprId)> {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let ExprKind::Dot { obj, name: known::default, .. } = hir[without_assertions(self.module, e)].kind else { return None };
        let [Decl::ImportNamespace(import)] = bound.symbols[bound.expr_symbol[obj.idx()].some()?.idx()].decls[..] else { return None };
        let file = self.module.imported_file(hir[import].spec).filter(|_| is_in_prelude(self.module))?;
        let exporting = (self.module_of)(file.0).filter(|exporting| !exporting.is_commonjs())?;
        let is_imported_elsewhere = (0..self.number_of_files).filter_map(self.module_of).any(|other| !is_in_prelude(other) && other.edges.contains(&file));
        let mut exported = exporting.hir.ids(exporting.hir.body).filter_map(|statement| match exporting.hir[statement].kind {
            StmtKind::ExportDefault(exported) => Some(exported),
            _ => None,
        });
        match (exported.next(), exported.next()) {
            (Some(exported), None) if !is_imported_elsewhere => Some((exporting, exported)),
            _ => None,
        }
    }

    fn names_stored_on_default_export_that_is_a_function(&self, e: ExprId) -> Option<Vec<Atom>> {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let ExprKind::Dot { obj, name: known::default, .. } = hir[without_assertions(self.module, e)].kind else { return None };
        let [Decl::ImportNamespace(import)] = bound.symbols[bound.expr_symbol[obj.idx()].some()?.idx()].decls[..] else { return None };
        let file = self.module.imported_file(hir[import].spec).filter(|_| is_in_prelude(self.module))?;
        let exporting = (self.module_of)(file.0).filter(|exporting| !exporting.is_commonjs())?;
        if (0..self.number_of_files).filter_map(self.module_of).any(|other| !is_in_prelude(other) && other.edges.contains(&file)) {
            return None;
        }
        let (hir, bound) = (&exporting.hir, &exporting.bound);
        let mut exported = hir.ids(hir.body).filter_map(|statement: StmtId| match hir[statement].kind {
            StmtKind::Fn(function) if hir[function].flags.contains(Flags::DEFAULT) => Some(bound.fn_symbol[function.idx()]),
            StmtKind::ExportDefault(exported) => match hir[without_assertions(exporting, exported)].kind {
                ExprKind::Fn(function) if hir[function].name.is_none() => Some(SymbolId::NONE),
                ExprKind::Ident(_) => bound.expr_symbol[without_assertions(exporting, exported).idx()].some(),
                _ => None,
            },
            _ => None,
        });
        let (Some(holder), None) = (exported.next(), exported.next()) else { return None };
        let Some(holder) = holder.some() else { return Some(Vec::new()) };
        if !is_function_stored_once(exporting, holder) || bound.symbols[holder.idx()].flags.intersects(SymFlags::MERGED) {
            return None;
        }
        let mut names = Vec::new();
        for mention in mentions_of(exporting, |symbol| symbol == holder) {
            let used = with_assertions(exporting, mention);
            match bound.expr_parent[used.idx()] {
                Parent::Stmt(around) if matches!(hir[around].kind, StmtKind::ExportDefault(_)) => {}
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Call(call) if hir[call].callee == used => {}
                    ExprKind::Unary { op: UnOp::Typeof, .. } => {}
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } if obj == used && !matches!(self.atoms.bytes(name), b"prototype" | b"constructor" | b"__proto__") => match bound.access_kind(hir, around) {
                        bun_sema::bind::AccessKind::Read if is_called(exporting, with_assertions(exporting, around)).is_none() && !is_deleted(exporting, around) && bound.get_assignment_target(hir, with_assertions(exporting, around)).is_none() => {}
                        bun_sema::bind::AccessKind::Read => return None,
                        _ => names.push(name),
                    },
                    _ => return None,
                },
                _ => return None,
            }
        }
        Some(names)
    }

    fn literals_at(&self, e: ExprId, steps_left: usize, may_be_function: bool, literals: &mut Vec<Span<PropId>>) -> bool {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let e = without_assertions(self.module, e);
        match hir[e].kind {
            ExprKind::Object(props) => {
                literals.push(props);
                true
            }
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Template { .. } | ExprKind::Unary { .. } => true,
            ExprKind::Fn(_) => may_be_function,
            ExprKind::Cond { yes, no, .. } => self.literals_at(yes, steps_left, may_be_function, literals) && self.literals_at(no, steps_left, may_be_function, literals),
            ExprKind::Binary { op: BinOp::And, right, .. } => self.literals_at(right, steps_left, may_be_function, literals),
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, right } => self.literals_at(left, steps_left, may_be_function, literals) && self.literals_at(right, steps_left, may_be_function, literals),
            ExprKind::Ident(name) if self.atoms.bytes(name) == b"undefined" && is_free(self.module, e) => true,
            ExprKind::Ident(_) if may_be_function && self.is_function(e) => true,
            ExprKind::Ident(_) if steps_left > 0 => {
                let Some(holder) = bound.expr_symbol[e.idx()].some() else { return false };
                let Some(init) = initializer_of_variable_stored_once(self.module, holder) else { return false };
                self.holds_what_goes_only_to_servers(holder, MOST_STEPS_TO_A_LITERAL) && self.literals_at(init, steps_left - 1, may_be_function, literals)
            }
            _ => false,
        }
    }

    fn properties_at(&self, e: ExprId, steps_left: usize, may_be_function: bool) -> Option<Vec<PropId>> {
        let mut literals = Vec::new();
        self.literals_at(e, steps_left, may_be_function, &mut literals).then(|| literals.into_iter().flat_map(|props| props.iter()).collect())
    }

    fn own_name(&self, prop: PropId) -> Option<Atom> {
        match (self.module.hir[prop].kind, self.module.hir[prop].key) {
            (PropKind::Init | PropKind::Shorthand | PropKind::Method, PropKey::Name(name)) if self.atoms.bytes(name) != b"__proto__" => Some(name),
            _ => None,
        }
    }

    fn add_options(&self, options: ExprId, steps_left: usize, found: &mut Vec<Name>) {
        let hir = &self.module.hir;
        if let Some(names) = self.names_stored_on_default_export_that_is_a_function(options) {
            let holds_routes = names.iter().any(|&name| matches!(self.atoms.bytes(name), b"routes" | b"static"));
            found.extend(names.into_iter().map(Name::ServeOption));
            return found.extend(holds_routes.then_some(Name::ServeRouteOption(Atom::NONE)));
        }
        if let Some((module, exported)) = self.default_export_at(options) {
            let of_entry_point = OptionsOfServers { module, atoms: self.atoms, module_of: self.module_of, number_of_files: self.number_of_files, callees: FxHashSet::default(), serves_its_default_export: true, variables_left: self.variables_left.clone() };
            return of_entry_point.add_options(exported, steps_left, found);
        }
        let Some(props) = self.properties_at(options, steps_left, false) else { return found.extend(ANY_OPTION_OF_A_SERVER) };
        for prop in props {
            match self.own_name(prop) {
                _ if hir[prop].kind == PropKind::Spread && steps_left > 0 => self.add_options(hir[prop].value, steps_left - 1, found),
                Some(name) => {
                    found.push(Name::ServeOption(name));
                    if matches!(self.atoms.bytes(name), b"routes" | b"static") {
                        self.add_routes(hir[prop].value, steps_left, found);
                    }
                }
                None => found.extend(ANY_OPTION_OF_A_SERVER),
            }
        }
    }

    fn add_routes(&self, routes: ExprId, steps_left: usize, found: &mut Vec<Name>) {
        let hir = &self.module.hir;
        if matches!(hir[without_assertions(self.module, routes)].kind, ExprKind::Array(_)) {
            return;
        }
        let Some(props) = self.properties_at(routes, steps_left, false) else { return found.push(Name::ServeRouteOption(Atom::NONE)) };
        for prop in props {
            let sets_the_prototype = matches!(hir[prop].key, PropKey::Name(name) if self.atoms.bytes(name) == b"__proto__");
            match hir[prop].kind {
                PropKind::Method => {}
                PropKind::Spread if steps_left > 0 => self.add_routes(hir[prop].value, steps_left - 1, found),
                PropKind::Init | PropKind::Shorthand if !sets_the_prototype => self.add_route(hir[prop].value, steps_left, true, found),
                _ => found.push(Name::ServeRouteOption(Atom::NONE)),
            }
        }
    }

    fn add_route(&self, route: ExprId, steps_left: usize, may_hold_methods: bool, found: &mut Vec<Name>) {
        let hir = &self.module.hir;
        let Some(props) = self.properties_at(route, steps_left, true) else { return found.push(Name::ServeRouteOption(Atom::NONE)) };
        for prop in props {
            match self.own_name(prop) {
                _ if hir[prop].kind == PropKind::Spread && steps_left > 0 => self.add_route(hir[prop].value, steps_left - 1, may_hold_methods, found),
                Some(name) => {
                    found.push(Name::ServeRouteOption(name));
                    if may_hold_methods && hir[prop].kind != PropKind::Method && METHODS_OF_A_ROUTE.contains(&self.atoms.bytes(name)) {
                        self.add_route(hir[prop].value, steps_left, false, found);
                    }
                }
                None => found.push(Name::ServeRouteOption(Atom::NONE)),
            }
        }
    }
}

fn add_options_of_servers<'a, 'm>(named_at: &mut Vec<(u32, ExprId, Name)>, atoms: &'a Interner<'_>, number_of_files: u32, module_of: ModuleOf<'a, 'm>) {
    let Some(serve) = atoms.lookup(b"serve") else { return };
    let mut places: Vec<(u32, ExprId)> = named_at.iter().filter(|named| named.2 == Name::member(BUN, serve)).map(|named| (named.0, named.1)).collect();
    places.sort_unstable();
    places.dedup();
    for of_file in places.chunk_by(|one, next| one.0 == next.0) {
        let file = of_file[0].0;
        match module_of(file) {
            Some(module) => {
                let options = OptionsOfServers { module, atoms, module_of, number_of_files, callees: FxHashSet::default(), serves_its_default_export: false, variables_left: std::cell::Cell::new(MOST_VARIABLES_FOLLOWED_IN_A_FILE) };
                named_at.extend(options_of_servers(options, serve, of_file.iter().map(|it| it.1)).into_iter().map(|(place, name)| (file, place, name)));
            }
            None => named_at.extend(ANY_OPTION_OF_A_SERVER.map(|name| (file, ExprId::NONE, name))),
        }
    }
}

fn options_of_servers(mut options: OptionsOfServers<'_, '_, '_>, serve: Atom, places: impl Iterator<Item = ExprId>) -> Vec<(ExprId, Name)> {
    let (module, atoms) = (options.module, options.atoms);
    let (hir, bound) = (&module.hir, &module.bound);
    let is_bun = |specifier: Atom| specifier.is_some() && GLOBALS[BUN].1.contains(&atoms.bytes(specifier));
    let mut mentions: Vec<ExprId> = Vec::new();
    let mut unseen: Vec<ExprId> = Vec::new();
    for place in places {
        let Some(place) = place.some() else {
            let is_imported = |spec: bun_sema::hir::ImportSpecId| !hir[spec].type_only && hir[spec].imported == serve && !hir[hir[spec].import].type_only && is_bun(hir[hir[spec].import].spec);
            let is_handed_on = hir.imports.iter().flat_map(|import| import.named.iter()).any(|spec| is_imported(spec) && is_exported_by_name(module, hir[spec].local));
            unseen.extend(is_handed_on.then_some(ExprId::NONE));
            mentions.extend(mentions_of(module, |symbol| bound.symbols[symbol.idx()].decls.iter().any(|&decl| matches!(decl, Decl::ImportSpec(spec) if is_imported(spec)))));
            continue;
        };
        let is_the_member = match hir[place].kind {
            ExprKind::Dot { name, .. } => name == serve,
            ExprKind::Index { index, .. } => matches!(hir[index].kind, ExprKind::String(name) if name == serve),
            _ => false,
        };
        if is_the_member {
            mentions.push(place);
            continue;
        }
        let holder = match bound.expr_parent[with_assertions(module, place).idx()] {
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Object(props) if !hir[declaration].flags.contains(Flags::EXPORT) => {
                    let mut taken = props.iter().map(|prop| &hir[prop]).filter(|prop| match (prop.key, hir[prop.value].kind) {
                        (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => key == serve,
                        _ => true,
                    });
                    match (taken.next(), taken.next()) {
                        (Some(prop), None) if !prop.is_rest && prop.default.is_none() && matches!(hir[prop.value].kind, PatKind::Ident(_)) => bound.pat_symbol[prop.value.idx()].some(),
                        _ => None,
                    }
                }
                _ => None,
            },
            _ => None,
        };
        let is_stored_once = |holder: SymbolId| {
            let symbol = &bound.symbols[holder.idx()];
            symbol.decls.len() == 1 && !symbol.flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED) && bound.assignments_to(holder).is_empty() && !is_exported_by_name(module, symbol.name)
        };
        match holder.filter(|&holder| is_stored_once(holder)) {
            Some(holder) => mentions.extend(mentions_of(module, |symbol| symbol == holder)),
            None => unseen.push(place),
        }
    }
    mentions.sort_unstable();
    mentions.dedup();
    let mut calls: Vec<(ExprId, bun_sema::hir::CallId)> = Vec::new();
    for mention in mentions {
        let callee = with_assertions(module, mention);
        match bound.expr_parent[callee.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Call(call) if hir[call].callee == callee => {
                    options.callees.insert(callee);
                    calls.push((around, call));
                }
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } | ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. } => {}
                _ => unseen.push(mention),
            },
            _ => unseen.push(mention),
        }
    }
    let mut found: Vec<(ExprId, Name)> = unseen.into_iter().flat_map(|place| ANY_OPTION_OF_A_SERVER.map(|name| (place, name))).collect();
    let mut of_call: Vec<Name> = Vec::new();
    let mut is_known: FxHashSet<Name> = FxHashSet::default();
    for (place, call) in calls {
        if let Some(argument) = hir.ids(hir[call].args).next() {
            options.add_options(argument, MOST_STEPS_TO_A_LITERAL, &mut of_call);
        }
        is_known.clear();
        found.extend(of_call.drain(..).filter(|&name| is_known.insert(name)).map(|name| (place, name)));
    }
    found
}

fn native_module(atoms: &Interner<'_>, specifier: Atom) -> Option<Name> {
    let alias = Alias::get(atoms.bytes(Some(specifier).filter(|specifier| specifier.is_some())?), bun_ast::Target::Bun, Cfg::default())?;
    let manifest = Archive::embedded().manifest();
    let has_source = |name: &[u8]| manifest.module_for_loader(name).is_some();
    let is_internal = alias.path.as_bytes().strip_prefix(b"internal/").is_some_and(|rest| has_source(&[b"internal:", rest].concat()));
    (!is_internal && !has_source(alias.path.as_bytes())).then_some(Name::NativeModule(specifier))
}

const MAKE_PRIMITIVES: [&[u8]; 6] = [b"String", b"Number", b"Boolean", b"BigInt", b"parseInt", b"parseFloat"];
const PRIMITIVE_GLOBALS: [&[u8]; 3] = [b"undefined", b"NaN", b"Infinity"];
const JSON: [&[u8]; 1] = [b"JSON"];

fn is_surely_primitive(module: &Module<'_>, atoms: &Interner<'_>, e: ExprId, depth: u32) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_so = |e: ExprId| depth > 0 && is_surely_primitive(module, atoms, e, depth - 1);
    let is_global = |e: ExprId, names: &[&[u8]]| matches!(hir[e].kind, ExprKind::Ident(name) if names.contains(&atoms.bytes(name))) && is_free(module, e);
    match hir[e].kind {
        ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Template { .. } | ExprKind::Unary { .. } => true,
        ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } | ExprKind::Cond { yes: left, no: right, .. } => is_so(left) && is_so(right),
        ExprKind::Binary { op: BinOp::Comma, right: inner, .. } | ExprKind::Assign { op: None, value: inner, .. } => is_so(inner),
        ExprKind::Binary { .. } => true,
        ExprKind::Assign { op: Some(op), .. } => !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
        ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => is_so(expr),
        ExprKind::Call(call) => match hir[hir[call].callee].kind {
            ExprKind::Ident(_) => is_global(hir[call].callee, &MAKE_PRIMITIVES),
            ExprKind::Dot { obj, name, .. } => atoms.bytes(name) == b"stringify" && is_global(obj, &JSON),
            _ => false,
        },
        ExprKind::Ident(_) if is_global(e, &PRIMITIVE_GLOBALS) => true,
        ExprKind::Ident(_) => match bound.expr_symbol[e.idx()].some().map(|symbol| (symbol, &bound.symbols[symbol.idx()])) {
            Some((symbol, declared)) if is_never_stored_to(module, symbol) => match declared.decls[..] {
                [Decl::Var(pat)] => matches!(bound.pat_parent[pat.idx()], PatParent::Var(declaration) if hir[declaration].pat == pat && hir[declaration].init.is_some() && is_so(hir[declaration].init)),
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}

fn is_called(module: &Module<'_>, e: ExprId) -> Option<bun_sema::hir::CallId> {
    match module.bound.expr_parent[e.idx()] {
        Parent::Expr(around) => match module.hir[around].kind {
            ExprKind::Call(call) if module.hir[call].callee == e => Some(call),
            _ => None,
        },
        _ => None,
    }
}

fn channel_events_listened_for(module: &Module<'_>, atoms: &Interner<'_>, listens: Option<ExprId>) -> Vec<Name> {
    let first_argument = listens.and_then(|listens| is_called(module, listens)).and_then(|call| module.hir.ids(module.hir[call].args).next());
    let event = first_argument.and_then(|first: ExprId| if let ExprKind::String(event) = module.hir[first].kind { Some(event) } else { None });
    let events = (0..EVENTS_OF_THE_CHANNEL.len()).filter(|&index| event.is_none_or(|event| atoms.bytes(event) == EVENTS_OF_THE_CHANNEL[index]));
    events.map(|index| Name::ListensFor(index as u8)).collect()
}

fn is_operand_of_typeof(module: &Module<'_>, e: ExprId) -> bool {
    matches!(module.bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(module.hir[around].kind, ExprKind::Unary { op: UnOp::Typeof, .. }))
}

fn prints_only_primitives(module: &Module<'_>, atoms: &Interner<'_>, method: ExprId) -> bool {
    is_called(module, method).is_some_and(|call| module.hir.ids(module.hir[call].args).all(|argument: ExprId| is_surely_primitive(module, atoms, argument, 8)))
}

fn symbol_made_through(module: &Module<'_>, atoms: &Interner<'_>, mention: ExprId) -> Option<Name> {
    let hir = &module.hir;
    let Parent::Expr(around) = module.bound.expr_parent[mention.idx()] else { return Some(Name::Symbol(Atom::NONE)) };
    match hir[around].kind {
        ExprKind::Dot { obj, name, .. } if obj == mention && atoms.bytes(name) != b"for" => None,
        ExprKind::Dot { obj, .. } if obj == mention => match is_called(module, around).and_then(|call| hir.ids(hir[call].args).next()).map(|key: ExprId| hir[key].kind) {
            Some(ExprKind::String(key)) => Some(Name::Symbol(key)),
            _ => Some(Name::Symbol(Atom::NONE)),
        },
        ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == mention => None,
        ExprKind::Unary { op: UnOp::Typeof, .. } => None,
        ExprKind::Binary { op: BinOp::Instanceof, right, .. } if right == mention => None,
        _ => Some(Name::Symbol(Atom::NONE)),
    }
}

fn names_global(module: &Module<'_>, atoms: &Interner<'_>, e: ExprId, name: Atom) -> bool {
    module.bound.expr_parent[e.idx()] != Parent::None && is_free(module, e) && !(module.builtin.is_some() && atoms.bytes(name).starts_with(b"$"))
}

fn function_around(module: &Module<'_>, mut parent: Parent) -> FnId {
    let (hir, bound) = (&module.hir, &module.bound);
    let around_member = |member: bun_sema::hir::MemberId| match bound.member_owner[member.idx()] {
        MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
        _ => Parent::None,
    };
    let around_pattern = |mut pat: bun_sema::hir::PatId| loop {
        match bound.pat_parent[pat.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
            PatParent::Var(declaration) => return Parent::VarInit(declaration),
            PatParent::Param(parameter) => return Parent::ParamDefault(parameter),
            PatParent::None => return Parent::None,
        }
    };
    loop {
        parent = match parent {
            Parent::Expr(around) if around.is_some() => bound.expr_parent[around.idx()],
            Parent::Stmt(around) if around.is_some() => bound.stmt_parent[around.idx()],
            Parent::FnBody(function) => return function,
            Parent::ParamDefault(parameter) => return bound.param_fn[parameter.idx()],
            Parent::VarInit(declaration) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
            Parent::Prop(prop) | Parent::PropKey(_, prop) | Parent::MethodKey(prop) => Parent::Expr(bound.prop_owner[prop.idx()]),
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            Parent::MemberInit(member) | Parent::MemberKey(member) => around_member(member),
            Parent::PatPropDefault(prop) | Parent::PatKey(prop) => around_pattern(hir[prop].value),
            Parent::PatElemDefault(element) => around_pattern(hir[element].pat),
            Parent::ClassExtends(class) | Parent::Decorator(class, _) => bound.class_owner[class.idx()].to_parent(),
            Parent::EnumInit(member) => Parent::Stmt(hir[bound.enum_member_owner[member.idx()]].stmt),
            Parent::Module(namespace) => Parent::Stmt(hir[namespace].stmt),
            Parent::None | Parent::File | Parent::Expr(_) | Parent::Stmt(_) => return FnId::NONE,
        };
    }
}

struct ExportsOfEntryPoint<'a, 'm> {
    importer: &'a Module<'m>,
    atoms: &'a Interner<'m>,
    namespace: SymbolId,
    lacks: &'a dyn Fn(Atom) -> bool,
}

impl ExportsOfEntryPoint<'_, '_> {
    fn is_exported_object(&self, e: ExprId, holder: SymbolId) -> bool {
        let (hir, bound) = (&self.importer.hir, &self.importer.bound);
        match hir[e].kind {
            ExprKind::Ident(_) => holder.is_some() && bound.expr_symbol[e.idx()] == holder,
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => name == known::default && matches!(hir[obj].kind, ExprKind::Ident(_)) && bound.expr_symbol[obj.idx()] == self.namespace,
            _ => false,
        }
    }

    fn is_absent_member(&self, e: ExprId, holder: SymbolId) -> bool {
        let (hir, bound) = (&self.importer.hir, &self.importer.bound);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[e].kind else { return false };
        let is_namespace = matches!(hir[obj].kind, ExprKind::Ident(_)) && bound.expr_symbol[obj.idx()] == self.namespace;
        name != known::default && (self.lacks)(name) && (is_namespace || self.is_exported_object(obj, holder))
    }

    fn is_truthy(&self, e: ExprId, holder: SymbolId) -> Option<bool> {
        let (hir, bound) = (&self.importer.hir, &self.importer.bound);
        if self.is_exported_object(e, holder) || self.is_absent_member(e, holder) {
            return Some(self.is_exported_object(e, holder));
        }
        match hir[e].kind {
            ExprKind::Binary { op: op @ (BinOp::And | BinOp::Or), left, right } => match (self.is_truthy(left, holder), self.is_truthy(right, holder)) {
                (Some(decided), _) | (_, Some(decided)) if decided == (op == BinOp::Or) => Some(decided),
                (Some(_), Some(right)) => Some(right),
                _ => None,
            },
            ExprKind::Binary { op: op @ (BinOp::EqEqEq | BinOp::EqEq | BinOp::NotEqEq | BinOp::NotEq), left, right } => {
                let is_equal = match (hir[left].kind, hir[right].kind) {
                    (ExprKind::Unary { op: UnOp::Typeof, operand }, ExprKind::String(kind)) if self.is_absent_member(operand, holder) => self.atoms.bytes(kind) == b"undefined",
                    (_, ExprKind::Ident(name)) if self.is_absent_member(left, holder) && self.atoms.bytes(name) == b"undefined" && bound.expr_symbol[right.idx()].is_none() => true,
                    _ => return None,
                };
                Some(is_equal == matches!(op, BinOp::EqEqEq | BinOp::EqEq))
            }
            ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) => {
                let called = bound.expr_symbol[hir[call].callee.idx()].some().filter(|&called| is_never_stored_to(self.importer, called))?;
                let [Decl::Fn(function)] = bound.symbols[called.idx()].decls[..] else { return None };
                let (mut arguments, mut parameters) = (hir.ids(hir[call].args), hir[function].params.iter());
                let (Some(argument), None, Some(parameter), None) = (arguments.next(), arguments.next(), parameters.next(), parameters.next()) else { return None };
                let parameter = &hir[parameter];
                if !self.is_exported_object(argument, holder) || !matches!(hir[parameter.pat].kind, PatKind::Ident(_)) || parameter.flags.contains(Flags::REST) || hir[function].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
                    return None;
                }
                let FnBody::Block(statements) = hir[function].body else { return None };
                let mut statements = hir.ids(statements);
                let (Some(only), None) = (statements.next(), statements.next()) else { return None };
                let only: StmtId = only;
                let StmtKind::Return(returned) = hir[only].kind else { return None };
                let received = Some(bound.pat_symbol[parameter.pat.idx()]).filter(|&received| is_never_stored_to(self.importer, received))?;
                self.is_truthy(returned.some()?, received)
            }
            _ => None,
        }
    }
}

fn arms_that_commonjs_entry_points_never_take(program: &Program) -> Vec<(FileId, u32, u32)> {
    let (atoms, files) = (&program.files.atoms, &program.files);
    let mut checker = program.checker();
    let mut never_taken = Vec::new();
    for (number, importer) in files.modules.iter().enumerate().filter(|it| is_in_prelude(it.1)) {
        let (file, hir) = (FileId(number as u32), &importer.hir);
        for (index, symbol) in importer.bound.symbols.iter().enumerate() {
            let [Decl::ImportNamespace(import)] = symbol.decls[..] else { continue };
            let Some(exported) = importer.imported_file(hir[import].spec).and_then(|entry_point| checker.exports_of_commonjs_entry_point(entry_point)) else { continue };
            if exported.importers.iter().any(|&other| other != file) || exported.names.contains(&known::default) {
                continue;
            }
            let lacks = |name: Atom| !exported.names.contains(&name) && !checker.is_object_prototype_name(name);
            let exports = ExportsOfEntryPoint { importer, atoms, namespace: SymbolId::from(index as u32), lacks: &lacks };
            for statement in hir.ids(hir.body) {
                let mut at: StmtId = statement;
                while let Some(StmtKind::If { test, yes, no }) = at.some().map(|at| hir[at].kind) {
                    if exports.is_truthy(test, SymbolId::NONE) != Some(false) {
                        break;
                    }
                    never_taken.push((file, hir[yes].start, hir[yes].loc.end));
                    at = no;
                }
            }
        }
    }
    never_taken
}

fn is_in_compiled_program(program: &Program, never_taken: &[(FileId, u32, u32)], file: FileId, place: ExprId) -> bool {
    let module = program.files.module(file);
    let Some(compiled) = module.compiled_functions.get() else { return true };
    if place.is_none() {
        return compiled.is_evaluated;
    }
    is_child_in_compiled_program(program, never_taken, file, module.bound.expr_parent[place.idx()], module.hir[place].pos)
}

fn is_child_in_compiled_program(program: &Program, never_taken: &[(FileId, u32, u32)], file: FileId, parent: Parent, pos: u32) -> bool {
    let module = program.files.module(file);
    let Some(compiled) = module.compiled_functions.get() else { return true };
    if program.files.enclosing_dead_range_start(file, pos).is_some() || never_taken.iter().any(|arm| arm.0 == file && (arm.1..arm.2).contains(&pos)) {
        return false;
    }
    let mut function = function_around(module, parent);
    while function.is_some() && !compiled.is_defined(function) {
        function = module.bound.fns[function.idx()].enclosing;
    }
    if function.is_some() { compiled.is_reached(function) } else { compiled.is_evaluated }
}

#[derive(Copy, Clone)]
struct Reflection {
    reflect: Atom,
    object: Atom,
    get: Atom,
    set: Atom,
    get_own_property_descriptor: Atom,
    get_own_property_descriptors: Atom,
    lookup_getter: Atom,
    lookup_setter: Atom,
    json: Atom,
    stringify: Atom,
    global_objects: [Atom; GLOBAL_OBJECTS.len()],
}

impl Reflection {
    fn new(atoms: &Interner<'_>) -> Reflection {
        let known = |name: &[u8]| atoms.lookup(name).unwrap_or(Atom::NONE);
        Reflection { reflect: known(b"Reflect"), object: known(b"Object"), get: known(b"get"), set: known(b"set"), get_own_property_descriptor: known(b"getOwnPropertyDescriptor"), get_own_property_descriptors: known(b"getOwnPropertyDescriptors"), lookup_getter: known(b"__lookupGetter__"), lookup_setter: known(b"__lookupSetter__"), json: known(b"JSON"), stringify: known(b"stringify"), global_objects: GLOBAL_OBJECTS.map(known) }
    }

    fn hands_out_descriptors(self, name: Atom) -> bool {
        name == self.get_own_property_descriptor || name == self.get_own_property_descriptors
    }

    fn is_name_of_function(self, name: Atom) -> bool {
        [self.get, self.get_own_property_descriptor, self.get_own_property_descriptors, self.lookup_getter, self.lookup_setter, self.reflect, self.object, self.json, self.stringify].contains(&name)
    }
}

const MEMBERS_OF_REGEXP_THAT_MAKE_NONE: [&[u8]; 4] = [b"prototype", b"escape", b"name", b"length"];

enum PatternOfRegexp {
    WithoutPropertyEscape,
    WithPropertyEscape,
    NotSeen,
}

fn has_property_escape(pattern: &[u8]) -> bool {
    bun_core::strings::contains(pattern, b"\\p") || bun_core::strings::contains(pattern, b"\\P")
}

struct Properties<'a, 'p, 's> {
    module: &'a Module<'s>,
    file: FileId,
    checker: &'a std::cell::RefCell<bun_sema::check::Checker<'p, 's>>,
    folded_to_new_texts: &'a std::cell::RefCell<Vec<Vec<u8>>>,
    reflection: Reflection,
}

impl Properties<'_, '_, '_> {
    fn is_global(&self, e: ExprId, name: Atom) -> bool {
        matches!(self.module.hir[e].kind, ExprKind::Ident(written) if written == name) && is_free(self.module, e)
    }

    fn constant_key(&self, e: ExprId) -> Option<Atom> {
        let folded = self.constant_text(e)?;
        if folded.is_own() {
            self.folded_to_new_texts.borrow_mut().push(self.checker.borrow().atoms().bytes(folded).to_vec());
            return None;
        }
        Some(folded)
    }

    fn pattern_of_regexp_made_at(&self, mention: ExprId) -> PatternOfRegexp {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let Parent::Expr(around) = bound.expr_parent[mention.idx()] else { return PatternOfRegexp::NotSeen };
        match hir[around].kind {
            ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == mention => match hir.ids(hir[call].args).next() {
                None => PatternOfRegexp::WithoutPropertyEscape,
                Some(pattern) if matches!(hir[pattern].kind, ExprKind::Regex) => PatternOfRegexp::WithoutPropertyEscape,
                Some(pattern) => match self.constant_text(pattern) {
                    Some(text) if has_property_escape(self.checker.borrow().atoms().bytes(text)) => PatternOfRegexp::WithPropertyEscape,
                    Some(_) => PatternOfRegexp::WithoutPropertyEscape,
                    None => PatternOfRegexp::NotSeen,
                },
            },
            ExprKind::Unary { op: UnOp::Typeof, .. } => PatternOfRegexp::WithoutPropertyEscape,
            ExprKind::Binary { op: BinOp::Instanceof, right, .. } if right == mention => PatternOfRegexp::WithoutPropertyEscape,
            ExprKind::Dot { obj, name, .. } if obj == mention && MEMBERS_OF_REGEXP_THAT_MAKE_NONE.contains(&self.checker.borrow().atoms().bytes(name)) => PatternOfRegexp::WithoutPropertyEscape,
            _ => PatternOfRegexp::NotSeen,
        }
    }

    fn constant_text(&self, mut e: ExprId) -> Option<Atom> {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let skip_assertions = |mut e: ExprId| {
            while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) = hir[e].kind {
                e = expr;
            }
            e
        };
        e = skip_assertions(e);
        if let (ExprKind::Ident(_), Some(symbol)) = (hir[e].kind, bound.expr_symbol[e.idx()].some())
            && let [Decl::Var(pat)] = bound.symbols[symbol.idx()].decls[..]
            && let PatParent::Var(declaration) = bound.pat_parent[pat.idx()]
            && hir[declaration].pat == pat
            && hir[declaration].init.is_some()
            && hir[declaration].kind != VarKind::Var
            && is_never_stored_to(self.module, symbol)
        {
            e = skip_assertions(hir[declaration].init);
        }
        match hir[e].kind {
            ExprKind::String(name) => Some(name),
            ExprKind::Template { exprs } if exprs.is_empty() => Some(hir.id_at(hir.template_texts(exprs), 0)),
            ExprKind::Number(_) => None,
            _ => self.checker.borrow_mut().fold_constant_string(self.file, e).map(|folded| folded.0),
        }
    }

    fn named_by(&self, e: ExprId, found: &mut Vec<Atom>, hands_out_values: &mut bool) {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let known = self.reflection;
        *hands_out_values = false;
        let hands_out = |obj: ExprId, name: Atom| name == known.get && self.is_global(obj, known.reflect) || name == known.get_own_property_descriptor && (self.is_global(obj, known.reflect) || self.is_global(obj, known.object));
        let member_at = |e: ExprId| match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => Some((obj, name)),
            ExprKind::Index { obj, index, .. } => self.constant_key(index).map(|name| (obj, name)),
            _ => None,
        };
        match hir[e].kind {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let Some((obj, name)) = member_at(e) else { return };
                found.push(name);
                let is_called = matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) if hir[call].callee == e));
                let is_read_from_global_object = (name == known.reflect || name == known.object) && known.global_objects.iter().any(|&global_object| global_object.is_some() && self.is_global(obj, global_object));
                *hands_out_values = hands_out(obj, name) && !is_called || name == known.get_own_property_descriptors && self.is_global(obj, known.object) || is_read_from_global_object;
                let is_stringify_taken_out = name == known.stringify && self.is_global(obj, known.json) && !is_called;
                if *hands_out_values || name == known.lookup_getter || name == known.lookup_setter || is_stringify_taken_out {
                    found.push(Atom::NONE);
                }
            }
            ExprKind::Binary { op: BinOp::In, left: key, .. } => found.extend(self.constant_key(key)),
            ExprKind::Call(call) => {
                if let Some((obj, name)) = member_at(hir[call].callee)
                    && name == known.stringify
                    && self.is_global(obj, known.json)
                {
                    let mut arguments = hir.ids(hir[call].args);
                    let (value, names): (Option<ExprId>, Option<ExprId>) = (arguments.next(), arguments.next());
                    let is_spread = |argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
                    match names.map(|names| (names, hir[without_assertions(self.module, names)].kind)) {
                        _ if value.is_some_and(is_spread) => found.push(Atom::NONE),
                        None | Some((_, ExprKind::Null | ExprKind::Fn(_))) => {}
                        Some((names, ExprKind::Ident(known::undefined))) if is_free(self.module, without_assertions(self.module, names)) => {}
                        Some((names, ExprKind::Ident(_))) if bound.expr_symbol[without_assertions(self.module, names).idx()].some().is_some_and(|holder| is_function_stored_once(self.module, holder)) => {}
                        Some((_, ExprKind::Array(listed))) => {
                            for name in hir.ids(listed).filter(|&name: &ExprId| !matches!(hir[name].kind, ExprKind::Number(_))) {
                                found.push(self.constant_key(name).unwrap_or(Atom::NONE));
                            }
                        }
                        Some(_) => found.push(Atom::NONE),
                    }
                }
                if let Some((obj, name)) = member_at(hir[call].callee)
                    && hands_out(obj, name)
                {
                    let key = hir.ids(hir[call].args).nth(1).and_then(|key: ExprId| self.constant_key(key)).unwrap_or(Atom::NONE);
                    found.push(key);
                    if key == known.lookup_getter || key == known.lookup_setter {
                        found.push(Atom::NONE);
                    }
                    *hands_out_values = true;
                }
                if let Some((obj, name)) = member_at(hir[call].callee)
                    && (name == known.get || name == known.set)
                    && self.is_global(obj, known.reflect)
                {
                    let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                    let is_same_variable = |one: ExprId, other: ExprId| matches!((hir[one].kind, hir[other].kind), (ExprKind::Ident(_), ExprKind::Ident(_))) && bound.expr_symbol[one.idx()].is_some() && bound.expr_symbol[one.idx()] == bound.expr_symbol[other.idx()] && is_never_stored_to(self.module, bound.expr_symbol[one.idx()]);
                    let receiver = arguments.get(if name == known.get { 2 } else { 3 });
                    if arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))) || receiver.is_some_and(|&receiver| !is_same_variable(arguments[0], receiver)) {
                        found.push(Atom::NONE);
                        *hands_out_values = true;
                    }
                }
            }
            ExprKind::Ident(written) if (written == known.reflect || written == known.object || written == known.json) && is_free(self.module, e) => {
                let is_only_read = matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if match hir[around].kind {
                    ExprKind::Dot { obj, .. } => obj == e,
                    ExprKind::Index { obj, index, .. } => obj == e && self.constant_key(index).is_some(),
                    ExprKind::Binary { op: BinOp::Instanceof, right, .. } => right == e,
                    ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. } | ExprKind::Unary { op: UnOp::Typeof, .. } => true,
                    ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee == e,
                    _ => false,
                });
                if !is_only_read {
                    found.push(Atom::NONE);
                    *hands_out_values = written != known.json;
                }
            }
            ExprKind::Assign { op: None, target, .. } if matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_)) => {
                let mut targets = vec![target];
                while let Some(target) = targets.pop() {
                    match hir[target].kind {
                        ExprKind::Object(props) => {
                            for prop in props.iter().map(|prop| &hir[prop]) {
                                let name = match prop.key {
                                    PropKey::Name(name) => Some(name),
                                    PropKey::Computed(key) => self.constant_key(key),
                                    PropKey::None | PropKey::Private(_) => None,
                                };
                                found.extend(name);
                                if name.is_some_and(|name| name == known.lookup_getter || name == known.lookup_setter) {
                                    found.push(Atom::NONE);
                                }
                                targets.extend(prop.value.some());
                            }
                        }
                        ExprKind::Array(elements) => targets.extend(hir.ids(elements).filter(|element: &ExprId| element.is_some())),
                        ExprKind::Assign { op: None, target, .. } | ExprKind::Spread(target) => targets.push(target),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
}

const WELL_KNOWN_SYMBOLS: [&[u8]; 15] = [
    b"asyncDispose",
    b"asyncIterator",
    b"dispose",
    b"hasInstance",
    b"isConcatSpreadable",
    b"iterator",
    b"match",
    b"matchAll",
    b"replace",
    b"search",
    b"species",
    b"split",
    b"toPrimitive",
    b"toStringTag",
    b"unscopables",
];
const CALL_MEMBERS_UNDER_NAMES_OUT_OF_DATA: [&[u8]; 3] = [b"global WebAssembly", b"native bun:test", b"Bun jest"];
const MEMBERS_OF_OBJECT_PROTOTYPE_THAT_MAY_BE_LEFT_OUT: [&[u8]; 4] = [b"__defineGetter__", b"__defineSetter__", b"__lookupGetter__", b"__lookupSetter__"];
const DEFINE_A_PROPERTY: [&[u8]; 5] = [b"defineProperty", b"defineProperties", b"set", b"__defineGetter__", b"__defineSetter__"];

#[derive(Default)]
struct KeysDefined {
    on_what_exists: Vec<Atom>,
    has_traps: bool,
}

impl Properties<'_, '_, '_> {
    fn is_constant_symbol(&self, key: ExprId) -> bool {
        let hir = &self.module.hir;
        let is_member_of_symbol = |e: ExprId, names: &[&[u8]]| matches!(hir[e].kind, ExprKind::Dot { obj, name, .. } if self.is_global(obj, known::Symbol) && names.contains(&self.checker.borrow().atoms().bytes(name)));
        let is_made_here = matches!(hir[key].kind, ExprKind::Call(call) if is_member_of_symbol(hir[call].callee, &[b"for"]) || self.is_global(hir[call].callee, known::Symbol));
        is_member_of_symbol(key, &WELL_KNOWN_SYMBOLS) || is_made_here || self.checker.borrow().constant_symbol_named_by(self.file, key).is_some()
    }

    fn key_defined_through(&self, atoms: &Interner<'_>, member: ExprId, obj: ExprId, name: Atom) -> Option<Atom> {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let arguments: Option<Vec<ExprId>> = match bound.expr_parent[member.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Call(call) if hir[call].callee == member => Some(hir.ids(hir[call].args).collect()),
                _ => None,
            },
            _ => None,
        };
        let are_seen = arguments.as_ref().is_some_and(|arguments| !arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))));
        let count = arguments.as_ref().map_or(0, Vec::len);
        let key_at = |position: usize| match arguments.as_ref().filter(|_| are_seen).and_then(|arguments| arguments.get(position)) {
            Some(&key) if self.is_constant_symbol(key) => None,
            Some(&key) => Some(self.constant_key(key).unwrap_or(Atom::NONE)),
            None => Some(Atom::NONE),
        };
        match atoms.bytes(name) {
            b"defineProperty" => key_at(1),
            b"defineProperties" => match arguments.as_ref().filter(|_| are_seen).and_then(|arguments| arguments.get(1)).map(|&descriptors| hir[descriptors].kind) {
                Some(ExprKind::Object(props)) if props.iter().all(|prop| hir[prop].kind != PropKind::Spread) => None,
                _ => Some(Atom::NONE),
            },
            b"set" if are_seen && count < 3 => None,
            b"set" if arguments.is_none() && !self.is_global(obj, self.reflection.reflect) => None,
            b"set" => key_at(1),
            b"__defineGetter__" | b"__defineSetter__" => key_at(0),
            _ => None,
        }
    }

    fn keys_defined(&self, atoms: &Interner<'_>) -> KeysDefined {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let mut defined = KeysDefined::default();
        let key_of = |key: PropKey| match key {
            PropKey::Name(name) => Some(name),
            PropKey::Computed(key) if self.is_constant_symbol(key) => None,
            PropKey::Computed(key) => Some(self.constant_key(key).unwrap_or(Atom::NONE)),
            PropKey::None | PropKey::Private(_) => None,
        };
        let fields = hir.members.iter().enumerate().filter(|it| matches!(it.1.kind, bun_sema::hir::MemberKind::Property) && matches!(bound.member_owner[it.0], MemberOwner::Class(_)));
        defined.on_what_exists.extend(fields.filter_map(|field| key_of(field.1.key)));
        let is_definer = |name: Atom| DEFINE_A_PROPERTY.contains(&atoms.bytes(name));
        let takes_a_definer_apart = |key: PropKey| matches!(key, PropKey::Name(name) if is_definer(name));
        let binds_a_definer = hir.pat_props.iter().any(|prop| takes_a_definer_apart(prop.key) || matches!((prop.key, hir[prop.value].kind), (PropKey::None, PatKind::Ident(name)) if is_definer(name)));
        defined.on_what_exists.extend(binds_a_definer.then_some(Atom::NONE));
        for (index, expr) in hir.exprs.iter().enumerate().filter(|it| bound.expr_parent[it.0] != Parent::None) {
            let e = ExprId::from(index as u32);
            match expr.kind {
                ExprKind::Ident(name) if atoms.bytes(name) == b"Proxy" && is_free(self.module, e) => defined.has_traps = true,
                ExprKind::Dot { obj, name, .. } => {
                    defined.on_what_exists.extend(self.key_defined_through(atoms, e, obj, name));
                    defined.on_what_exists.extend(self.keys_of_descriptors_handed_to(atoms, e, name));
                }
                ExprKind::Index { obj, index, .. } => {
                    if let Some(name) = self.constant_key(index) {
                        defined.on_what_exists.extend(self.key_defined_through(atoms, e, obj, name));
                        defined.on_what_exists.extend(self.keys_of_descriptors_handed_to(atoms, e, name));
                    }
                }
                ExprKind::Assign { op: None, target, .. } => {
                    if let ExprKind::Object(props) = hir[target].kind
                        && props.iter().any(|prop| takes_a_definer_apart(hir[prop].key) || matches!(hir[prop].kind, PropKind::Shorthand if matches!(hir[hir[prop].value].kind, ExprKind::Ident(name) if is_definer(name))))
                    {
                        defined.on_what_exists.push(Atom::NONE);
                    }
                }
                _ => {}
            }
        }
        defined
    }

    fn keys_of_descriptors_handed_to(&self, atoms: &Interner<'_>, member: ExprId, name: Atom) -> Vec<Atom> {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        if atoms.bytes(name) != b"defineProperties" {
            return Vec::new();
        }
        let descriptors = match bound.expr_parent[member.idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Call(call) if hir[call].callee == member => hir.ids(hir[call].args).nth(1).map(|descriptors: ExprId| hir[descriptors].kind),
                _ => None,
            },
            _ => None,
        };
        let Some(ExprKind::Object(props)) = descriptors else { return Vec::new() };
        let keys = props.iter().map(|prop| hir[prop].key);
        keys.filter_map(|key| match key {
            PropKey::Name(name) => Some(name),
            PropKey::Computed(key) if self.is_constant_symbol(key) => None,
            PropKey::Computed(key) => Some(self.constant_key(key).unwrap_or(Atom::NONE)),
            PropKey::None | PropKey::Private(_) => None,
        })
        .collect()
    }
}

struct Scan<'a, 's> {
    atoms: &'a Interner<'s>,
    get_builtin_module: Option<Atom>,
    globals: [Option<Atom>; GLOBALS.len()],
    global_objects: Vec<Atom>,
    named: Vec<Atom>,
    is_named: FxHashSet<Atom>,
    read: FxHashSet<(usize, Atom)>,
    loader_entry: Option<&'static str>,
    loader_entries: Vec<(&'static str, Vec<u8>, u32)>,
    loader_entry_sites: Vec<(u32, ExprId)>,
    file_loader_entry_sites: Vec<(u32, ExprId)>,
    has_unlocated_loader_entry: bool,
    leaks_global_object: bool,
    listens_for_messages: bool,
    preserves_source_paths: bool,
    global_names: FxHashSet<Atom>,
    native_bindings: FxHashSet<(Atom, Atom)>,
    openings: Vec<(u32, ExprId, &'static str)>,
    listeners_of_the_global_object: Vec<(u32, ExprId, Atom)>,
    dispatched: Dispatched,
    touches_every_member_of: [bool; GLOBALS.len() + 1],
    named_at: Vec<(u32, ExprId, Name)>,
    stored_on_globals: Vec<(u32, ExprId, usize, Atom)>,
    called_on_globals: FxHashSet<(usize, Atom)>,
    globals_that_roots_wait_for: Vec<Atom>,
    values_that_roots_wait_for: Vec<Atom>,
    symbol_constructor: Option<Atom>,
    list_symbols: [Option<Atom>; 2],
}

impl<'a, 's> Scan<'a, 's> {
    fn empty(atoms: &'a Interner<'s>, preserves_source_paths: bool) -> Scan<'a, 's> {
        let waited_for = |kind: &[u8]| {
            let mut names: Vec<Atom> = Vec::new();
            for name in Archive::embedded().manifest().roots_made_for().flat_map(|waiting| waiting.1).filter_map(|fact| atoms.lookup(fact.strip_prefix(kind)?)) {
                if !names.contains(&name) {
                    names.push(name);
                }
            }
            names
        };
        Scan {
            atoms,
            get_builtin_module: atoms.lookup(b"getBuiltinModule"),
            globals: GLOBALS.map(|global| atoms.lookup(global.0)),
            global_objects: GLOBAL_OBJECTS.iter().filter_map(|name| atoms.lookup(name)).collect(),
            named: Vec::new(),
            is_named: FxHashSet::default(),
            read: FxHashSet::default(),
            loader_entry: None,
            loader_entries: Vec::new(),
            loader_entry_sites: Vec::new(),
            file_loader_entry_sites: Vec::new(),
            has_unlocated_loader_entry: false,
            leaks_global_object: false,
            listens_for_messages: false,
            preserves_source_paths,
            global_names: FxHashSet::default(),
            native_bindings: FxHashSet::default(),
            openings: Vec::new(),
            listeners_of_the_global_object: Vec::new(),
            dispatched: Dispatched::default(),
            touches_every_member_of: Default::default(),
            named_at: Vec::new(),
            stored_on_globals: Vec::new(),
            called_on_globals: FxHashSet::default(),
            globals_that_roots_wait_for: waited_for(b"global "),
            values_that_roots_wait_for: waited_for(b"value "),
            symbol_constructor: atoms.lookup(b"Symbol"),
            list_symbols: [atoms.lookup(b"getOwnPropertySymbols"), atoms.lookup(b"ownKeys")],
        }
    }

    fn name(&mut self, specifier: Atom) {
        if specifier.is_some() && self.is_named.insert(specifier) {
            self.named.push(specifier);
        }
    }

    fn merge_scan(&mut self, later: Scan<'_, '_>) {
        for specifier in later.named {
            self.name(specifier);
        }
        self.read.extend(later.read);
        self.loader_entry = self.loader_entry.or(later.loader_entry);
        self.loader_entries.extend(later.loader_entries);
        self.loader_entry_sites.extend(later.loader_entry_sites);
        self.file_loader_entry_sites.extend(later.file_loader_entry_sites);
        self.has_unlocated_loader_entry |= later.has_unlocated_loader_entry;
        self.leaks_global_object |= later.leaks_global_object;
        self.listens_for_messages |= later.listens_for_messages;
        self.global_names.extend(later.global_names);
        self.native_bindings.extend(later.native_bindings);
        self.openings.extend(later.openings);
        self.listeners_of_the_global_object.extend(later.listeners_of_the_global_object);
        self.dispatched.add(later.dispatched);
        for (touches, later) in self.touches_every_member_of.iter_mut().zip(later.touches_every_member_of) {
            *touches |= later;
        }
        self.named_at.extend(later.named_at);
        self.stored_on_globals.extend(later.stored_on_globals);
        self.called_on_globals.extend(later.called_on_globals);
    }

    fn module_global(&self, specifier: Atom) -> Option<usize> {
        if specifier.is_none() {
            return None;
        }
        let text = self.atoms.bytes(specifier);
        GLOBALS.iter().position(|global| global.1.contains(&text))
    }

    fn file(&mut self, number: u32, module: &Module<'_>) {
        let hir = &module.hir;
        let is_free = |e: ExprId| is_free(module, e);
        let is_runtime_source = module.builtin.is_some();
        let mut named_at: Vec<(ExprId, Name)> = Vec::new();
        named_at.extend(hir.import_attributes.iter().next().map(|_| (ExprId::NONE, Name::LoadsPage)));
        let says_addon = |prop: PropId| matches!((hir[prop].key, hir[hir[prop].value].kind), (PropKey::Name(key), ExprKind::String(said)) if self.atoms.bytes(key) == b"type" && matches!(self.atoms.bytes(said), b"napi" | b"node"));
        let is_imported_as_addon = hir.import_attributes.iter().any(|of| matches!(hir[of.1].kind, ExprKind::Object(props) if props.iter().any(says_addon)));
        let mut why_open: Vec<(&'static str, ExprId)> = Vec::new();
        why_open.extend(is_imported_as_addon.then_some((NATIVE_ADDON, ExprId::NONE)));
        let mut global_names: Vec<Atom> = Vec::new();
        let mut listeners: Vec<ExprId> = Vec::new();
        let mut dispatchers: Vec<ExprId> = Vec::new();
        let mut stored = StoredOnGlobals::default();
        let mut bound_at_top_level: Vec<(Atom, usize)> = Vec::new();
        let mut taken_by_name: Vec<(usize, Atom)> = Vec::new();
        let mut escaping: Vec<usize> = Vec::new();
        for import in hir.imports.iter().filter(|import| !import.type_only) {
            let Some(global) = self.module_global(import.spec) else { continue };
            bound_at_top_level.extend([import.default, import.namespace].into_iter().filter(|name| name.is_some()).map(|name| (name, global)));
            for spec in import.named.iter().map(|spec| &hir[spec]).filter(|spec| !spec.type_only) {
                match spec.imported {
                    known::default => bound_at_top_level.push((spec.local, global)),
                    imported => taken_by_name.push((global, imported)),
                }
            }
        }
        for alias in hir.import_equals.iter().filter(|alias| !alias.flags.contains(Flags::TYPE_ONLY)) {
            match self.module_global(alias.target.spec()) {
                Some(global) if alias.flags.contains(Flags::EXPORT) => escaping.push(global),
                Some(global) => bound_at_top_level.push((alias.name, global)),
                None => {}
            }
        }
        for export in hir.exports.iter().filter(|export| !export.type_only) {
            for item in export.items.iter().map(|item| &hir[item]).filter(|item| !item.type_only) {
                match self.module_global(export.spec) {
                    Some(global) if item.local == known::default => escaping.push(global),
                    Some(global) => {
                        taken_by_name.push((global, item.local));
                        if global == BUN && self.atoms.bytes(item.local) == b"serve" {
                            named_at.extend(ANY_OPTION_OF_A_SERVER.map(|name| (ExprId::NONE, name)));
                        }
                    }
                    None if export.has_module_specifier => {}
                    None => escaping.extend(bound_at_top_level.iter().filter(|held| held.0 == item.local).map(|held| held.1)),
                }
            }
        }
        escaping.extend(hir.ids(hir.body).filter_map(|stmt| match hir[stmt].kind {
            StmtKind::ExportStar { spec, type_only: false, .. } => self.module_global(spec),
            _ => None,
        }));
        for (index, alias) in hir.import_equals.iter().enumerate().filter(|it| !it.1.flags.contains(Flags::TYPE_ONLY)) {
            let bun_sema::hir::ImportEqualsTarget::Entity(path) = alias.target else { continue };
            if hir.texts(path).next().is_none_or(|first| !is_free_in(module, module.bound.import_equals_scope[index], first)) {
                continue;
            }
            let mut names = hir.texts(path).skip_while(|name| self.global_objects.contains(name));
            let Some(name) = names.next() else {
                why_open.push(("the global object", ExprId::NONE));
                continue;
            };
            global_names.push(name);
            named_at.push((ExprId::NONE, Name::member(GLOBAL_OBJECT, name)));
            named_at.extend(names.clone().map(|member| (ExprId::NONE, Name::Property(member))));
            match (self.globals.iter().position(|&global| global == Some(name)), names.next()) {
                (Some(global), Some(member)) => taken_by_name.push((global, member)),
                (Some(global), None) if global < 2 => escaping.push(global),
                (Some(global), None) => {
                    self.read.insert((global, Atom::NONE));
                    named_at.push((ExprId::NONE, Name::member(global, Atom::NONE)));
                }
                (None, _) => {}
            }
        }
        for (global, name) in taken_by_name {
            self.read.insert((global, name));
            named_at.push((ExprId::NONE, Name::member(global, name)));
            why_open.extend(member_that_opens_the_world(self.atoms, global, name).map(|why| (why, ExprId::NONE)));
            let hands_out_process_or_modules = RETURN_THE_RECEIVER.contains(&self.atoms.bytes(name)) || Some(name) == self.get_builtin_module || self.atoms.bytes(name) == b"mainModule";
            escaping.extend((global == 0 && hands_out_process_or_modules).then_some(0));
        }
        for global in escaping {
            self.read.insert((global, Atom::NONE));
            self.has_unlocated_loader_entry = true;
            self.file_loader_entry_sites.push((number, ExprId::NONE));
            why_open.push((why_it_escapes(global, "the global object"), ExprId::NONE));
        }
        for used in hir.specifier_uses.iter() {
            let mut imports = hir.imports.iter().filter(|import| import.spec == used.spec).peekable();
            let is_only_for_types = used.kind == SpecifierKind::ImportType
                || used.kind == SpecifierKind::Import && imports.peek().is_some() && imports.all(|import| import.type_only);
            if is_only_for_types {
                continue;
            }
            self.name(used.spec);
            if used.spec.is_some() && self.atoms.bytes(used.spec).ends_with(b".html") {
                named_at.push((ExprId::NONE, Name::LoadsPage));
            }
            if !used.kind.is_call() {
                named_at.extend(native_module(self.atoms, used.spec).map(|name| (ExprId::NONE, name)));
            }
            let takes_helpers_of_the_bundler_by_name = used.kind == SpecifierKind::Import
                && used.spec.is_some()
                && self.atoms.bytes(used.spec) == b"bun:wrap"
                && hir.imports.iter().filter(|import| import.spec == used.spec).all(|import| import.default.is_none() && import.namespace.is_none())
                && hir.imports.iter().filter(|import| import.spec == used.spec).count() == hir.specifier_uses.iter().filter(|other| other.spec == used.spec).count();
            why_open.extend(module_that_opens_the_world(self.atoms, used.spec).filter(|_| !takes_helpers_of_the_bundler_by_name).map(|why| (why, ExprId::NONE)));
        }
        let created_requires = CreatedRequires::of(module, self.atoms);
        let get_builtin_module = self.get_builtin_module;
        let module_loaded_by = |call: &bun_sema::hir::Call| {
            let ExprKind::String(specifier) = hir[hir.ids(call.args).next()?].kind else { return None };
            let loads = match hir[call.callee].kind {
                ExprKind::Ident(known::require) => call.args.len() == 1,
                ExprKind::Ident(_) => created_requires.holders.contains(&module.bound.expr_symbol[call.callee.idx()]),
                ExprKind::Call(_) => created_requires.called_at_once.contains(&call.callee),
                ExprKind::Dot { name, .. } if Some(name) == get_builtin_module => true,
                ExprKind::Dot { obj, name: known::require, .. } => call.args.len() == 1 && matches!(hir[obj].kind, ExprKind::Ident(known::module)),
                _ => false,
            };
            loads.then_some(specifier)
        };
        for call in hir.calls.iter() {
            let Some(specifier) = module_loaded_by(call) else { continue };
            self.name(specifier);
            named_at.extend(native_module(self.atoms, specifier).map(|name| (call.callee, name)));
            why_open.extend(module_that_opens_the_world(self.atoms, specifier).map(|why| (why, if why == NATIVE_ADDON { ExprId::NONE } else { call.callee })));
        }
        let asserted = |mut e: ExprId| loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => e = expr,
                _ => return e,
            }
        };
        let global_of_global_object = |obj: ExprId, name: Atom| match hir[asserted(obj)].kind {
            ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(asserted(obj)) => self.globals.iter().position(|&global| global == Some(name)),
            _ => None,
        };
        let global_of_module = |specifier: Atom| GLOBALS.iter().position(|global| specifier.is_some() && global.1.contains(&self.atoms.bytes(specifier)));
        let global_bound_by = |decl: Decl| match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) if !hir[import].type_only => global_of_module(hir[import].spec),
            Decl::ImportSpec(spec) if hir[spec].imported == known::default && !hir[spec].type_only && !hir[hir[spec].import].type_only => global_of_module(hir[hir[spec].import].spec),
            Decl::ImportEquals(alias) if !hir[alias].flags.contains(Flags::TYPE_ONLY) => global_of_module(hir[alias].target.spec()),
            _ => None,
        };
        let global_imported_by = |e: ExprId| match hir[e].kind {
            ExprKind::ImportCall { args } => match hir[hir.id_at(args, 0)].kind {
                ExprKind::String(specifier) => global_of_module(specifier),
                _ => None,
            },
            _ => None,
        };
        let member_at = |e: ExprId| member_at(module, e);
        let global_at = |mut e: ExprId| {
            while let Some((obj, known::default)) = member_at(e) {
                e = asserted(obj);
            }
            match hir[e].kind {
                ExprKind::Ident(name) => match self.globals.iter().position(|&global| global == Some(name)) {
                    Some(global) if is_free(e) => Some(global),
                    _ => module.bound.symbols[module.bound.expr_symbol[e.idx()].some()?.idx()].decls.iter().find_map(|&decl| global_bound_by(decl)),
                },
                ExprKind::Call(call) => module_loaded_by(&hir[call]).and_then(global_of_module),
                ExprKind::Await(promise) => global_imported_by(asserted(promise)),
                _ => member_at(e).and_then(|(obj, name)| global_of_global_object(obj, name)),
            }
        };
        for call in hir.calls.iter().filter(|call| is_runtime_source && call.args.len() >= 2) {
            if let ExprKind::Ident(callee) = hir[call.callee].kind
                && matches!(self.atoms.bytes(callee), b"$cpp" | b"$rust" | b"$newCppFunction" | b"$newRustFunction" | b"$bindgen")
                && let (ExprKind::String(file), ExprKind::String(symbol)) = (hir[hir.id_at(call.args, 0)].kind, hir[hir.id_at(call.args, 1)].kind)
            {
                self.native_bindings.insert((file, symbol));
                named_at.push((call.callee, Name::Native(file, symbol)));
            }
        }
        let is_node_module = |specifier: Atom| specifier.is_some() && matches!(self.atoms.bytes(specifier), b"module" | b"node:module");
        let loads_node_module = hir.specifier_uses.iter().any(|used| used.kind != SpecifierKind::ImportType && is_node_module(used.spec))
            || hir.calls.iter().filter(|call| !call.args.is_empty()).any(|call| matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(specifier) if is_node_module(specifier)));
        if loads_node_module {
            let export = |name: Atom| (name.is_some() && SAFE_NODE_MODULE_EXPORTS.contains(&self.atoms.bytes(name))).then_some(Name::ExportOfNodeModule(name));
            let imported = hir.imports.iter().filter(|import| !import.type_only && is_node_module(import.spec)).flat_map(|import| import.named.iter()).filter(|&spec| !hir[spec].type_only);
            named_at.extend(imported.filter_map(|spec| export(hir[spec].imported)).map(|name| (ExprId::NONE, name)));
            named_at.extend(hir.exprs.iter().enumerate().filter_map(|(index, expr)| match expr.kind {
                ExprKind::Dot { name, .. } | ExprKind::String(name) => Some((ExprId::from(index as u32), export(name)?)),
                _ => None,
            }));
            named_at.extend(hir.pat_props.iter().filter_map(|prop| match (prop.key, hir[prop.value].kind) {
                (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => Some((ExprId::NONE, export(name)?)),
                _ => None,
            }));
        }
        let mut is_only_read: FxHashSet<ExprId> = FxHashSet::default();
        let mut read: Vec<(usize, Atom, ExprId)> = Vec::new();
        let mut mentions: Vec<(ExprId, usize)> = Vec::new();
        let mut touched: Vec<(usize, Atom, ExprId)> = Vec::new();
        let mut promised: Vec<(usize, ExprId)> = Vec::new();
        let hands_receiver_on = |name: Atom| name.is_some() && (HAND_THE_RECEIVER_ON.contains(&self.atoms.bytes(name)) || LEAD_TO_THE_PROTOTYPE.contains(&self.atoms.bytes(name)));
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if matches!(expr.kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) && is_operand_of_type_query(module, e) {
                continue;
            }
            if let Some(global) = global_at(e) {
                mentions.push((e, global));
            }
            if let ExprKind::ImportCall { args } = expr.kind
                && let ExprKind::String(specifier) = hir[hir.id_at(args, 0)].kind
            {
                named_at.extend(native_module(self.atoms, specifier).map(|name| (e, name)));
            }
            if let Some(global) = global_imported_by(e)
                && !matches!(module.bound.expr_parent[with_assertions(module, e).idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Await(_)))
            {
                promised.push((global, e));
            }
            if let ExprKind::Ident(name) = expr.kind
                && names_global(module, self.atoms, e, name)
            {
                global_names.push(name);
                if self.globals_that_roots_wait_for.contains(&name) && !(is_runtime_source && name == known::require && is_called(module, e).is_some()) {
                    named_at.push((e, Name::member(GLOBAL_OBJECT, name)));
                }
                if self.values_that_roots_wait_for.contains(&name) && is_called(module, e).is_none() && !is_operand_of_typeof(module, e) {
                    named_at.push((e, Name::Value(name)));
                }
                if Some(name) == self.symbol_constructor {
                    named_at.extend(symbol_made_through(module, self.atoms, e).map(|name| (e, name)));
                }
                touched.extend(is_deleted(module, e).then_some((GLOBAL_OBJECT, Atom::NONE, e)));
                if self.atoms.bytes(name) == b"addEventListener" {
                    listeners.push(e);
                }
                if self.atoms.bytes(name) == b"dispatchEvent" {
                    dispatchers.push(e);
                }
                if is_target_in_a_pattern(module, e) {
                    stored.add_what_is_not_seen(self.atoms, GLOBAL_OBJECT, name, e);
                }
            }
            let (obj, name) = match expr.kind {
                ExprKind::Dot { obj, name, .. } => (obj, name),
                ExprKind::Index { obj, index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (obj, name),
                    _ => continue,
                },
                ExprKind::Unary { op: UnOp::Typeof, operand } => (operand, Atom::NONE),
                _ => continue,
            };
            let obj = asserted(obj);
            if self.list_symbols.contains(&Some(name)) {
                named_at.push((e, Name::Symbol(Atom::NONE)));
            }
            if let Some(global) = global_at(obj).filter(|_| !hands_receiver_on(name)) {
                is_only_read.insert(obj);
                if name.is_some() {
                    read.push((global, name, e));
                    if global == 2 && !prints_only_primitives(module, self.atoms, e) {
                        named_at.push((e, if is_called(module, e).is_some() && !is_runtime_source { Name::PrintsArguments } else { Name::PrintsObject }));
                    }
                    if global == 0 && LISTENS.contains(&self.atoms.bytes(name)) {
                        named_at.extend(channel_events_listened_for(module, self.atoms, Some(e)).into_iter().map(|name| (e, name)));
                    }
                    touched.extend(looked_up_through(module, self.atoms, name, e).map(|name| (global, name, e)));
                }
            }
        }
        for declaration in hir.var_decls.iter().filter(|declaration| declaration.init.is_some()) {
            let destructured = asserted(declaration.init);
            let (Some(global), PatKind::Object(props)) = (global_at(destructured), hir[declaration.pat].kind) else { continue };
            let names: Option<Vec<Atom>> = props
                .iter()
                .map(|prop| &hir[prop])
                .map(|prop| match prop.key {
                    PropKey::Name(name) if !prop.is_rest => Some(name),
                    PropKey::None if !prop.is_rest => match hir[prop.value].kind {
                        PatKind::Ident(name) => Some(name),
                        _ => None,
                    },
                    _ => None,
                })
                .collect();
            let loads_modules = |name: Atom| Some(name) == self.get_builtin_module || self.atoms.bytes(name) == b"mainModule";
            if let Some(names) = names.filter(|names| !names.iter().any(|&name| loads_modules(name) || name == known::default)) {
                is_only_read.insert(destructured);
                if global == 0 && names.iter().any(|&name| LISTENS.contains(&self.atoms.bytes(name))) {
                    named_at.extend(channel_events_listened_for(module, self.atoms, None).into_iter().map(|name| (destructured, name)));
                }
                read.extend(names.into_iter().map(|name| (global, name, destructured)));
                named_at.extend((global == 2).then_some((destructured, Name::PrintsObject)));
            }
        }
        let loads_modules = |name: Atom| Some(name) == self.get_builtin_module || self.atoms.bytes(name) == b"mainModule";
        let mut file_loader_entries: Vec<(&'static str, u32, ExprId)> = Vec::new();
        for (global, promise) in promised {
            read.push((global, Atom::NONE, promise));
            file_loader_entries.push((why_it_escapes(global, "the global object"), hir[promise].pos, promise));
        }
        for (mention, global) in mentions.into_iter().filter(|mention| !is_only_read.contains(&mention.0)) {
            let mut reads = Vec::new();
            let mut looked_up = Vec::new();
            let mut stored_under_any_name = Vec::new();
            named_at.extend((global == 2).then_some((mention, Name::PrintsObject)));
            let hands_itself_on = |name: Atom| global == 0 && RETURN_THE_RECEIVER.contains(&self.atoms.bytes(name));
            if global < PERFORMANCE && is_read_only_by_literal_names(module, self.atoms, mention, &|name| name == known::default, &mut reads, &mut looked_up, &mut stored_under_any_name) && !reads.iter().any(|it| loads_modules(it.0) || hands_itself_on(it.0)) {
                looked_up.extend(stored_under_any_name.first().map(|_| Atom::NONE));
                for (at, value) in stored_under_any_name {
                    stored.add_under_any_name(module, self.atoms, global, at, value);
                }
                looked_up.extend(reads.iter().filter_map(|it| looked_up_through(module, self.atoms, it.0, it.1)));
                touched.extend(looked_up.into_iter().map(|name| (global, name, mention)));
                read.extend(reads.into_iter().map(|it| (global, it.0, it.1.some().unwrap_or(mention))));
            } else {
                read.push((global, Atom::NONE, mention));
                if global < 2 {
                    file_loader_entries.push((if global == 0 { "process" } else { "Bun" }, hir[mention].pos, mention));
                }
            }
        }
        let is_under_typeof = |e: ExprId| matches!(module.bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Unary { op: UnOp::Typeof, .. }));
        named_at.extend(read.iter().filter_map(|it| Some((it.2, Name::Binding(binding_asked_for_by_name(module, self.atoms, it.0, it.1, it.2)?)))));
        why_open.extend(read.iter().filter(|it| !is_under_typeof(it.2) && binding_asked_for_by_name(module, self.atoms, it.0, it.1, it.2).is_none()).filter_map(|it| Some((member_that_opens_the_world(self.atoms, it.0, it.1)?, it.2))));
        why_open.extend(read.iter().filter(|it| it.0 == 0 && is_deleted(module, it.2)).map(|it| ("process", it.2)));
        let methods_of_emitter: Vec<(Atom, ExprId)> = read.iter().filter(|it| it.0 == 0 && it.1.is_some() && RETURN_THE_RECEIVER.contains(&self.atoms.bytes(it.1)) && !is_under_typeof(it.2)).map(|it| (it.1, it.2)).collect();
        for (name, method) in methods_of_emitter {
            if !keeps_the_receiver_to_itself(module, method, LISTENS.contains(&self.atoms.bytes(name))) {
                read.push((0, Atom::NONE, method));
                file_loader_entries.push(("process", hir[method].pos, method));
            }
        }
        let inherits_from_prototype_of = |holder: ExprId| {
            let holder = asserted(holder);
            let name_of_global = match hir[holder].kind {
                ExprKind::Ident(name) if is_free(holder) => Some(name),
                _ => member_at(holder).filter(|member| matches!(hir[asserted(member.0)].kind, ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(asserted(member.0)))).map(|member| member.1),
            };
            match name_of_global.map(|name| self.atoms.bytes(name)) {
                Some(b"EventTarget" | b"Performance") => Some(PERFORMANCE),
                _ => is_event_emitter(module, self.atoms, &module_loaded_by, holder, MOST_STEPS_TO_NODE_EVENTS).then_some(0),
            }
        };
        let mut written_prototypes: Vec<(usize, ExprId)> = Vec::new();
        for e in hir.exprs.iter().enumerate().filter(|_| !is_runtime_source).map(|it| ExprId::from(it.0 as u32)) {
            if let Some((holder, known::prototype)) = member_at(e)
                && !is_operand_of_type_query(module, e)
                && let Some(global) = inherits_from_prototype_of(holder)
                && !is_object_only_read(module, self.atoms, e)
            {
                written_prototypes.push((global, e));
            }
        }
        for declaration in hir.var_decls.iter().filter(|declaration| !is_runtime_source && declaration.init.is_some()) {
            let PatKind::Object(props) = hir[declaration.pat].kind else { continue };
            let may_take_the_prototype = |prop: &bun_sema::hir::PatProp| match (prop.key, hir[prop.value].kind) {
                (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => key == known::prototype,
                _ => true,
            };
            if props.iter().any(|prop| may_take_the_prototype(&hir[prop])) {
                written_prototypes.extend(inherits_from_prototype_of(declaration.init).map(|global| (global, declaration.init)));
            }
        }
        for (global, prototype) in written_prototypes {
            read.push((global, Atom::NONE, prototype));
            if global == 0 {
                file_loader_entries.push(("process", hir[prototype].pos, prototype));
            }
        }
        for &(global, name, member) in read.iter().filter(|it| it.1.is_some()) {
            stored.add_member(module, self.atoms, global, name, member);
        }
        for expr in hir.exprs.iter() {
            if let ExprKind::Assign { target, value, .. } = expr.kind
                && let ExprKind::Ident(name) = hir[target].kind
                && names_global(module, self.atoms, target, name)
            {
                stored.add(module, self.atoms, GLOBAL_OBJECT, name, value, target);
            }
        }
        let is_stored_to = |member: ExprId| is_target_in_a_pattern(module, member) || matches!(module.bound.expr_parent[member.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Assign { target, .. } if target == member));
        let mut stored_on_performance: Vec<(usize, Atom, ExprId)> = read.iter().filter(|it| it.0 >= PERFORMANCE && is_stored_to(it.2)).map(|it| (it.0, Atom::NONE, it.2)).collect();
        read.append(&mut stored_on_performance);
        let mut inherited_by_performance: Vec<(usize, Atom, ExprId)> = read.iter().filter(|it| it.0 == PERFORMANCE && it.1.is_some() && !is_member_of(b"performance", self.atoms.bytes(it.1))).map(|it| (PERFORMANCE, Atom::NONE, it.2)).collect();
        read.append(&mut inherited_by_performance);
        named_at.extend(read.iter().filter(|it| it.1.is_some() || it.0 >= 2).map(|it| (it.2, Name::member(it.0, it.1))));
        self.read.extend(read.into_iter().map(|it| (it.0, it.1)));

        let is = |name: Atom, text: &[u8]| self.atoms.bytes(name) == text;
        let is_one_of = |name: Atom, names: &[&[u8]]| names.contains(&self.atoms.bytes(name));
        let variable_at = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) if (matches!(name, known::require | known::module | known::eval | known::Function) || is(name, b"Worker") || is(name, b"ShadowRealm")) && is_free(e) => Some(name),
            ExprKind::Dot { obj, name, .. } => match hir[asserted(obj)].kind {
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(asserted(obj)) => Some(name),
                _ => None,
            },
            _ => None,
        };
        let mut is_harmless: FxHashSet<ExprId> = FxHashSet::default();
        let mut listens_for_messages = false;
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            if let ExprKind::Dot { obj, name, .. } = hir[call.callee].kind
                && global_at(asserted(obj)) == Some(0)
                && is_one_of(name, &LISTENS)
                && !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(event) if !is(event, b"message") && !is(event, b"disconnect"))
            {
                listens_for_messages = true;
            }
            if call.args.len() == 1 && matches!(hir[call.callee].kind, ExprKind::Ident(known::require)) && cannot_name_builtin_module(module, self.atoms, hir.id_at(call.args, 0)) {
                is_harmless.insert(call.callee);
                if !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(_)) && is_free(call.callee) {
                    self.file_loader_entry_sites.push((number, call.callee));
                    why_open.push(("require of a path that is computed", call.callee));
                }
            }
            if let ExprKind::String(_) = hir[hir.id_at(call.args, 0)].kind {
                match hir[call.callee].kind {
                    ExprKind::Ident(known::require) if call.args.len() == 1 => _ = is_harmless.insert(call.callee),
                    ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => _ = is_harmless.insert(call.callee),
                    ExprKind::Dot { obj, name: known::require, .. } if call.args.len() == 1 && matches!(hir[obj].kind, ExprKind::Ident(known::module)) => _ = is_harmless.insert(obj),
                    _ => {}
                }
            }
        }
        let is_define_property = |callee: ExprId| matches!(hir[callee].kind, ExprKind::Dot { obj, name, .. } if is(name, b"defineProperty") && matches!(hir[obj].kind, ExprKind::Ident(object) if is(object, b"Object") && is_free(obj)));
        let does_not_escape = |mut e: ExprId| loop {
            match module.bound.expr_parent[e.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Unary { op: UnOp::Not | UnOp::Typeof, .. } | ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. } => return true,
                    ExprKind::Binary { op: BinOp::And, left, .. } if left == e => return true,
                    ExprKind::Cond { test, .. } if test == e => return true,
                    ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } | ExprKind::Cond { .. } => e = around,
                    ExprKind::Call(call) if !hir[call].args.is_empty() && hir.id_at(hir[call].args, 0) == e && is_define_property(hir[call].callee) => e = around,
                    ExprKind::Dot { obj, name, .. } => return obj == e && is_one_of(name, &OF_MODULE),
                    _ => return false,
                },
                Parent::Stmt(around) => return matches!(hir[around].kind, StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. }),
                _ => return false,
            }
        };
        let mut global_object_members: Vec<ExprId> = Vec::new();
        let is_only_compared = |e: ExprId| matches!(module.bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. }));
        let is_asked_for_its_constructor = |e: ExprId| match module.bound.expr_parent[with_assertions(module, e).idx()] {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Dot { name, .. } => is(name, b"constructor"),
                ExprKind::Index { index, .. } => !matches!(hir[index].kind, ExprKind::String(name) if !is(name, b"constructor")),
                _ => false,
            },
            _ => false,
        };
        for (index, expr) in hir.exprs.iter().enumerate() {
            let (obj, name) = match expr.kind {
                ExprKind::Dot { obj, name, .. } => (obj, name),
                ExprKind::Index { obj, index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (obj, name),
                    _ => continue,
                },
                ExprKind::Unary { op: UnOp::Typeof, operand } => {
                    is_harmless.insert(asserted(operand));
                    continue;
                }
                ExprKind::Binary { op: BinOp::Instanceof, right, .. } => {
                    is_harmless.insert(asserted(right));
                    continue;
                }
                ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, left, right } => {
                    is_harmless.insert(asserted(left));
                    is_harmless.insert(asserted(right));
                    continue;
                }
                _ => continue,
            };
            let obj = asserted(obj);
            match hir[obj].kind {
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(obj) && !is_operand_of_type_query(module, obj) => {
                    global_names.push(name);
                    named_at.push((ExprId::from(index as u32), Name::member(GLOBAL_OBJECT, name)));
                    if self.values_that_roots_wait_for.contains(&name) && is_called(module, ExprId::from(index as u32)).is_none() {
                        named_at.push((ExprId::from(index as u32), Name::Value(name)));
                    }
                    if is(name, b"Symbol") {
                        named_at.push((ExprId::from(index as u32), Name::Symbol(Atom::NONE)));
                    }
                    if is(name, b"console") {
                        named_at.push((ExprId::from(index as u32), Name::PrintsObject));
                    }
                    let asked = looked_up_through(module, self.atoms, name, ExprId::from(index as u32));
                    if is(name, b"__lookupGetter__") && asked.is_some_and(|asked| asked.is_none() || self.global_objects.contains(&asked)) {
                        why_open.push(("the global object", ExprId::from(index as u32)));
                    }
                    touched.extend(asked.map(|name| (GLOBAL_OBJECT, name, ExprId::from(index as u32))));
                    stored.add_member(module, self.atoms, GLOBAL_OBJECT, name, ExprId::from(index as u32));
                    if self.global_objects.contains(&name) {
                        global_object_members.push(ExprId::from(index as u32));
                    }
                    if is(name, b"addEventListener") {
                        listeners.push(ExprId::from(index as u32));
                    }
                    if is(name, b"dispatchEvent") {
                        dispatchers.push(ExprId::from(index as u32));
                    }
                }
                ExprKind::Ident(known::require) if is_free(obj) && (is(name, b"cache") || is(name, b"extensions") || is(name, b"main") && !is_only_compared(ExprId::from(index as u32))) => why_open.push(("require.main, require.cache or require.extensions", ExprId::from(index as u32))),
                ExprKind::Ident(known::module) if is_free(obj) && is(name, b"constructor") => why_open.push(("module.constructor", ExprId::from(index as u32))),
                ExprKind::Ident(known::module) if is_free(obj) && name == known::require && is_called(module, ExprId::from(index as u32)).is_none_or(|call| hir[call].args.len() != 1 || !matches!(hir[hir.id_at(hir[call].args, 0)].kind, ExprKind::String(_))) => {
                    file_loader_entries.push(("require", expr.pos, ExprId::from(index as u32)));
                }
                _ => {}
            }
            let may_be_read = match hir[obj].kind {
                ExprKind::ImportMeta => is_one_of(name, &SAFE_IMPORT_META_PROPERTIES),
                ExprKind::Ident(known::require) => is_one_of(name, &SAFE_REQUIRE_PROPERTIES),
                ExprKind::Ident(known::module) => is_one_of(name, &OF_MODULE) || is(name, b"hot") || (is(name, b"parent") || is(name, b"children")) && does_not_escape(ExprId::from(index as u32)),
                ExprKind::Ident(object) if self.global_objects.contains(&object) => !hands_receiver_on(name),
                _ => variable_at(obj) == Some(known::Function) && is_one_of(name, &SAFE_FUNCTION_PROPERTIES) && !is_asked_for_its_constructor(ExprId::from(index as u32)),
            };
            if may_be_read {
                is_harmless.insert(obj);
            }
        }
        let mut read_via_global_object: Vec<(usize, Atom)> = Vec::new();
        let mut touched_via_global_object: Vec<(usize, Atom, ExprId)> = Vec::new();
        let mut named_via_global_object: Vec<(ExprId, Name)> = Vec::new();
        let mut names_via_global_object: Vec<(Atom, ExprId)> = Vec::new();
        let mut stored_via_global_object: Vec<(usize, ExprId, ExprId)> = Vec::new();
        let mut members_via_global_object: Vec<(usize, Atom, ExprId)> = Vec::new();
        let mut stays_visible = |e: ExprId| match reads_of_global_object(module, self.atoms, &self.global_objects, &self.globals, self.get_builtin_module, e) {
            Some((names, found, touched, stored_under_any_name)) => {
                stored_via_global_object.extend(stored_under_any_name);
                named_via_global_object.extend(names.iter().map(|&(name, member)| (member.some().unwrap_or(e), Name::member(GLOBAL_OBJECT, name))));
                named_via_global_object.extend(names.iter().filter(|it| self.values_that_roots_wait_for.contains(&it.0)).map(|&(name, _)| (e, Name::Value(name))));
                named_via_global_object.extend(names.iter().filter(|it| self.atoms.bytes(it.0) == b"Symbol").map(|_| (e, Name::Symbol(Atom::NONE))));
                named_via_global_object.extend(names.iter().filter(|it| self.atoms.bytes(it.0) == b"console").map(|_| (e, Name::PrintsObject)));
                let reflecting = names.iter().filter(|it| matches!(self.atoms.bytes(it.0), b"Reflect" | b"Object"));
                named_via_global_object.extend(reflecting.flat_map(|&(_, member)| [Name::Property(Atom::NONE), Name::ConstructorOfFunctions].map(|name| (member.some().unwrap_or(e), name))));
                named_via_global_object.extend(found.iter().map(|&(global, name, _)| (e, Name::member(global, name))));
                names_via_global_object.extend(names);
                read_via_global_object.extend(found.iter().map(|&(global, name, _)| (global, name)));
                members_via_global_object.extend(found);
                touched_via_global_object.extend(touched.into_iter().map(|(kind, name)| (kind, name, e)));
                true
            }
            None => false,
        };
        for member in global_object_members {
            if !stays_visible(member) {
                why_open.push(("the global object", member));
            }
        }
        for (index, expr) in hir.exprs.iter().enumerate().filter(|_| may_strings_become_code()) {
            let (ExprKind::Call(call) | ExprKind::New(call)) = expr.kind else { continue };
            let created = ExprId::from(index as u32);
            if variable_at(hir[call].callee) != Some(known::Function) || hir[call].args.len() != 1 || !matches!(hir[hir.id_at(hir[call].args, 0)].kind, ExprKind::String(text) if matches!(self.atoms.bytes(text), b"return this" | b"return this;")) {
                continue;
            }
            if let Parent::Expr(called) = module.bound.expr_parent[created.idx()]
                && matches!(hir[called].kind, ExprKind::Call(outer) if hir[outer].callee == created && hir[outer].args.is_empty())
                && stays_visible(called)
            {
                is_harmless.insert(hir[call].callee);
                why_open.push(("a call of Function", created));
            }
        }
        let mut loader_entry = self.loader_entry;
        let mut named_via_created_requires: Vec<Atom> = Vec::new();
        let has_loader_access = |specifier: Atom| specifier.is_some() && MODULES_WITH_LOADER_ACCESS.contains(&self.atoms.bytes(specifier));
        for (index, expr) in hir.exprs.iter().enumerate() {
            let (loads, argument) = match expr.kind {
                ExprKind::ImportCall { args } => (ExprId::from(index as u32), hir.id_at(args, 0)),
                ExprKind::Call(call) if hir[call].args.len() == 1 && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) => (hir[call].callee, hir.id_at(hir[call].args, 0)),
                _ => continue,
            };
            if let Some(handed) = string_arguments_for_parameter(module, argument).filter(|handed| !handed.iter().any(|&specifier| has_loader_access(specifier))) {
                is_harmless.insert(loads);
                self.file_loader_entry_sites.push((number, loads));
                why_open.push(("require or import() of a parameter", loads));
                named_at.extend(handed.iter().filter_map(|&specifier| native_module(self.atoms, specifier)).map(|name| (loads, name)));
                named_via_created_requires.extend(handed);
            }
        }
        let loads_what_has_loader_access = |call: &bun_sema::hir::Call| {
            let Some(ExprKind::String(specifier)) = hir.ids(call.args).next().map(|first| hir[first].kind) else { return false };
            let loads = match hir[call.callee].kind {
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => true,
                ExprKind::Dot { obj, name: known::require, .. } => matches!(hir[obj].kind, ExprKind::Ident(known::module)),
                _ => false,
            };
            loads && has_loader_access(specifier)
        };
        let loaded_by_call: Vec<ExprId> = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Call(call) if loads_what_has_loader_access(&hir[call]))).map(|it| ExprId::from(it.0 as u32)).collect();
        let is_every_such_call_found = hir.calls.iter().filter(|call| loads_what_has_loader_access(call)).count() == loaded_by_call.len();
        let required: Vec<(ExprId, Atom)> = hir
            .exprs
            .iter()
            .enumerate()
            .filter_map(|(index, expr)| match expr.kind {
                ExprKind::Call(call) if !hir[call].args.is_empty() && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) => match hir[hir.id_at(hir[call].args, 0)].kind {
                    ExprKind::String(specifier) if has_loader_access(specifier) => Some((ExprId::from(index as u32), specifier)),
                    _ => None,
                },
                _ => None,
            })
            .collect();
        if !loaded_by_call.is_empty() || !is_every_such_call_found || !required.is_empty() || hir.specifier_uses.iter().any(|used| has_loader_access(used.spec)) {
            let bound = &module.bound;
            let makes_requires = |spec: bun_sema::hir::ImportSpecId| {
                let from = hir[hir[spec].import].spec;
                from.is_some() && is(hir[spec].imported, b"createRequire") && matches!(self.atoms.bytes(from), b"module" | b"node:module")
            };
            let is_safe_name = |spec: bun_sema::hir::ImportSpecId| {
                let names: &[&[u8]] = match self.atoms.bytes(hir[hir[spec].import].spec) {
                    b"cluster" | b"node:cluster" => &SAFE_CLUSTER_EXPORTS,
                    b"module" | b"node:module" => &SAFE_NODE_MODULE_EXPORTS,
                    b"worker_threads" | b"node:worker_threads" => &SAFE_WORKER_THREADS_EXPORTS,
                    _ => &[],
                };
                hir[spec].type_only || is_one_of(hir[spec].imported, names) || makes_requires(spec)
            };
            let mut is_always_safe = is_every_such_call_found
                && hir.specifier_uses.iter().filter(|used| has_loader_access(used.spec)).all(|used| matches!(used.kind, SpecifierKind::Import | SpecifierKind::SideEffect | SpecifierKind::ImportType | SpecifierKind::RequireCall))
                && !hir.exports.iter().any(|export| has_loader_access(export.spec))
                && !hir.ids(hir.body).any(|stmt| matches!(hir[stmt].kind, StmtKind::ExportStar { spec, .. } if has_loader_access(spec)))
                && hir.imports.iter().filter(|import| !import.type_only && has_loader_access(import.spec)).all(|import| import.named.iter().all(&is_safe_name));
            let called_by = |e: ExprId| match bound.expr_parent[e.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Call(call) if hir[call].callee == e => Some((around, call)),
                    _ => None,
                },
                _ => None,
            };
            let identifiers: Vec<ExprId> = hir
                .exprs
                .iter()
                .enumerate()
                .filter(|it| matches!(it.1.kind, ExprKind::Ident(_)))
                .map(|it| ExprId::from(it.0 as u32))
                .filter(|&e| bound.expr_symbol[e.idx()].is_some() && bound.expr_parent[e.idx()] != Parent::None && !bound.is_in_type_query(e))
                .collect();
            let reads_only_safe_names = |e: ExprId, specifier: Atom| {
                let names: &[&[u8]] = match self.atoms.bytes(specifier) {
                    b"cluster" | b"node:cluster" => &SAFE_CLUSTER_EXPORTS,
                    b"module" | b"node:module" => &SAFE_NODE_MODULE_EXPORTS,
                    b"worker_threads" | b"node:worker_threads" => &SAFE_WORKER_THREADS_EXPORTS,
                    _ => &[],
                };
                let may_bind_create_require = matches!(bound.expr_parent[e.idx()], Parent::VarInit(_)) && matches!(self.atoms.bytes(specifier), b"module" | b"node:module");
                let is_cluster = matches!(self.atoms.bytes(specifier), b"cluster" | b"node:cluster");
                let only_listens = |name: Atom, method: ExprId| is_cluster && method.is_some() && is_one_of(name, &LISTENS) && keeps_the_receiver_to_itself(module, method, true);
                let mut reads = Vec::new();
                let mut stored_under_any_name = Vec::new();
                is_read_only_by_literal_names(module, self.atoms, e, &|_| false, &mut reads, &mut Vec::new(), &mut stored_under_any_name) && stored_under_any_name.is_empty() && reads.iter().all(|it| is_one_of(it.0, names) || only_listens(it.0, it.1) || may_bind_create_require && it.1.is_none() && is(it.0, b"createRequire"))
            };
            if !required.iter().all(|&(call, specifier)| reads_only_safe_names(call, specifier)) {
                is_always_safe = false;
            }
            for &e in &identifiers {
                let whole = bound.symbols[bound.expr_symbol[e.idx()].idx()].decls.iter().find_map(|&decl| match decl {
                    Decl::ImportDefault(import) | Decl::ImportNamespace(import) if !hir[import].type_only && has_loader_access(hir[import].spec) => Some(hir[import].spec),
                    _ => None,
                });
                if whole.is_some_and(|specifier| !reads_only_safe_names(e, specifier)) {
                    is_always_safe = false;
                }
            }
            is_always_safe &= !created_requires.is_one_handed_on;
            let held = identifiers.iter().copied().filter(|&e| created_requires.holders.contains(&bound.expr_symbol[e.idx()]));
            for e in held.chain(created_requires.called_at_once.iter().copied()) {
                let written = called_by(e).and_then(|found| module_loaded_by(&hir[found.1]));
                let is_resolve = matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Dot { obj, name, .. } if obj == e && is(name, b"resolve")));
                match written {
                    Some(specifier) => named_via_created_requires.push(specifier),
                    None if is_resolve => {}
                    None => is_always_safe = false,
                }
            }
            if !is_always_safe || named_via_created_requires.iter().any(|&specifier| has_loader_access(specifier)) {
                loader_entry = loader_entry.or(Some("a module that loads modules or evaluates text"));
                file_loader_entries.push(("a module that loads modules or evaluates text", 0, ExprId::NONE));
            } else {
                loader_entry = loader_entry.or_else(|| loaded_by_call.first().map(|_| "a module that loads modules or evaluates text"));
                file_loader_entries.extend(loaded_by_call.iter().map(|&call| ("a module that loads modules or evaluates text", hir[call].pos, call)));
            }
        }
        let arguments = self.atoms.lookup(b"arguments");
        let named_arguments = hir.exprs.iter().enumerate().filter(|it| arguments.is_some() && matches!(it.1.kind, ExprKind::Ident(name) if Some(name) == arguments)).map(|it| ExprId::from(it.0 as u32));
        for mention in named_arguments.filter(|&mention| module.bound.expr_symbol[mention.idx()].is_none() && module.bound.expr_parent[mention.idx()] != Parent::None) {
            let mut owner = function_around(module, module.bound.expr_parent[mention.idx()]);
            while owner.is_some() && hir[owner].kind == FnKind::Arrow {
                owner = module.bound.fns[owner.idx()].enclosing;
            }
            if owner.is_none() {
                loader_entry = loader_entry.or(Some("require"));
                file_loader_entries.push(("require", hir[mention].pos, mention));
            }
        }
        let mut leaks_global_object = false;
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if is_harmless.contains(&e) || matches!(expr.kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) && is_operand_of_type_query(module, e) {
                continue;
            }
            if matches!(expr.kind, ExprKind::ImportCall { args } if !matches!(hir[hir.id_at(args, 0)].kind, ExprKind::String(_)) && cannot_name_builtin_module(module, self.atoms, hir.id_at(args, 0))) {
                self.file_loader_entry_sites.push((number, e));
                why_open.push(("import() of a path that is computed", e));
            }
            let found = match expr.kind {
                ExprKind::ImportCall { args } if !matches!(hir[hir.id_at(args, 0)].kind, ExprKind::String(_)) && !cannot_name_builtin_module(module, self.atoms, hir.id_at(args, 0)) => Some("import() of a name that is computed"),
                ExprKind::ImportMeta => Some("import.meta"),
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(e) && stays_visible(e) => None,
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(e) => {
                    leaks_global_object = true;
                    Some("the global object")
                }
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => Some("getBuiltinModule"),
                ExprKind::Dot { name, .. } if is(name, b"mainModule") => Some("mainModule"),
                _ => match variable_at(e) {
                    Some(known::require | known::module) if matches!(expr.kind, ExprKind::Ident(_)) && does_not_escape(e) => None,
                    Some(known::require) => Some("require"),
                    Some(known::module) if matches!(expr.kind, ExprKind::Ident(_)) && self.preserves_source_paths => Some("module"),
                    Some(known::eval | known::Function) if !may_strings_become_code() => None,
                    Some(known::eval) => Some("eval"),
                    Some(known::Function) => Some("Function"),
                    Some(name) if is(name, b"Worker") => Some("Worker"),
                    Some(name) if is(name, b"ShadowRealm") => Some("ShadowRealm"),
                    _ => None,
                },
            };
            loader_entry = loader_entry.or(found);
            file_loader_entries.extend(found.map(|loader_entry| (loader_entry, expr.pos, e)));
        }
        why_open.extend(read_via_global_object.iter().filter_map(|&(global, name)| Some((member_that_opens_the_world(self.atoms, global, name)?, ExprId::NONE))));
        self.read.extend(read_via_global_object);
        named_at.extend(named_via_global_object);
        for (kind, name, place) in touched.into_iter().chain(touched_via_global_object) {
            named_at.push((place, Name::member(kind, name)));
            match kind {
                _ if name.is_none() => self.touches_every_member_of[kind] = true,
                GLOBAL_OBJECT => global_names.push(name),
                _ => _ = self.read.insert((kind, name)),
            }
        }
        let is_callee = |e: ExprId| matches!(module.bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) if hir[call].callee == e));
        let taken_off_their_receiver = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Dot { name, .. } if is_one_of(name, &REACH_LISTENERS))).map(|it| ExprId::from(it.0 as u32));
        why_open.extend(taken_off_their_receiver.filter(|&member| !is_callee(member) && !is_under_typeof(member)).map(|member| ("addEventListener of the global object", member)));
        let is_taken_out = |prop: &bun_sema::hir::PatProp| matches!((prop.key, hir[prop.value].kind), (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) if is_one_of(name, &REACH_LISTENERS));
        if hir.pat_props.iter().any(is_taken_out) {
            why_open.push(("addEventListener of the global object", ExprId::NONE));
        }
        listeners.extend(names_via_global_object.iter().filter(|it| is(it.0, b"addEventListener")).filter_map(|it| it.1.some()));
        for listener in listeners {
            let events = match module.bound.expr_parent[listener.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Call(call) if hir[call].callee == listener && !hir[call].args.is_empty() => strings_written_or_held_by_a_constant(module, hir.id_at(hir[call].args, 0)),
                    _ => None,
                },
                _ => None,
            };
            let events: Vec<Atom> = events.into_iter().flatten().collect();
            if events.is_empty() || events.iter().any(|&event| is_one_of(event, &EVENTS_OF_THE_GLOBAL_OBJECT)) {
                why_open.push(("addEventListener of the global object", listener));
            } else {
                self.listeners_of_the_global_object.extend(events.into_iter().map(|event| (number, listener, event)));
            }
        }
        for &(name, member) in &names_via_global_object {
            stored.add_member(module, self.atoms, GLOBAL_OBJECT, name, member);
        }
        for (global, name, member) in members_via_global_object {
            stored.add_member(module, self.atoms, global, name, member);
            why_open.extend((global == 0 && is_deleted(module, member)).then_some(("process", member)));
        }
        for call in hir.calls.iter().filter(|call| call.args.len() >= 2 && is_define_property(call.callee)) {
            let receiver = asserted(hir.id_at(call.args, 0));
            let holder = match hir[receiver].kind {
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(receiver) => GLOBAL_OBJECT,
                _ => match global_at(receiver) {
                    Some(global) if global < 2 => global,
                    Some(global) => {
                        named_at.push((receiver, Name::member(global, Atom::NONE)));
                        self.touches_every_member_of[global] = true;
                        continue;
                    }
                    None => continue,
                },
            };
            let has_only_a_value = call.args.len() == 3
                && matches!(hir[hir.id_at(call.args, 2)].kind, ExprKind::Object(props) if props.iter().all(|prop| matches!(hir[prop].key, PropKey::Name(key) if is_one_of(key, &OF_A_DESCRIPTOR_WITH_A_VALUE))));
            match strings_written_or_held_by_a_constant(module, hir.id_at(call.args, 1)) {
                Some(names) if has_only_a_value => {
                    let ExprKind::Object(props) = hir[hir.id_at(call.args, 2)].kind else { continue };
                    let names: Vec<Atom> = names.collect();
                    for prop in props.iter().map(|prop| &hir[prop]).filter(|prop| matches!(prop.key, PropKey::Name(key) if is(key, b"value"))) {
                        match prop.kind {
                            PropKind::Init | PropKind::Shorthand | PropKind::Method if prop.value.is_some() => names.iter().for_each(|&name| stored.add(module, self.atoms, holder, name, prop.value, receiver)),
                            _ => stored.may_see_the_global.push((holder, receiver)),
                        }
                    }
                }
                _ => why_open.push((why_it_escapes(holder, "an accessor on the global object"), receiver)),
            }
        }
        stored_via_global_object.sort_unstable();
        stored_via_global_object.dedup();
        for (holder, at, value) in stored_via_global_object {
            stored.add_under_any_name(module, self.atoms, holder, at, value);
        }
        self.stored_on_globals.extend(stored.may_see_the_global_if_called.into_iter().map(|(holder, name, at)| (number, at, holder, name)));
        self.called_on_globals.extend(stored.called);
        let stored_for_anybody = stored.may_see_the_global.into_iter().map(|it| (it, STORED_ON_THE_GLOBAL_OBJECT)).chain(stored.may_stand_under_any_name.into_iter().map(|it| (it, STORED_UNDER_ANY_NAME)));
        for ((holder, at), why) in stored_for_anybody {
            if holder < 2 || holder == GLOBAL_OBJECT {
                why_open.push((why_it_escapes(holder, why), at));
            } else {
                named_at.push((at, Name::member(holder, Atom::NONE)));
                self.touches_every_member_of[holder] = true;
            }
        }
        if names_via_global_object.iter().any(|&(name, member)| is(name, b"addEventListener") && member.is_none()) {
            why_open.push(("addEventListener of the global object", ExprId::NONE));
        }
        dispatchers.extend(names_via_global_object.iter().filter(|it| is(it.0, b"dispatchEvent")).map(|it| it.1));
        for dispatcher in dispatchers {
            let event = dispatcher.some().and_then(|dispatcher| match module.bound.expr_parent[dispatcher.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Call(call) if hir[call].callee == dispatcher && hir[call].args.len() == 1 => types_and_class_of_event_made_at(module, self.atoms, &self.global_objects, hir.id_at(hir[call].args, 0)),
                    _ => None,
                },
                _ => None,
            });
            match event {
                Some(events) => self.dispatched.types_and_classes.extend(events),
                None => self.dispatched.may_be_of_any_type = true,
            }
        }
        self.dispatched.names_stored_on_the_global_object.extend(stored.names_stored_on_the_global_object.iter().copied());
        global_names.extend(names_via_global_object.into_iter().map(|read| read.0));
        why_open.extend(file_loader_entries.iter().map(|entry| match (entry.0, entry.2.some().map(|evaluator| use_of_evaluator(module, evaluator))) {
            ("Function", Some(EvaluatorUse::Calls)) => ("a call of Function", entry.2),
            ("eval", Some(EvaluatorUse::Calls)) => ("a call of eval", entry.2),
            _ => (entry.0, entry.2),
        }));
        self.openings.extend(why_open.into_iter().map(|(why, at)| (number, at, why)));
        self.global_names.extend(global_names);
        self.named_at.extend(named_at.into_iter().map(|(place, name)| (number, place, name)));
        self.loader_entry = loader_entry;
        self.loader_entry_sites.extend(file_loader_entries.iter().map(|loader_entry| (number, loader_entry.2)));
        self.file_loader_entry_sites.extend(file_loader_entries.iter().map(|loader_entry| (number, loader_entry.2)));
        self.loader_entries.extend(file_loader_entries.into_iter().take(4).map(|(loader_entry, position, _)| (loader_entry, module.path.text.to_vec(), position)));
        for specifier in named_via_created_requires {
            self.openings.extend(module_that_opens_the_world(self.atoms, specifier).map(|why| (number, ExprId::NONE, why)));
            self.name(specifier);
        }
        self.leaks_global_object |= leaks_global_object;
        self.listens_for_messages |= listens_for_messages;
    }

    fn reads(&self, global: &[u8], property: &[u8]) -> bool {
        let Some(global) = GLOBALS.iter().position(|it| *it.0 == *global) else { return true };
        self.leaks_global_object
            || self.listens_for_messages && global == 0 && property == b"send"
            || self.read.contains(&(global, Atom::NONE))
            || self.touches_every_member_of[global]
            || self.atoms.lookup(property).is_some_and(|property| self.read.contains(&(global, property)))
    }

    fn fires(&self, trigger: &Trigger) -> bool {
        self.reads(&trigger.global, &trigger.property)
    }

    fn fires_on_literal_name(&self, trigger: &Trigger) -> bool {
        let Some(global) = GLOBALS.iter().position(|it| *it.0 == *trigger.global) else { return true };
        self.listens_for_messages && global == 0 && *trigger.property == *b"send"
            || global >= 2 && self.read.contains(&(global, Atom::NONE))
            || self.touches_every_member_of[global]
            || self.atoms.lookup(&trigger.property).is_some_and(|property| self.read.contains(&(global, property)))
    }

    fn loader_entry(&self) -> Option<&'static str> {
        if self.loader_entry.is_some() {
            return self.loader_entry;
        }
        if self.read.contains(&(0, Atom::NONE)) {
            return Some("process");
        }
        (self.read.contains(&(BUN, Atom::NONE)) || self.touches_every_member_of[BUN]).then_some("Bun")
    }
}

fn looked_through<'a, 's>(empty: &(dyn Fn() -> Scan<'a, 's> + Sync), files: &[(u32, &Module<'_>)], in_parallel: crate::InParallel<'_>) -> Scan<'a, 's> {
    const FILES_PER_TASK: usize = 64;
    let slices: Vec<&[(u32, &Module<'_>)]> = files.chunks(FILES_PER_TASK).collect();
    let found: Vec<std::sync::OnceLock<Scan<'a, 's>>> = slices.iter().map(|_| std::sync::OnceLock::new()).collect();
    in_parallel(slices.len(), &|slice| {
        let mut scan = empty();
        for &(number, module) in slices[slice] {
            scan.file(number, module);
        }
        _ = found[slice].set(scan);
    });
    let mut all = empty();
    for later in found.into_iter().flat_map(std::sync::OnceLock::into_inner) {
        all.merge_scan(later);
    }
    all
}

pub(crate) fn find(loaded: &[Option<Box<Module<'_>>>], atoms: &Interner<'_>, is_compiled: &[bool], preserves_source_paths: bool, in_parallel: crate::InParallel<'_>) -> Found {
    let manifest = Archive::embedded().manifest();
    let empty = || Scan::empty(atoms, preserves_source_paths);
    let files: Vec<(u32, &Module<'_>)> = loaded.iter().enumerate().zip(is_compiled).filter(|it| *it.1).filter_map(|it| Some((it.0.0 as u32, it.0.1.as_deref()?))).collect();
    let mut scan = looked_through(&empty, &files, in_parallel);
    add_options_of_servers(&mut scan.named_at, atoms, loaded.len() as u32, &|file| loaded.get(file as usize)?.as_deref());
    let (app, style) = (atoms.lookup(b"app"), atoms.lookup(b"style"));
    let may_bundle_and_run_files = scan.named_at.iter().filter_map(|&(file, place, name)| match name {
        Name::ServeOption(option) | Name::ServeRouteOption(option) if option.is_none() => Some((file, place, OPTIONS_OF_A_SERVER_THAT_ARE_NOT_SEEN)),
        Name::ServeOption(option) if Some(option) == app => Some((file, place, APP_OF_A_SERVER)),
        Name::ServeRouteOption(option) if Some(option) == style => Some((file, place, STYLE_OF_A_ROUTE)),
        _ => None,
    });
    let may_bundle_and_run_files: Vec<(u32, ExprId, &'static str)> = may_bundle_and_run_files.collect();
    scan.openings.extend(may_bundle_and_run_files);
    let mut program_roots: Vec<u32> = Vec::new();
    let mut roots_without_loader_entries: Vec<u32> = Vec::new();
    let mut why: FxHashMap<u32, InclusionReason> = FxHashMap::default();
    let mut add = |id: u32, reason: InclusionReason| {
        if reason != InclusionReason::Always {
            program_roots.push(id);
        }
        if !matches!(reason, InclusionReason::Always | InclusionReason::AnyName(_)) {
            roots_without_loader_entries.push(id);
        }
        why.entry(id).or_insert(reason);
    };
    for &id in manifest.always_included() {
        add(id, InclusionReason::Always);
    }
    let mut native: Vec<(Vec<u8>, Option<u32>)> = Vec::new();
    for &specifier in &scan.named {
        let text = atoms.bytes(specifier);
        if bun_resolve_builtins::expose_internals_enabled()
            && let Some(rest) = text.strip_prefix(b"internal/")
            && let Some(id) = manifest.module_for_loader(&[b"internal:", rest].concat())
        {
            add(id, InclusionReason::Named(text.to_vec()));
            continue;
        }
        let Some(alias) = Alias::get(text, bun_ast::Target::Bun, Cfg::default()) else { continue };
        match manifest.module_for_loader(alias.path.as_bytes()) {
            Some(id) => add(id, InclusionReason::Named(text.to_vec())),
            None => native.push((alias.path.as_bytes().to_vec(), manifest.modules().iter().find(|module| *module.name == *alias.path.as_bytes()).map(|module| module.id))),
        }
    }
    for trigger in manifest.triggers().iter().filter(|trigger| scan.fires(trigger)) {
        let behind = scan.loader_entry().filter(|_| !scan.fires_on_literal_name(trigger));
        for &id in &trigger.modules {
            add(id, behind.map_or_else(|| InclusionReason::Trigger([&trigger.global[..], b".", &trigger.property].concat()), InclusionReason::AnyName));
        }
    }
    if let Some(loader_entry) = scan.loader_entry() {
        for module in manifest.modules().iter().filter(|module| !module.path.is_empty()) {
            if module.name.starts_with(b"internal:") && !bun_resolve_builtins::expose_internals_enabled() {
                continue;
            }
            add(module.id, InclusionReason::AnyName(loader_entry));
        }
    }
    let without_loader_entries: FxHashMap<u32, Reason> = manifest.closure(&roots_without_loader_entries, manifest.always_included()).into_iter().collect();
    let mut included: Vec<Included> = Vec::new();
    for (id, reason) in manifest.closure(&program_roots, manifest.always_included()) {
        let Some(module) = manifest.module(id) else { continue };
        if module.path.is_empty() {
            native.push((module.name.to_vec(), Some(id)));
            continue;
        }
        let is_read_by_dynamic_name = matches!(why.get(&id), Some(InclusionReason::AnyName(_)));
        let waits_to_be_named = !preserves_source_paths && !roots_without_loader_entries.contains(&id) && manifest.waits_to_be_named(bun_builtin_syntax::MODULE_ROOT | id);
        let loaded_by = match (without_loader_entries.get(&id), reason) {
            (Some(Reason::Root), _) if waits_to_be_named && scan.loader_entry().is_none() => LoadedBy::RuntimeModulesOnly,
            (Some(Reason::Root), _) if waits_to_be_named => LoadedBy::RuntimeModulesOrComputedName,
            (Some(Reason::Root), _) => LoadedBy::NativeCodeOrLiteralName,
            (Some(Reason::RequiredBy(_)), _) if is_read_by_dynamic_name => LoadedBy::RuntimeModulesOrComputedName,
            (Some(Reason::RequiredBy(_)), _) => LoadedBy::RuntimeModulesOnly,
            (None, Reason::Root) => LoadedBy::ComputedName,
            (None, Reason::RequiredBy(_)) => LoadedBy::RuntimeModulesBehindLoader,
        };
        let why = match reason {
            Reason::Root => why[&id].clone(),
            Reason::RequiredBy(by) => InclusionReason::RequiredBy(by),
        };
        included.push(Included { id, why, loaded_by });
    }
    native.sort_unstable();
    native.dedup();
    let may_be_sloppy = files.iter().filter(|file| file.1.is_commonjs() || file.1.hir.is_js);
    let mut runtime_use = RuntimeUse { files_that_may_be_sloppy: may_be_sloppy.map(|file| file.1.path.text.to_vec()).collect(), ..Default::default() };
    runtime_use.runs_in_place = preserves_source_paths;
    runtime_use.paths_as_written = files.iter().map(|file| &file.1.path).filter(|path| path.pretty != path.text).map(|path| (path.text.to_vec(), path.pretty.to_vec())).collect();
    runtime_use.listeners_of_the_global_object = scan.listeners_of_the_global_object.iter().filter_map(|&(number, at, event)| Some((loaded[number as usize].as_deref()?.path.text.to_vec(), at, event))).collect();
    runtime_use.dispatched = scan.dispatched.clone();
    runtime_use.openings = scan.openings.iter().filter_map(|&(number, at, why)| Some((loaded[number as usize].as_deref()?.path.text.to_vec(), at, why))).collect();
    runtime_use.open_for(runtime_use.openings.iter().map(|opening| (opening.2, opening.0.clone())).collect());
    runtime_use.stored_on_globals = scan.stored_on_globals.iter().filter_map(|&(number, at, holder, name)| Some((loaded[number as usize].as_deref()?.path.text.to_vec(), at, holder, name))).collect();
    runtime_use.called_on_globals.clone_from(&scan.called_on_globals);
    runtime_use.facts.extend(native.iter().map(|module| [b"native ", &module.0[..]].concat()));
    runtime_use.add_names_of(&scan);
    for of_file in scan.named_at.chunk_by(|one, next| one.0 == next.0) {
        let Some(module) = loaded[of_file[0].0 as usize].as_deref() else { continue };
        runtime_use.named_at.push((module.path.text.to_vec(), of_file.iter().map(|named| (named.1, named.2)).collect()));
    }
    let loader_entry_sites = if scan.has_unlocated_loader_entry { Vec::new() } else { scan.loader_entry_sites };
    Found { included, native, loader_entries: scan.loader_entries, loader_entry_sites, file_loader_entry_sites: scan.file_loader_entry_sites, runtime_use, interner: atoms.number() }
}

pub(crate) fn add_what_the_loaded_program_shows(found: &mut Found, program: &Program, in_parallel: crate::InParallel<'_>) {
    let (atoms, modules) = (&program.files.atoms, &program.files.modules);
    assert!(atoms.sees_atoms_of(found.interner), "the names were found in another program");
    found.interner = atoms.number();
    let empty = || Scan::empty(atoms, false);
    let is_reached_without_loader_entries = |module: &Module<'_>| match module.builtin {
        Some(Builtin::Module(_, loaded_by)) => !matches!(loaded_by, LoadedBy::ComputedName | LoadedBy::RuntimeModulesBehindLoader),
        Some(Builtin::Functions) => true,
        None => false,
    };
    let runtime_sources: Vec<(u32, &Module<'_>)> = modules.iter().enumerate().filter(|it| is_reached_without_loader_entries(it.1)).map(|it| (it.0 as u32, &**it.1)).collect();
    let scanned: Vec<std::sync::OnceLock<RuntimeSource>> = runtime_sources.iter().map(|_| std::sync::OnceLock::new()).collect();
    in_parallel(runtime_sources.len(), &|index| {
        let (number, module) = runtime_sources[index];
        let mut scan = empty();
        scan.file(number, module);
        add_options_of_servers(&mut scan.named_at, atoms, 0, &|file| (file == number).then_some(module));
        let mut of_source = RuntimeUse::default();
        of_source.add_names_of(&scan);
        let named = match module.builtin {
            Some(Builtin::Module(id, _)) => Archive::embedded().manifest().module(id),
            _ => None,
        };
        let name_of_module = named.map(|named| [b"module ", &*named.name].concat());
        of_source.facts.extend(name_of_module.clone());
        let escapes = scan.openings.iter().filter(|opening| ESCAPES.iter().any(|escape| escape.0 == opening.2)).map(|opening| (opening.1, opening.2)).collect();
        let named_at = scan.named_at.iter().map(|named| (named.1, named.2)).collect();
        _ = scanned[index].set(RuntimeSource { path: module.path.text.to_vec(), module: name_of_module, facts: of_source.facts, named_at, escapes, called_on_globals: scan.called_on_globals, dispatched: scan.dispatched });
    });
    found.runtime_use.runtime_sources = scanned.into_iter().filter_map(std::sync::OnceLock::into_inner).collect();
    let files_named_in_before = found.runtime_use.named_at.len();

    let checker = program.checker();
    let context = empty();
    let mut names: Vec<Atom> = Vec::new();
    let mut read: Vec<(usize, Atom)> = Vec::new();
    let mut touches_every_member_of = [false; GLOBALS.len() + 1];
    for path in std::mem::take(&mut found.runtime_use.files_that_may_be_sloppy) {
        let Some(file) = program.files.by_path.get(&path) else { continue };
        let module = program.files.module(file);
        let (hir, bound) = (&module.hir, &module.bound);
        let mut is_sloppy: FxHashMap<FnId, bool> = FxHashMap::default();
        let mut named_through_this: Vec<(ExprId, Name)> = Vec::new();
        for (index, written) in hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::This | ExprKind::Super)) {
            let this = ExprId::from(index as u32);
            let mut owner = checker.enclosing_fn_of_expr(file, this).unwrap_or(FnId::NONE);
            while owner.is_some() && hir[owner].kind == FnKind::Arrow {
                owner = bound.fns[owner.idx()].enclosing;
            }
            if owner.is_none() || !*is_sloppy.entry(owner).or_insert_with(|| checker.is_sloppy_function(file, owner)) {
                continue;
            }
            let read_through_this = if matches!(written.kind, ExprKind::This) { reads_of_global_object(module, atoms, &context.global_objects, &context.globals, context.get_builtin_module, this) } else { None };
            match read_through_this {
                Some((names_of_this, members_of_hosts, touched_through_this, stored_under_any_name)) => {
                    let read_of_this: Vec<(usize, Atom)> = members_of_hosts.iter().map(|&(global, name, _)| (global, name)).collect();
                    named_through_this.extend(names_of_this.iter().map(|&(name, member)| (member.some().unwrap_or(this), Name::member(GLOBAL_OBJECT, name))));
                    let reflecting = names_of_this.iter().filter(|it| matches!(atoms.bytes(it.0), b"Reflect" | b"Object"));
                    named_through_this.extend(reflecting.flat_map(|&(_, member)| [Name::Property(Atom::NONE), Name::ConstructorOfFunctions].map(|name| (member.some().unwrap_or(this), name))));
                    named_through_this.extend(read_of_this.iter().chain(&touched_through_this).map(|&(kind, name)| (this, Name::member(kind, name))));
                    let mut stored = StoredOnGlobals::default();
                    for &(name, member) in &names_of_this {
                        stored.add_member(module, atoms, GLOBAL_OBJECT, name, member);
                    }
                    for (global, name, member) in members_of_hosts {
                        stored.add_member(module, atoms, global, name, member);
                        found.runtime_use.openings.extend((global == 0 && is_deleted(module, member)).then(|| (path.clone(), member, "process")));
                    }
                    for (holder, at, value) in stored_under_any_name {
                        stored.add_under_any_name(module, atoms, holder, at, value);
                    }
                    found.runtime_use.openings.extend(stored.may_see_the_global.into_iter().map(|it| (path.clone(), it.1, why_it_escapes(it.0, STORED_ON_THE_GLOBAL_OBJECT))));
                    found.runtime_use.openings.extend(stored.may_stand_under_any_name.into_iter().map(|it| (path.clone(), it.1, why_it_escapes(it.0, STORED_UNDER_ANY_NAME))));
                    found.runtime_use.stored_on_globals.extend(stored.may_see_the_global_if_called.into_iter().map(|(holder, name, at)| (path.clone(), at, holder, name)));
                    found.runtime_use.called_on_globals.extend(stored.called);
                    found.runtime_use.dispatched.names_stored_on_the_global_object.extend(stored.names_stored_on_the_global_object);
                    found.runtime_use.dispatched.may_be_of_any_type |= names_of_this.iter().any(|it| atoms.bytes(it.0) == b"dispatchEvent");
                    names.extend(names_of_this.into_iter().map(|read| read.0));
                    found.runtime_use.openings.extend(read_of_this.iter().filter_map(|&(global, name)| Some((path.clone(), this, member_that_opens_the_world(atoms, global, name)?))));
                    read.extend(read_of_this);
                    for (kind, name) in touched_through_this {
                        match kind {
                            _ if name.is_none() => touches_every_member_of[kind] = true,
                            GLOBAL_OBJECT => names.push(name),
                            _ => read.push((kind, name)),
                        }
                    }
                }
                None => found.runtime_use.openings.push((path.clone(), this, "this in a function that is not strict")),
            }
        }
        if !named_through_this.is_empty() {
            found.runtime_use.named_at.push((path, named_through_this));
        }
    }
    let mut of_this = empty();
    of_this.global_names.extend(names);
    of_this.read.extend(read);
    of_this.touches_every_member_of = touches_every_member_of;
    found.runtime_use.add_names_of(&of_this);
    for (path, named_through_this) in &mut found.runtime_use.named_at[files_named_in_before..] {
        let serving: Vec<ExprId> = named_through_this.iter().filter(|named| matches!(named.1, Name::Member(1, name) if name.is_some() && atoms.bytes(name) == b"serve")).map(|named| named.0).collect();
        found.runtime_use.openings.extend(serving.iter().map(|&this| (path.clone(), this, OPTIONS_OF_A_SERVER_THAT_ARE_NOT_SEEN)));
        found.runtime_use.facts.extend(serving.first().into_iter().flat_map(|_| ANY_OPTION_OF_A_SERVER).map(|name| name.fact(atoms)));
        named_through_this.extend(serving.into_iter().flat_map(|this| ANY_OPTION_OF_A_SERVER.map(|name| (this, name))));
    }
    for dispatched in found.runtime_use.runtime_sources.iter().map(|source| source.dispatched.clone()).collect::<Vec<Dispatched>>() {
        found.runtime_use.dispatched.add(dispatched);
    }
    for (path, at, event) in std::mem::take(&mut found.runtime_use.listeners_of_the_global_object) {
        if found.runtime_use.dispatched.may_be_of_type(event) {
            found.runtime_use.openings.push((path, at, "addEventListener and dispatchEvent of the global object"));
        }
    }
    let called_by_the_runtime: Vec<(usize, Atom)> = found.runtime_use.runtime_sources.iter().flat_map(|source| source.called_on_globals.iter().copied()).collect();
    found.runtime_use.called_on_globals.extend(called_by_the_runtime);
    for (path, at, holder, name) in std::mem::take(&mut found.runtime_use.stored_on_globals) {
        if !found.runtime_use.called_on_globals.contains(&(holder, name)) {
            continue;
        }
        if holder < 2 || holder == GLOBAL_OBJECT {
            found.runtime_use.openings.push((path, at, why_it_escapes(holder, STORED_ON_THE_GLOBAL_OBJECT)));
        } else {
            found.runtime_use.facts.push([GLOBALS[holder].0, b" *"].concat());
            found.runtime_use.named_at.push((path, vec![(at, Name::member(holder, Atom::NONE))]));
        }
    }

    let reasons = found.runtime_use.openings.iter().map(|opening| (opening.2, opening.0.clone())).collect();
    found.runtime_use.open_for(reasons);
    release_roots(&found.runtime_use, program);
}

const KINDS_SAID_BEFORE_THE_LINK: [&[u8]; 2] = [b"native", b"loader"];

fn release_roots(runtime_use: &RuntimeUse, program: &Program) {
    if runtime_use.runs_in_place {
        return;
    }
    let (atoms, files) = (&program.files.atoms, &program.files);
    let mut made_for: FxHashMap<&[u8], Vec<u32>> = FxHashMap::default();
    for (root, facts) in Archive::embedded().manifest().roots_made_for() {
        for fact in facts {
            made_for.entry(&fact[..]).or_default().push(root);
            let kind = bun_core::strings::split(fact, b" ").next().unwrap_or(fact);
            made_for.entry(kind).or_default().push(root);
        }
    }
    let roots_of = |named_at: &[(ExprId, Name)]| -> Vec<(ExprId, u32, bool)> {
        let mut found = Vec::new();
        for &(place, name) in named_at.iter().filter(|it| !matches!(it.1, Name::Native(..) | Name::Property(_))) {
            let fact = name.fact(atoms);
            let roots = made_for.get(fact.strip_suffix(b" *").unwrap_or(&fact));
            found.extend(roots.into_iter().flatten().map(|&root| (place, root, name == Name::PrintsArguments)));
        }
        found
    };
    let named_anywhere = runtime_use.named_at.iter().flat_map(|of_file| &of_file.1).chain(runtime_use.runtime_sources.iter().flat_map(|source| &source.named_at));
    let mut said_before_the_link: FxHashSet<Vec<u8>> = named_anywhere.map(|named| named.1.fact(atoms)).collect();
    said_before_the_link.extend(runtime_use.facts.iter().cloned());
    let is_surely_absent = |fact: &[u8]| !bun_core::strings::contains(fact, b" & ") && KINDS_SAID_BEFORE_THE_LINK.contains(&bun_core::strings::split(fact, b" ").next().unwrap_or(fact)) && !is_among(&said_before_the_link, fact);
    let mut released: FxHashMap<FileId, Vec<ReleasedRoot>> = FxHashMap::default();
    let mut release = |path: &[u8], places: Vec<(ExprId, u32, bool)>| {
        let Some(file) = files.by_path.get(path) else { return };
        let module = files.module(file);
        for (place, root, only_if_holder_may_print_an_object) in places.into_iter().filter(|it| it.0.is_none() || files.enclosing_dead_range_start(file, module.hir[it.0].pos).is_none()) {
            let holder = place.some().map_or(FnId::NONE, |place| function_around(module, module.bound.expr_parent[place.idx()]));
            released.entry(file).or_default().push(ReleasedRoot { holder, root, only_if_holder_may_print_an_object });
        }
    };
    for (path, named_at) in &runtime_use.named_at {
        release(path, roots_of(named_at));
    }
    for source in &runtime_use.runtime_sources {
        let module = files.by_path.get(&source.path).map(|file| files.module(file));
        let never_counts = |named: &&(ExprId, Name)| module.and_then(|module| what_it_stands_for(atoms, module, function_at(module, named.0), named.1)).is_some_and(|facts| facts.iter().all(|fact| is_surely_absent(fact)));
        let named_at: Vec<(ExprId, Name)> = source.named_at.iter().filter(|named| !never_counts(named)).copied().collect();
        let mut places = roots_of(&named_at);
        let never_counts = |escape: &&(ExprId, &'static str)| module.and_then(|module| what_it_stands_for(atoms, module, function_at(module, escape.0), every_member_of(escape.1))).is_some_and(|facts| facts.is_empty());
        places.extend(source.escapes.iter().filter(|escape| !never_counts(escape)).map(|escape| (escape.0, EVERY_ROOT, false)));
        places.extend(source.module.iter().filter_map(|module| made_for.get(&module[..])).flatten().map(|&root| (ExprId::NONE, root, false)));
        release(&source.path, places);
    }
    for opening in &runtime_use.openings {
        release(&opening.0, vec![(opening.1, EVERY_ROOT, false)]);
    }
    for (file, mut released) in released {
        released.sort_unstable_by_key(|it| (it.holder.idx(), it.root, it.only_if_holder_may_print_an_object));
        released.dedup();
        _ = files.module(file).roots_released.set(program.session.arena().alloc_slice_copy(&released));
    }
    program.releases_roots.store(true, std::sync::atomic::Ordering::Relaxed);
}

fn outermost_function_at(module: &Module<'_>, pos: u32) -> FnId {
    let (hir, bound) = (&module.hir, &module.bound);
    let holds = |function: &bun_sema::bind::FnInfo| match function.owner {
        FnOwner::Stmt(owner) => function.enclosing.is_none() && (hir[owner].start..hir[owner].loc.end).contains(&pos),
        _ => false,
    };
    bound.fns.iter().position(holds).map_or(FnId::NONE, |function| FnId::from(function as u32))
}

fn is_among(facts: &FxHashSet<Vec<u8>>, all_of: &[u8]) -> bool {
    bun_core::strings::split(all_of, b" & ").all(|fact| {
        let kind = bun_core::strings::split(fact, b" ").next().unwrap_or(fact);
        facts.contains(fact) || facts.contains(&[kind, b" *"].concat())
    })
}

fn what_it_stands_for(atoms: &Interner<'_>, module: &Module<'_>, mut function: FnId, name: Name) -> Option<&'static [Box<[u8]>]> {
    let manifest = Archive::embedded().manifest();
    match module.builtin {
        Some(Builtin::Functions) if function.is_some() => {
            while let Some(outer) = module.bound.fns[function.idx()].enclosing.some() {
                function = outer;
            }
            let written = Some(module.hir[function].name).filter(|written| written.is_some())?;
            manifest.on_behalf_of(manifest.builtin_function_id(module.file_name(), atoms.bytes(written))?, &name.fact(atoms))
        }
        Some(Builtin::Module(id, _)) => manifest.on_behalf_of(bun_builtin_syntax::MODULE_ROOT | id, &name.fact(atoms)),
        _ => None,
    }
}

fn function_at(module: &Module<'_>, place: ExprId) -> FnId {
    place.some().map_or(FnId::NONE, |place| function_around(module, module.bound.expr_parent[place.idx()]))
}

fn every_member_of(escaping: &str) -> Name {
    Name::member(GLOBALS.iter().position(|global| global.0 == escaping.as_bytes()).unwrap_or(GLOBAL_OBJECT), Atom::NONE)
}

#[derive(Default)]
struct Counted {
    names: FxHashSet<Name>,
    reading_any_property: Vec<FileId>,
    finding_the_constructor_of_functions: Vec<FileId>,
    on_behalf_of: Vec<(&'static [Box<[u8]>], Name, FileId)>,
    properties_folded_to_new_texts: Vec<(Vec<u8>, bool)>,
}

impl Counted {
    fn is_known(&self, name: Name, file: FileId) -> bool {
        match name {
            Name::Property(key) if key.is_none() => self.reading_any_property.last() == Some(&file),
            Name::ConstructorOfFunctions => self.finding_the_constructor_of_functions.last() == Some(&file),
            _ => self.names.contains(&name),
        }
    }

    fn add(&mut self, atoms: &Interner<'_>, module: &Module<'_>, file: FileId, function: FnId, name: Name) {
        let stands_for = what_it_stands_for(atoms, module, function, name);
        if name == Name::ConstructorOfFunctions && module.path.text.ends_with(HELPERS_OF_THE_BUNDLER) {
            return;
        }
        match stands_for {
            Some(stands_for) => self.on_behalf_of.push((stands_for, name, file)),
            None if name == Name::Property(Atom::NONE) => self.reading_any_property.push(file),
            None if name == Name::ConstructorOfFunctions => self.finding_the_constructor_of_functions.push(file),
            None => _ = self.names.insert(name),
        }
    }
}

const MAY_MAKE_A_REGEXP_FROM_TEXT: [&[u8]; 2] = [b"global *", b"program-symbol *"];

pub(crate) fn keep_what_the_compiled_program_reaches(found: &mut Found, program: &Program, in_parallel: crate::InParallel<'_>) {
    assert!(program.files.atoms.number() == found.interner, "the names were found in another program");
    let (atoms, files, runtime_use) = (&program.files.atoms, &program.files, &mut found.runtime_use);
    runtime_use.uncompiled_runtime_sources = program.uncompiled_runtime_sources.lock().iter().map(|&file| files.module(file).path.text.to_vec()).collect();
    let never_taken = &arms_that_commonjs_entry_points_never_take(program)[..];
    let reached_in = |path: &[u8]| {
        let file = files.by_path.get(path);
        move |place: ExprId| file.is_none_or(|file| is_in_compiled_program(program, never_taken, file, place))
    };
    let reached = runtime_use.openings.iter().filter(|opening| reached_in(&opening.0)(opening.1)).map(|opening| (opening.2, opening.0.clone())).collect();
    runtime_use.open_for(reached);
    if !files.modules.iter().any(|module| module.compiled_functions.get().is_some()) {
        return;
    }
    let mut counted = Counted::default();
    let mut reading_what_process_may_inherit: Vec<&[u8]> = Vec::new();
    for (path, named_at) in &runtime_use.named_at {
        let (is_reached, file) = (reached_in(path), files.by_path.get(path));
        let may_print_an_object = program.may_print_an_object.load(std::sync::atomic::Ordering::Relaxed);
        for name in named_at.iter().filter(|it| is_reached(it.0)).map(|it| it.1).filter(|&name| name != Name::PrintsArguments || may_print_an_object) {
            if matches!(name, Name::Member(0, member) if member.is_some() && member != known::default && !is_member_of(b"process", atoms.bytes(member))) {
                reading_what_process_may_inherit.push(path);
            }
            if let Name::Symbol(key) = name
                && !bun_core::strings::contains(path, PRELUDE_DIRECTORY)
            {
                counted.names.insert(Name::SymbolNamedByProgram(key));
            }
            match file {
                Some(file) if name == Name::Property(Atom::NONE) => counted.reading_any_property.push(file),
                Some(file) if name == Name::ConstructorOfFunctions => counted.finding_the_constructor_of_functions.push(file),
                _ => _ = counted.names.insert(name),
            }
        }
    }
    let mut escapes_that_wait = Vec::new();
    let is_a_loader_entry_reached = !runtime_use.why_open.is_empty();
    for (index, source) in runtime_use.runtime_sources.iter_mut().enumerate() {
        let is_reached = reached_in(&source.path);
        source.escapes.retain(|escape| is_reached(escape.0));
        if let Some(file) = files.by_path.get(&source.path) {
            let module = files.module(file);
            for &(place, name) in source.named_at.iter().filter(|it| is_reached(it.0)) {
                counted.add(atoms, module, file, function_at(module, place), name);
            }
            source.escapes.retain(|&escape| {
                let (function, name) = (function_at(module, escape.0), every_member_of(escape.1));
                let Some(stands_for) = what_it_stands_for(atoms, module, function, name) else { return true };
                counted.add(atoms, module, file, function, name);
                escapes_that_wait.push((index, escape, stands_for));
                false
            });
        }
        source.facts = source.module.iter().filter(|_| is_reached(ExprId::NONE)).cloned().collect();
        let is_loaded_by_program = files.by_path.get(&source.path).is_some_and(|file| match files.module(file).builtin {
            Some(Builtin::Module(_, LoadedBy::RuntimeModulesOnly | LoadedBy::RuntimeModulesBehindLoader)) => false,
            Some(Builtin::Module(_, LoadedBy::ComputedName | LoadedBy::RuntimeModulesOrComputedName)) => is_a_loader_entry_reached,
            _ => true,
        });
        if is_loaded_by_program {
            let named: Vec<Vec<u8>> = source.facts.iter().map(|module| [b"program-", &module[..]].concat()).collect();
            source.facts.extend(named);
        }
    }
    let is_scanned = |module: &Module<'_>| module.compiled_functions.get().is_some() && !matches!(module.builtin, Some(Builtin::Module(_, LoadedBy::ComputedName | LoadedBy::RuntimeModulesBehindLoader)));
    let scanned: Vec<FileId> = (0..files.modules.len()).filter(|&file| is_scanned(&files.modules[file])).map(|file| FileId(file as u32)).collect();
    const FILES_PER_TASK: usize = 64;
    let slices: Vec<&[FileId]> = scanned.chunks(FILES_PER_TASK).collect();
    let mut walked = bun_threading::Guarded::new(counted);
    let reflection = Reflection::new(atoms);
    let regexp = atoms.lookup(b"RegExp");
    let (symbol, registers_symbols) = (atoms.lookup(b"Symbol"), atoms.lookup(b"for"));
    let keys_of_methods_that_copy_their_receiver_from_its_text = [atoms.lookup(b"matchAll"), atoms.lookup(b"split")];
    in_parallel(slices.len(), &|slice| {
        let mut of_slice = Counted::default();
        let mut names: Vec<Atom> = Vec::new();
        let checker = std::cell::RefCell::new(program.checker());
        let folded_to_new_texts = std::cell::RefCell::new(Vec::new());
        for &file in slices[slice] {
            let module = files.module(file);
            let (hir, properties) = (&module.hir, Properties { module, file, checker: &checker, folded_to_new_texts: &folded_to_new_texts, reflection });
            let is_private = |name: Atom| module.builtin.is_some() && name.is_some() && atoms.bytes(name).starts_with(b"$");
            let is_of_program = module.builtin.is_none() && !bun_core::strings::contains(module.path.text, PRELUDE_DIRECTORY);
            let add = |of_slice: &mut Counted, name: Name, parent: Parent, pos: u32| {
                if !of_slice.is_known(name, file) && is_child_in_compiled_program(program, never_taken, file, parent, pos) {
                    of_slice.add(atoms, module, file, function_around(module, parent), name);
                }
            };
            let add_property = |of_slice: &mut Counted, name: Atom, parent: Parent, pos: u32| {
                add(of_slice, Name::Property(name), parent, pos);
                if is_of_program && name.is_some() {
                    add(of_slice, Name::PropertyReadByProgram(name), parent, pos);
                }
            };
            let add_new_texts = |of_slice: &mut Counted, parent: Parent, pos: u32| {
                let mut texts = folded_to_new_texts.borrow_mut();
                if !texts.is_empty() && is_child_in_compiled_program(program, never_taken, file, parent, pos) {
                    of_slice.properties_folded_to_new_texts.extend(texts.drain(..).map(|text| (text, is_of_program)));
                }
                texts.clear();
            };
            for (index, expr) in hir.exprs.iter().enumerate().filter(|it| module.bound.expr_parent[it.0] != Parent::None) {
                let (e, parent) = (ExprId::from(index as u32), module.bound.expr_parent[index]);
                if let ExprKind::Ident(name) = expr.kind
                    && !of_slice.names.contains(&Name::member(GLOBAL_OBJECT, name))
                    && names_global(module, atoms, e, name)
                    && !is_operand_of_type_query(module, e)
                {
                    add(&mut of_slice, Name::member(GLOBAL_OBJECT, name), parent, expr.pos);
                }
                match expr.kind {
                    ExprKind::Regex => {
                        add(&mut of_slice, Name::Syntax("regexp-literal"), parent, expr.pos);
                        if has_property_escape(&hir.text[expr.pos as usize..expr.end as usize]) {
                            add(&mut of_slice, Name::Regexp("property-escape"), parent, expr.pos);
                        }
                    }
                    ExprKind::Ident(name) | ExprKind::Dot { name, .. } if Some(name) == regexp && (matches!(expr.kind, ExprKind::Dot { .. }) || names_global(module, atoms, e, name)) => match properties.pattern_of_regexp_made_at(e) {
                        PatternOfRegexp::WithoutPropertyEscape => {}
                        PatternOfRegexp::WithPropertyEscape => add(&mut of_slice, Name::Regexp("property-escape"), parent, expr.pos),
                        PatternOfRegexp::NotSeen => add(&mut of_slice, Name::Regexp("computed"), parent, expr.pos),
                    },
                    ExprKind::BigInt(_) => add(&mut of_slice, Name::Syntax("bigint-literal"), parent, expr.pos),
                    _ => {}
                }
                let is_read_from_symbol = matches!(expr.kind, ExprKind::Dot { obj, .. } if matches!(hir[obj].kind, ExprKind::Ident(holder) if Some(holder) == symbol) && is_free(module, obj));
                let member_of_symbol = match expr.kind {
                    ExprKind::Dot { name, .. } if is_read_from_symbol => Some(name),
                    ExprKind::Index { obj, index, .. } if matches!(hir[obj].kind, ExprKind::Ident(holder) if Some(holder) == symbol) && is_free(module, obj) => Some(properties.constant_key(index).unwrap_or(Atom::NONE)),
                    _ => None,
                };
                if is_of_program && member_of_symbol.is_some_and(|name| name.is_none() || keys_of_methods_that_copy_their_receiver_from_its_text.contains(&Some(name))) {
                    add(&mut of_slice, Name::Regexp("computed"), parent, expr.pos);
                }
                if is_of_program && !is_read_from_symbol && matches!(expr.kind, ExprKind::Dot { name, .. } if Some(name) == registers_symbols) {
                    add(&mut of_slice, Name::SymbolNamedByProgram(Atom::NONE), parent, expr.pos);
                }
                if matches!(expr.kind, ExprKind::Dot { name, .. } if !reflection.is_name_of_function(name) && of_slice.names.contains(&if is_of_program { Name::PropertyReadByProgram(name) } else { Name::Property(name) })) {
                    continue;
                }
                let mut hands_out_values = false;
                properties.named_by(e, &mut names, &mut hands_out_values);
                if is_of_program && !is_read_from_symbol && registers_symbols.is_some_and(|name| names.contains(&name)) {
                    add(&mut of_slice, Name::SymbolNamedByProgram(Atom::NONE), parent, expr.pos);
                }
                add_new_texts(&mut of_slice, parent, expr.pos);
                if !matches!(expr.kind, ExprKind::Dot { .. }) && regexp.is_some_and(|regexp| names.contains(&regexp)) {
                    add(&mut of_slice, Name::Regexp("computed"), parent, expr.pos);
                }
                if hands_out_values && names.iter().any(|&name| name.is_none() || atoms.bytes(name) == b"constructor" || reflection.hands_out_descriptors(name)) {
                    add(&mut of_slice, Name::ConstructorOfFunctions, parent, expr.pos);
                }
                for name in names.drain(..).filter(|&name| !is_private(name)) {
                    add_property(&mut of_slice, name, parent, expr.pos);
                }
            }
            for imported in hir.imports.iter().filter(|import| !import.type_only).flat_map(|import| import.named.iter()).map(|spec| &hir[spec]).filter(|spec| !spec.type_only) {
                add_property(&mut of_slice, imported.imported, Parent::File, 0);
            }
            for (index, prop) in hir.pat_props.iter().enumerate().filter(|it| !it.1.is_rest) {
                let name = match (prop.key, hir[prop.value].kind) {
                    (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => Some(name),
                    (PropKey::Computed(key), _) => properties.constant_key(key),
                    _ => None,
                };
                add_new_texts(&mut of_slice, Parent::PatKey(bun_sema::hir::PatPropId::from(index as u32)), prop.pos);
                if name.is_some() && name == regexp {
                    add(&mut of_slice, Name::Regexp("computed"), Parent::PatKey(bun_sema::hir::PatPropId::from(index as u32)), prop.pos);
                }
                if let Some(name) = name.filter(|&name| !is_private(name)) {
                    add_property(&mut of_slice, name, Parent::PatKey(bun_sema::hir::PatPropId::from(index as u32)), prop.pos);
                    if is_of_program && Some(name) == registers_symbols {
                        add(&mut of_slice, Name::SymbolNamedByProgram(Atom::NONE), Parent::PatKey(bun_sema::hir::PatPropId::from(index as u32)), prop.pos);
                    }
                    if name == reflection.lookup_getter || name == reflection.lookup_setter {
                        add_property(&mut of_slice, Atom::NONE, Parent::PatKey(bun_sema::hir::PatPropId::from(index as u32)), prop.pos);
                    }
                }
            }
            if is_of_program {
                let defined = properties.keys_defined(atoms);
                of_slice.names.extend(defined.on_what_exists.iter().filter(|name| name.is_some()).map(|&name| Name::Property(name)));
                of_slice.names.extend(defined.on_what_exists.into_iter().map(Name::KeyDefinedByProgram));
                of_slice.names.extend(defined.has_traps.then_some(Name::SymbolNamedByProgram(Atom::NONE)));
                folded_to_new_texts.borrow_mut().clear();
            }
        }
        let mut counted = walked.lock();
        counted.names.extend(of_slice.names);
        counted.reading_any_property.extend(of_slice.reading_any_property);
        counted.finding_the_constructor_of_functions.extend(of_slice.finding_the_constructor_of_functions);
        counted.on_behalf_of.extend(of_slice.on_behalf_of);
        counted.properties_folded_to_new_texts.extend(of_slice.properties_folded_to_new_texts);
    });
    let mut counted = core::mem::take(walked.get_mut());
    for &(file, pos) in program.reads_of_any_property.lock().iter() {
        let module = files.module(file);
        counted.add(atoms, module, file, outermost_function_at(module, pos), Name::Property(Atom::NONE));
    }
    if program.hands_on_what_a_table_in_sight_finds.load(std::sync::atomic::Ordering::Relaxed) {
        counted.names.insert(Name::KeyDefinedByProgram(Atom::NONE));
    }
    for &(file, pos) in program.reads_that_may_find_the_constructor_of_functions.lock().iter() {
        let module = files.module(file);
        counted.add(atoms, module, file, outermost_function_at(module, pos), Name::ConstructorOfFunctions);
    }
    let mut facts: FxHashSet<Vec<u8>> = counted.names.iter().map(|name| name.fact(atoms)).collect();
    if program.reads_by_a_key_that_may_be_a_name.load(std::sync::atomic::Ordering::Relaxed) {
        facts.extend(MEMBERS_OF_OBJECT_PROTOTYPE_THAT_MAY_BE_LEFT_OUT.map(|name| [b"property ", name].concat()));
    }
    facts.extend(counted.properties_folded_to_new_texts.iter().map(|folded| [b"property ", written_in_a_fact(&folded.0)].concat()));
    facts.extend(counted.properties_folded_to_new_texts.iter().filter(|folded| folded.1).map(|folded| [b"program-property ", written_in_a_fact(&folded.0)].concat()));
    for source in &runtime_use.runtime_sources {
        facts.extend(source.facts.iter().cloned());
        facts.extend(source.escapes.iter().flat_map(|escape| ESCAPES.iter().filter(move |it| it.0 == escape.1)).flat_map(|it| it.1).map(|kind| [kind, &b" *"[..]].concat()));
    }
    facts.extend(counted.reading_any_property.first().map(|_| Name::Property(Atom::NONE).fact(atoms)));
    let mut places_vouched_for: FxHashMap<(FileId, Name), u32> = FxHashMap::default();
    for &(_, name, file) in counted.on_behalf_of.iter().filter(|it| it.1 == Name::Property(Atom::NONE) || it.1 == Name::ConstructorOfFunctions) {
        *places_vouched_for.entry((file, name)).or_default() += 1;
    }
    facts.extend(places_vouched_for.iter().map(|(&(file, name), count)| [b"vouched ", &name.fact(atoms)[..], b" ", files.module(file).path.text, b" ", count.to_string().as_bytes()].concat()));
    loop {
        let waiting = counted.on_behalf_of.len();
        if CALL_MEMBERS_UNDER_NAMES_OUT_OF_DATA.iter().any(|&fact| facts.contains(fact)) {
            facts.insert(Name::Property(Atom::NONE).fact(atoms));
        }
        counted.on_behalf_of.retain(|&(stands_for, name, file)| {
            let counts = stands_for.iter().any(|fact| is_among(&facts, fact));
            if counts {
                facts.insert(name.fact(atoms));
                counted.reading_any_property.extend((name == Name::Property(Atom::NONE)).then_some(file));
                counted.finding_the_constructor_of_functions.extend((name == Name::ConstructorOfFunctions).then_some(file));
            }
            !counts
        });
        if counted.on_behalf_of.len() == waiting {
            break;
        }
    }
    let may_call_reload = [&b"program-property reload"[..], b"property *"].iter().any(|&fact| facts.contains(fact));
    if may_call_reload && facts.contains(&b"Bun serve"[..]) {
        facts.insert(b"reload-option *".to_vec());
    }
    for (source, escape, stands_for) in escapes_that_wait {
        if stands_for.iter().any(|fact| is_among(&facts, fact)) {
            runtime_use.runtime_sources[source].escapes.push(escape);
        }
    }
    if facts.contains(&b"module node:events"[..]) {
        facts.insert(b"process *".to_vec());
        for path in reading_what_process_may_inherit {
            add_reason(&mut runtime_use.why_open, "a member that process may inherit from EventEmitter.prototype", path);
        }
    }
    let mut finding = counted.finding_the_constructor_of_functions;
    finding.sort_unstable_by_key(|&file| (files.module(file).builtin.is_some(), file.idx()));
    finding.dedup();
    let is_of_program = |file: &&FileId| files.module(**file).builtin.is_none() && !is_in_prelude(files.module(**file));
    let loads_sqlite = [&b"module bun:sqlite"[..], b"module node:sqlite", b"native node:sqlite"].iter().any(|&fact| facts.contains(fact));
    let why_the_found_opens = loads_sqlite.then_some("a name that is computed, read from what may be a database, which loads native code");
    for &file in finding.iter().filter(is_of_program).filter(|_| why_the_found_opens.is_some()) {
        add_reason(&mut runtime_use.why_open, why_the_found_opens.unwrap_or_default(), files.module(file).path.text);
    }
    if finding.iter().any(|file| is_of_program(&file)) {
        facts.insert(Name::Regexp("computed").fact(atoms));
    }
    for &(file, _) in program.reads_that_may_find_what_makes_or_loads_code.lock().iter() {
        add_reason(&mut runtime_use.why_open, "a member that makes or loads code, read from what may be the global object, process or Bun", files.module(file).path.text);
    }
    for &(file, _) in program.loads_of_modules_that_are_not_compiled.lock().iter().filter(|load| Alias::get(&load.1, bun_ast::Target::Bun, Cfg::default()).is_none()) {
        add_reason(&mut runtime_use.why_open, "a module that the executable does not hold, loaded at run time", files.module(file).path.text);
    }
    let mut reading_any_property = counted.reading_any_property;
    reading_any_property.sort_unstable_by_key(|&file| (files.module(file).builtin.is_some(), file.idx()));
    reading_any_property.dedup();
    runtime_use.reading_any_property = reading_any_property.chunk_by(|one, next| files.module(*one).builtin.is_some() == files.module(*next).builtin.is_some()).flat_map(|alike| alike.iter().take(if files.module(alike[0]).builtin.is_some() { alike.len() } else { PLACES_SHOWN_PER_REASON })).map(|&file| files.module(file).path.text.to_vec()).collect();
    if MAY_MAKE_A_REGEXP_FROM_TEXT.iter().any(|&fact| facts.contains(fact)) {
        facts.insert(Name::Regexp("computed").fact(atoms));
    }
    runtime_use.facts = facts.into_iter().collect();
}
