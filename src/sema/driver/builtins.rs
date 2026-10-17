use bun_builtin_syntax::{Archive, Reason, Trigger};
use bun_resolve_builtins::HardcodedModule::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use bun_sema::check::Program;
use bun_sema::hir::{
    BinOp, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, PatKind, PropKey, SpecifierKind,
    StmtKind, UnOp,
};
use bun_sema::program::{Builtin, FileId, LoadedBy, Module};
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
}

const PLACES_SHOWN_PER_REASON: usize = 4;

fn add_reason(reasons: &mut Vec<(&'static str, Vec<u8>)>, why: &'static str, path: &[u8]) {
    let mut alike = reasons.iter().filter(|reason| reason.0 == why);
    if !alike.clone().any(|reason| reason.1 == path)
        && alike.nth(PLACES_SHOWN_PER_REASON - 1).is_none()
    {
        reasons.push((why, path.to_vec()));
    }
}

const ESCAPES: [(&str, &[&[u8]]); 4] = [
    ("the global object", &[b"global"]),
    ("Bun", &[b"Bun"]),
    ("process", &[b"process"]),
    ("Bun or process as a whole", &[b"Bun", b"process"]),
];

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Name {
    Member(usize, Atom),
    Native(Atom, Atom),
    Property(Atom),
}

impl Name {
    fn fact(self, atoms: &Interner<'_>) -> Vec<u8> {
        match self {
            Name::Member(kind, name) => [
                GLOBALS.get(kind).map_or(&b"global"[..], |global| global.0),
                b" ",
                if name.is_some() {
                    atoms.bytes(name)
                } else {
                    b"*"
                },
            ]
            .concat(),
            Name::Native(file, symbol) => {
                [b"native ", atoms.bytes(file), b":", atoms.bytes(symbol)].concat()
            }
            Name::Property(name) => [
                &b"property "[..],
                if name.is_some() {
                    atoms.bytes(name)
                } else {
                    b"*"
                },
            ]
            .concat(),
        }
    }
}

struct RuntimeSource {
    path: Vec<u8>,
    module: Option<Vec<u8>>,
    facts: Vec<Vec<u8>>,
    named_at: Vec<(ExprId, Name)>,
    escapes: Vec<(ExprId, &'static str)>,
}

#[derive(Default)]
pub struct RuntimeUse {
    pub why_open: Vec<(&'static str, Vec<u8>)>,
    pub facts: Vec<Vec<u8>>,
    runtime_sources: Vec<RuntimeSource>,
    names_plugin: bool,
    runs_in_place: bool,
    uncompiled_runtime_sources: Vec<Vec<u8>>,
    openings: Vec<(Vec<u8>, ExprId, &'static str)>,
    files_that_may_be_sloppy: Vec<Vec<u8>>,
    native_modules: Vec<Vec<u8>>,
    reading_any_property: Vec<Vec<u8>>,
    named_at: Vec<(Vec<u8>, Vec<(ExprId, Name)>)>,
}

impl RuntimeUse {
    pub fn text(&self) -> Vec<u8> {
        let mut text = if self.why_open.is_empty() {
            b"closed\n".to_vec()
        } else {
            Vec::new()
        };
        for (why, path) in &self.why_open {
            let before_path: &[u8] = if path.is_empty() { b"" } else { b" in " };
            text.extend_from_slice(&[b"open ", why.as_bytes(), before_path, path, b"\n"].concat());
        }
        let mut facts = self.facts.clone();
        if !self.why_open.is_empty() {
            facts.push(b"world open".to_vec());
        }
        for source in &self.runtime_sources {
            facts.extend_from_slice(&source.facts);
            for escape in &source.escapes {
                for &kind in ESCAPES
                    .iter()
                    .filter(|it| it.0 == escape.1)
                    .flat_map(|it| it.1)
                {
                    facts.push([kind, b" *"].concat());
                    facts.push([b"escapes ", kind, b" ", &source.path].concat());
                }
            }
        }
        facts.extend(
            self.reading_any_property
                .iter()
                .map(|path| [b"escapes property ", &path[..]].concat()),
        );
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
        if self.names_plugin {
            add_reason(&mut self.why_open, "Bun.plugin", b"");
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
        self.facts.extend(
            scan.global_names
                .iter()
                .map(|&name| [b"global ", atoms.bytes(name)].concat()),
        );
        let read = scan.read.iter().filter(|read| read.1.is_some());
        self.facts.extend(
            read.map(|&(global, name)| [GLOBALS[global].0, b" ", atoms.bytes(name)].concat()),
        );
        if scan.read.contains(&(2, Atom::NONE)) {
            self.facts.push(b"console *".to_vec());
        }
        let kinds = GLOBALS
            .iter()
            .map(|global| global.0)
            .chain([&b"global"[..]]);
        self.facts.extend(
            kinds
                .zip(scan.touches_every_member_of)
                .filter(|it| it.1)
                .map(|it| [it.0, b" *"].concat()),
        );
        self.facts
            .extend(scan.native_bindings.iter().map(|&(file, symbol)| {
                [b"native ", atoms.bytes(file), b":", atoms.bytes(symbol)].concat()
            }));
        self.facts.sort_unstable();
        self.facts.dedup();
    }
}

const GLOBALS: [(&[u8], &[&[u8]]); 3] = [
    (b"process", &[b"process", b"node:process"]),
    (b"Bun", &[b"bun"]),
    (b"console", &[]),
];
const GLOBAL_OBJECT: usize = GLOBALS.len();
const GLOBAL_OBJECTS: [&[u8]; 4] = [b"globalThis", b"global", b"self", b"window"];
const SAFE_REQUIRE_PROPERTIES: [&[u8]; 4] = [b"resolve", b"cache", b"main", b"extensions"];
const OF_MODULE: [&[u8]; 7] = [
    b"exports",
    b"id",
    b"filename",
    b"path",
    b"paths",
    b"loaded",
    b"constructor",
];
const SAFE_IMPORT_META_PROPERTIES: [&[u8]; 9] = [
    b"url",
    b"dir",
    b"dirname",
    b"file",
    b"filename",
    b"path",
    b"main",
    b"env",
    b"resolve",
];
const LISTENS: [&[u8]; 5] = [
    b"on",
    b"once",
    b"addListener",
    b"prependListener",
    b"prependOnceListener",
];
const MODULES_WITH_LOADER_ACCESS: [&[u8]; 8] = [
    b"module",
    b"node:module",
    b"vm",
    b"node:vm",
    b"repl",
    b"node:repl",
    b"worker_threads",
    b"node:worker_threads",
];
const SAFE_NODE_MODULE_EXPORTS: [&[u8]; 5] = [
    b"builtinModules",
    b"isBuiltin",
    b"SourceMap",
    b"findSourceMap",
    b"syncBuiltinESMExports",
];
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

const NATIVE_FUNCTIONS: [&[u8]; 9] = [
    b"queueMicrotask",
    b"setTimeout",
    b"setInterval",
    b"setImmediate",
    b"clearTimeout",
    b"clearInterval",
    b"clearImmediate",
    b"fetch",
    b"structuredClone",
];

const EVENT_TARGET_FUNCTIONS: [&[u8]; 3] = [
    b"addEventListener",
    b"removeEventListener",
    b"dispatchEvent",
];
const EVENTS_OF_THE_GLOBAL_OBJECT: [&[u8]; 3] = [b"message", b"messageerror", b"error"];
const LOOK_UP_A_MEMBER: [&[u8]; 4] = [
    b"hasOwnProperty",
    b"propertyIsEnumerable",
    b"__lookupGetter__",
    b"__lookupSetter__",
];
const HAND_THE_RECEIVER_ON: [&[u8]; 3] = [b"valueOf", b"__defineGetter__", b"__defineSetter__"];

fn is_read_only_by_literal_names(
    module: &Module<'_>,
    atoms: &Interner<'_>,
    start: ExprId,
    is_itself: &dyn Fn(Atom) -> bool,
    reads: &mut Vec<(Atom, ExprId)>,
    looked_up: &mut Vec<Atom>,
) -> bool {
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
        if symbol.is_none()
            || bound.symbols[symbol.idx()]
                .flags
                .intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
            || !bound.assignments_to(symbol).is_empty()
        {
            return None;
        }
        match bound.symbols[symbol.idx()].decls[..] {
            [Decl::Var(pat) | Decl::Require(pat)] => match bound.pat_parent[pat.idx()] {
                PatParent::Var(declaration)
                    if hir[declaration].pat == pat && hir[declaration].init.is_some() =>
                {
                    Some(hir[declaration].init)
                }
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
    let is_symbol = |key: ExprId| {
        creates_symbol(key)
            || matches!(hir[key].kind, ExprKind::Ident(_))
                && initializer_of_constant(key).is_some_and(&creates_symbol)
    };
    let is_stored_to = |member: ExprId| matches!(bound.expr_parent[member.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Assign { op: None, target, .. } if target == member));
    let is_first_argument_of = |call: bun_sema::hir::CallId,
                                e: ExprId,
                                function_of_object: &[u8]| {
        !hir[call].args.is_empty()
            && hir.id_at(hir[call].args, 0) == e
            && matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, name, .. } if atoms.bytes(name) == function_of_object && matches!(hir[obj].kind, ExprKind::Ident(object) if atoms.bytes(object) == b"Object" && bound.expr_symbol[obj.idx()].is_none()))
    };
    let receives_property =
        |call: bun_sema::hir::CallId, e: ExprId| is_first_argument_of(call, e, b"defineProperty");
    let constant_string = |key: ExprId| {
        let mut written = if matches!(hir[key].kind, ExprKind::Ident(_)) {
            initializer_of_constant(key)?
        } else {
            key
        };
        while let ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::NonNull(expr) = hir[written].kind
        {
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
        bound
            .arguments_objects
            .iter()
            .any(|&mention| (from..to).contains(&hir[mention].pos))
    };
    let receiving_parameter = |call: bun_sema::hir::CallId, e: ExprId| {
        let index = hir
            .ids(hir[call].args)
            .position(|argument: ExprId| argument == e)?;
        if hir
            .ids(hir[call].args)
            .take(index + 1)
            .any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        let callee = hir[call].callee;
        let function = match hir[callee].kind {
            ExprKind::Fn(function) => function,
            ExprKind::Ident(_) if bound.expr_symbol[callee.idx()].is_some() => {
                match bound.symbols[bound.expr_symbol[callee.idx()].idx()].decls[..] {
                    [Decl::Fn(function)] => function,
                    _ => match hir[initializer_of_constant(callee)?].kind {
                        ExprKind::Fn(function) => function,
                        _ => return None,
                    },
                }
            }
            _ => return None,
        };
        if mentions_arguments(function) {
            return None;
        }
        let parameter = &hir[hir[function].params.iter().nth(index)?];
        (matches!(hir[parameter.pat].kind, PatKind::Ident(_))
            && !parameter.flags.contains(Flags::REST))
        .then(|| bound.pat_symbol[parameter.pat.idx()])
    };
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
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                    ..
                }
                | ExprKind::Binary {
                    op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                    ..
                } => {}
                ExprKind::Binary {
                    op: BinOp::In,
                    left,
                    right,
                } if right == e => looked_up.push(constant_string(left).unwrap_or(Atom::NONE)),
                ExprKind::Binary {
                    op: BinOp::Instanceof,
                    left,
                    ..
                } if left == e => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    left,
                    ..
                } if left == e => {}
                ExprKind::Cond { test, .. } if test == e => {}
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                }
                | ExprKind::Cond { .. }
                | ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => pending.push(around),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => {
                    let (name, may_have_any_name) = match hir[around].kind {
                        ExprKind::Index { index, .. } => (
                            constant_string(index),
                            is_stored_to(around) || is_symbol(index),
                        ),
                        ExprKind::Dot { name, .. } => (Some(name), false),
                        _ => (None, false),
                    };
                    let call = match bound.expr_parent[around.idx()] {
                        Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(it) if hir[it].callee == around) => {
                            Some(call)
                        }
                        _ => None,
                    };
                    match (name, call) {
                        (Some(name), _) if is_itself(name) => pending.push(around),
                        (Some(name), Some(call)) if atoms.bytes(name) == b"valueOf" => {
                            pending.push(call)
                        }
                        (Some(name), Some(_))
                            if HAND_THE_RECEIVER_ON.contains(&atoms.bytes(name)) =>
                        {
                            return false;
                        }
                        (Some(name), _) => reads.push((name, around)),
                        (None, _) if may_have_any_name => {}
                        (None, _) => return false,
                    }
                }
                ExprKind::Assign { target, .. } if target == e => {}
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == e && matches!(hir[target].kind, ExprKind::Ident(_)) => {
                    holder = bound.expr_symbol[target.idx()];
                    if holder.is_none() {
                        return false;
                    }
                    pending.push(around);
                }
                ExprKind::Call(call)
                    if is_receiver_of_native_function(call, e)
                        || is_first_argument_of(call, e, b"getPrototypeOf") => {}
                ExprKind::Call(call)
                    if is_first_argument_of(call, e, b"getOwnPropertyDescriptor") =>
                {
                    match hir.ids(hir[call].args).nth(1).and_then(constant_string) {
                        Some(name) if !is_itself(name) => reads.push((name, ExprId::NONE)),
                        _ => return false,
                    }
                }
                ExprKind::Call(call) if receives_property(call, e) => {
                    if hir[call].args.len() < 2 {
                        return false;
                    }
                    let key = hir.id_at(hir[call].args, 1);
                    match hir[key].kind {
                        ExprKind::String(name) if !is_itself(name) => {
                            reads.push((name, ExprId::NONE))
                        }
                        _ if is_symbol(key) => {}
                        _ => return false,
                    }
                    pending.push(around);
                }
                ExprKind::Call(call) => match receiving_parameter(call, e) {
                    Some(parameter) => holder = parameter,
                    None => return false,
                },
                _ => return false,
            },
            Parent::Stmt(around) => {
                if !matches!(
                    hir[around].kind,
                    StmtKind::Expr(_)
                        | StmtKind::If { .. }
                        | StmtKind::While { .. }
                        | StmtKind::DoWhile { .. }
                ) {
                    return false;
                }
            }
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Ident(_) if !hir[declaration].flags.contains(Flags::EXPORT) => {
                    holder = bound.pat_symbol[hir[declaration].pat.idx()]
                }
                PatKind::Object(props) => {
                    for prop in props.iter().map(|prop| &hir[prop]) {
                        match (prop.key, hir[prop.value].kind) {
                            _ if prop.is_rest => return false,
                            (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name))
                                if !is_itself(name) =>
                            {
                                reads.push((name, ExprId::NONE))
                            }
                            _ => return false,
                        }
                    }
                }
                _ => return false,
            },
            Parent::ParamDefault(parameter)
                if matches!(hir[hir[parameter].pat].kind, PatKind::Ident(_)) =>
            {
                holder = bound.pat_symbol[hir[parameter].pat.idx()]
            }
            _ => return false,
        }
        if holder.is_some() && !holders.contains(&holder) {
            holders.push(holder);
            let symbol = &bound.symbols[holder.idx()];
            let is_plain = !symbol.flags.contains(SymFlags::MERGED)
                && symbol.decls.iter().all(|&decl| match decl {
                    Decl::Var(_) | Decl::Require(_) => true,
                    Decl::Param(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Param(parameter) if !mentions_arguments(bound.param_fn[parameter.idx()])),
                    _ => false,
                })
                && !hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name));
            if !is_plain {
                return false;
            }
            let mentions = hir
                .exprs
                .iter()
                .enumerate()
                .filter(|it| matches!(it.1.kind, ExprKind::Ident(_)))
                .map(|it| ExprId::from(it.0 as u32));
            pending.extend(mentions.filter(|&mention| {
                bound.expr_symbol[mention.idx()] == holder
                    && bound.expr_parent[mention.idx()] != Parent::None
                    && !bound.is_in_type_query(mention)
            }));
        }
    }
    true
}

fn string_arguments_for_parameter(module: &Module<'_>, e: ExprId) -> Option<Vec<Atom>> {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_stored_once = |symbol: SymbolId| {
        symbol.is_some()
            && bound.symbols[symbol.idx()].decls.len() == 1
            && !bound.symbols[symbol.idx()]
                .flags
                .intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
            && bound.assignments_to(symbol).is_empty()
    };
    let taken = bound.expr_symbol[e.idx()];
    if !matches!(hir[e].kind, ExprKind::Ident(_)) || !is_stored_once(taken) {
        return None;
    }
    let Decl::Param(pat) = bound.symbols[taken.idx()].decls[0] else {
        return None;
    };
    let PatParent::Param(parameter) = bound.pat_parent[pat.idx()] else {
        return None;
    };
    let function = bound.param_fn[parameter.idx()];
    let index = hir[function].params.iter().position(|it| it == parameter)?;
    let (from, to, holder, is_exported) = match bound.fns[function.idx()].owner {
        FnOwner::Stmt(owner) => (
            hir[owner].start,
            hir[owner].loc.end,
            bound.fn_symbol[function.idx()],
            hir[function]
                .flags
                .intersects(Flags::EXPORT | Flags::DEFAULT),
        ),
        FnOwner::Expr(owner) => match bound.expr_parent[owner.idx()] {
            Parent::VarInit(declaration)
                if matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)) =>
            {
                (
                    hir[owner].pos,
                    hir[owner].end,
                    bound.pat_symbol[hir[declaration].pat.idx()],
                    hir[declaration].flags.contains(Flags::EXPORT),
                )
            }
            _ => return None,
        },
        _ => return None,
    };
    if is_exported
        || !is_stored_once(holder)
        || !matches!(hir[pat].kind, PatKind::Ident(_))
        || hir[parameter].default.is_some()
        || hir[function]
            .params
            .iter()
            .take(index + 1)
            .any(|it| hir[it].flags.contains(Flags::REST))
        || bound
            .arguments_objects
            .iter()
            .any(|&mention| (from..to).contains(&hir[mention].pos))
        || hir.exports.iter().any(|export| {
            export.spec.is_none()
                && export
                    .items
                    .iter()
                    .any(|item| hir[item].local == bound.symbols[holder.idx()].name)
        })
    {
        return None;
    }
    let mut handed = Vec::new();
    for (mention, expr) in hir.exprs.iter().enumerate() {
        let mention = ExprId::from(mention as u32);
        if !matches!(expr.kind, ExprKind::Ident(_))
            || bound.expr_symbol[mention.idx()] != holder
            || bound.expr_parent[mention.idx()] == Parent::None
        {
            continue;
        }
        let Parent::Expr(around) = bound.expr_parent[mention.idx()] else {
            return None;
        };
        let ExprKind::Call(call) = hir[around].kind else {
            return None;
        };
        if hir[call].callee != mention
            || hir
                .ids(hir[call].args)
                .take(index + 1)
                .any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        match hir
            .ids(hir[call].args)
            .nth(index)
            .map(|argument: ExprId| hir[argument].kind)
        {
            Some(ExprKind::String(specifier)) => handed.push(specifier),
            None => {}
            Some(_) => return None,
        }
    }
    Some(handed)
}

fn cannot_name_builtin_module(module: &Module<'_>, atoms: &Interner<'_>, mut e: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_node_path = |specifier: Atom| {
        specifier.is_some() && matches!(atoms.bytes(specifier), b"path" | b"node:path")
    };
    let requires_node_path = |e: ExprId| matches!(hir[e].kind, ExprKind::Call(call) if hir[call].args.len() == 1 && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) && matches!(hir[hir.id_at(hir[call].args, 0)].kind, ExprKind::String(specifier) if is_node_path(specifier)));
    let declarations_of = |e: ExprId| {
        let symbol = bound.expr_symbol[e.idx()];
        let is_constant = symbol.is_some()
            && !bound.symbols[symbol.idx()]
                .flags
                .intersects(bun_sema::bind::SymFlags::ASSIGNED | bun_sema::bind::SymFlags::MERGED)
            && bound.assignments_to(symbol).is_empty();
        is_constant.then(|| &bound.symbols[symbol.idx()].decls[..])
    };
    let function_of_node_path = |callee: ExprId| match hir[callee].kind {
        ExprKind::Dot { obj, name, .. } if matches!(hir[obj].kind, ExprKind::Ident(_)) => {
            match declarations_of(obj) {
                Some(&[Decl::Var(pat) | Decl::Require(pat)]) => match bound.pat_parent[pat.idx()] {
                    bun_sema::bind::PatParent::Var(declaration)
                        if hir[declaration].pat == pat
                            && hir[declaration].init.is_some()
                            && requires_node_path(hir[declaration].init) =>
                    {
                        Some(name)
                    }
                    _ => None,
                },
                Some(&[Decl::ImportDefault(import) | Decl::ImportNamespace(import)])
                    if !hir[import].type_only && is_node_path(hir[import].spec) =>
                {
                    Some(name)
                }
                _ => None,
            }
        }
        ExprKind::Ident(_) => match declarations_of(callee) {
            Some(&[Decl::ImportSpec(spec)])
                if !hir[spec].type_only
                    && !hir[hir[spec].import].type_only
                    && is_node_path(hir[hir[spec].import].spec) =>
            {
                Some(hir[spec].imported)
            }
            _ => None,
        },
        _ => None,
    };
    let mut must_be_absolute = false;
    loop {
        let is_path_head = |text: Atom| {
            matches!(atoms.bytes(text).first(), Some(b'/'))
                || !must_be_absolute && matches!(atoms.bytes(text).first(), Some(b'.' | b'@'))
        };
        match hir[e].kind {
            ExprKind::String(text) => return is_path_head(text),
            ExprKind::Template { exprs }
                if !exprs.is_empty()
                    && atoms
                        .bytes(hir.id_at(hir.template_texts(exprs), 0))
                        .is_empty() =>
            {
                e = hir.id_at(exprs, 0)
            }
            ExprKind::Template { exprs } => {
                return is_path_head(hir.id_at(hir.template_texts(exprs), 0));
            }
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                ..
            } => e = left,
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => e = expr,
            ExprKind::Ident(name) => {
                let symbol = bound.expr_symbol[e.idx()];
                return matches!(atoms.bytes(name), b"__dirname" | b"__filename")
                    && (symbol.is_none()
                        || bound.symbols[symbol.idx()]
                            .decls
                            .iter()
                            .all(|&decl| matches!(decl, Decl::CommonJsVariable)));
            }
            ExprKind::Dot { obj, name, .. } => {
                return matches!(hir[obj].kind, ExprKind::ImportMeta)
                    && matches!(
                        atoms.bytes(name),
                        b"dirname" | b"dir" | b"filename" | b"path" | b"url"
                    );
            }
            ExprKind::Call(call) => {
                match function_of_node_path(hir[call].callee).map(|name| atoms.bytes(name)) {
                    Some(b"resolve") => return true,
                    Some(b"join") if !hir[call].args.is_empty() => {
                        must_be_absolute = true;
                        e = hir.id_at(hir[call].args, 0);
                    }
                    _ => return false,
                }
            }
            _ => return false,
        }
    }
}

type GlobalObjectReads = (Vec<(Atom, ExprId)>, Vec<(usize, Atom)>, Vec<(usize, Atom)>);

fn is_deleted(module: &Module<'_>, member: ExprId) -> bool {
    let Some(mut operand) = member.some() else {
        return false;
    };
    loop {
        let Parent::Expr(around) = module.bound.expr_parent[operand.idx()] else {
            return false;
        };
        match module.hir[around].kind {
            ExprKind::Unary {
                op: UnOp::Delete, ..
            } => return true,
            ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_) => operand = around,
            _ => return false,
        }
    }
}

fn looked_up_through(
    module: &Module<'_>,
    atoms: &Interner<'_>,
    name: Atom,
    member: ExprId,
) -> Option<Atom> {
    if is_deleted(module, member) {
        return Some(Atom::NONE);
    }
    let (hir, member) = (&module.hir, member.some()?);
    let Parent::Expr(around) = module.bound.expr_parent[member.idx()] else {
        return None;
    };
    match hir[around].kind {
        ExprKind::Call(call)
            if hir[call].callee == member && LOOK_UP_A_MEMBER.contains(&atoms.bytes(name)) =>
        {
            match hir
                .ids(hir[call].args)
                .next()
                .map(|argument: ExprId| hir[argument].kind)
            {
                Some(ExprKind::String(asked)) => Some(asked),
                _ => Some(Atom::NONE),
            }
        }
        _ => None,
    }
}

#[derive(Default)]
struct OwnFunctionsOnGlobalObject {
    stored: FxHashSet<Atom>,
    called: Vec<(Atom, ExprId)>,
}

impl OwnFunctionsOnGlobalObject {
    fn add_member(&mut self, module: &Module<'_>, name: Atom, member: ExprId) {
        let Some(Parent::Expr(around)) = member
            .some()
            .map(|member| module.bound.expr_parent[member.idx()])
        else {
            return;
        };
        match module.hir[around].kind {
            ExprKind::Assign { target, .. } if target == member => _ = self.stored.insert(name),
            ExprKind::Call(call) if module.hir[call].callee == member => {
                self.called.push((name, member))
            }
            _ => {}
        }
    }
}

fn mentions_of_destructured_property(module: &Module<'_>, name: Atom) -> Option<Vec<ExprId>> {
    let (hir, bound) = (&module.hir, &module.bound);
    let mut holders: Vec<SymbolId> = Vec::new();
    for declaration in hir.var_decls.iter() {
        let PatKind::Object(props) = hir[declaration.pat].kind else {
            continue;
        };
        for prop in props.iter().map(|prop| &hir[prop]) {
            let is_the_property = match (prop.key, hir[prop.value].kind) {
                (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => key == name,
                _ => false,
            };
            if !is_the_property {
                continue;
            }
            if !matches!(hir[prop.value].kind, PatKind::Ident(_))
                || declaration.flags.contains(Flags::EXPORT)
            {
                return None;
            }
            holders.push(bound.pat_symbol[prop.value.idx()]);
        }
    }
    let is_constant = |holder: SymbolId| {
        let symbol = &bound.symbols[holder.idx()];
        symbol.decls.len() == 1
            && !symbol
                .flags
                .intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
            && bound.assignments_to(holder).is_empty()
            && !hir.exports.iter().any(|export| {
                export.spec.is_none()
                    && export
                        .items
                        .iter()
                        .any(|item| hir[item].local == symbol.name)
            })
    };
    if !holders.iter().all(|&holder| is_constant(holder)) {
        return None;
    }
    let identifiers = hir
        .exprs
        .iter()
        .enumerate()
        .filter(|it| matches!(it.1.kind, ExprKind::Ident(_)))
        .map(|it| ExprId::from(it.0 as u32));
    Some(
        identifiers
            .filter(|&mention| {
                holders.contains(&bound.expr_symbol[mention.idx()])
                    && bound.expr_parent[mention.idx()] != Parent::None
                    && !bound.is_in_type_query(mention)
            })
            .collect(),
    )
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
            Parent::Expr(around) if matches!(module.hir[around].kind, ExprKind::Dot { obj, .. } if obj == e) => {
                e = around
            }
            _ => return false,
        }
    }
}

fn reads_of_global_object(
    module: &Module<'_>,
    atoms: &Interner<'_>,
    global_objects: &[Atom],
    globals: &[Option<Atom>; GLOBALS.len()],
    get_builtin_module: Option<Atom>,
    e: ExprId,
) -> Option<GlobalObjectReads> {
    let is = |name: Atom, text: &[u8]| atoms.bytes(name) == text;
    let is_global_object = |name: Atom| global_objects.contains(&name);
    let mut reads = Vec::new();
    let mut looked_up = Vec::new();
    if !is_read_only_by_literal_names(
        module,
        atoms,
        e,
        &is_global_object,
        &mut reads,
        &mut looked_up,
    ) {
        return None;
    }
    looked_up.extend(
        reads
            .iter()
            .filter_map(|it| looked_up_through(module, atoms, it.0, it.1)),
    );
    let mut touched: Vec<(usize, Atom)> = looked_up
        .drain(..)
        .map(|name| (GLOBAL_OBJECT, name))
        .collect();
    let mut found = Vec::new();
    for &(name, member) in &reads {
        if matches!(
            name,
            known::require | known::module | known::eval | known::Function
        ) || is(name, b"Worker")
            || is(name, b"ShadowRealm")
        {
            return None;
        }
        let Some(global) = globals.iter().position(|&global| global == Some(name)) else {
            continue;
        };
        let members = if member.is_some() {
            vec![member]
        } else {
            mentions_of_destructured_property(module, name)?
        };
        let mut of_global = Vec::new();
        if !members.into_iter().all(|member| {
            is_read_only_by_literal_names(
                module,
                atoms,
                member,
                &|_| false,
                &mut of_global,
                &mut looked_up,
            )
        }) || of_global.iter().any(|it| {
            Some(it.0) == get_builtin_module
                || is(it.0, b"mainModule")
                || LISTENS.contains(&atoms.bytes(it.0))
        }) {
            return None;
        }
        looked_up.extend(
            of_global
                .iter()
                .filter_map(|it| looked_up_through(module, atoms, it.0, it.1)),
        );
        touched.extend(looked_up.drain(..).map(|name| (global, name)));
        found.extend(of_global.into_iter().map(|it| (global, it.0)));
    }
    Some((reads, found, touched))
}

fn is_in_try_block_with_handler(module: &Module<'_>, e: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let mut parent = bound.expr_parent[e.idx()];
    let mut below = bun_sema::hir::StmtId::NONE;
    loop {
        parent = match parent {
            Parent::Expr(around) if around.is_some() => bound.expr_parent[around.idx()],
            Parent::Stmt(around) if around.is_some() => {
                if matches!(hir[around].kind, StmtKind::Try { block, handler, .. } if block == below && handler.is_some())
                {
                    return true;
                }
                below = around;
                bound.stmt_parent[around.idx()]
            }
            Parent::VarInit(declaration) => Parent::Stmt(bound.var_stmt[declaration.idx()]),
            Parent::Prop(prop) => Parent::Expr(bound.prop_owner[prop.idx()]),
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            _ => return false,
        };
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum EvaluatorUse {
    CaughtCalls,
    Calls,
    Value,
}

fn use_of_evaluator(module: &Module<'_>, evaluator: ExprId) -> EvaluatorUse {
    let (hir, bound) = (&module.hir, &module.bound);
    let use_of = |mention: ExprId| match bound.expr_parent[mention.idx()] {
        Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee == mention) => {
            match is_in_try_block_with_handler(module, mention) {
                true => EvaluatorUse::CaughtCalls,
                false => EvaluatorUse::Calls,
            }
        }
        _ => EvaluatorUse::Value,
    };
    let Parent::VarInit(declaration) = bound.expr_parent[evaluator.idx()] else {
        return use_of(evaluator);
    };
    if !matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_))
        || hir[declaration].flags.contains(Flags::EXPORT)
    {
        return EvaluatorUse::Value;
    }
    let holder = bound.pat_symbol[hir[declaration].pat.idx()];
    let symbol = &bound.symbols[holder.idx()];
    if symbol.decls.len() != 1
        || symbol
            .flags
            .intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
        || !bound.assignments_to(holder).is_empty()
        || hir.exports.iter().any(|export| {
            export.spec.is_none()
                && export
                    .items
                    .iter()
                    .any(|item| hir[item].local == symbol.name)
        })
    {
        return EvaluatorUse::Value;
    }
    let identifiers = hir
        .exprs
        .iter()
        .enumerate()
        .filter(|it| matches!(it.1.kind, ExprKind::Ident(_)))
        .map(|it| ExprId::from(it.0 as u32));
    let mentions = identifiers.filter(|&mention| {
        bound.expr_symbol[mention.idx()] == holder
            && bound.expr_parent[mention.idx()] != Parent::None
            && !bound.is_in_type_query(mention)
    });
    mentions
        .map(use_of)
        .max()
        .unwrap_or(EvaluatorUse::CaughtCalls)
}

fn is_free(module: &Module<'_>, e: ExprId) -> bool {
    let hir = &module.hir;
    let symbol = module.bound.expr_symbol[e.idx()];
    symbol.is_none()
        || !module.bound.symbols[symbol.idx()]
            .decls
            .iter()
            .any(|&decl| match decl {
                Decl::Fn(f) => !matches!(hir[f].body, FnBody::None),
                Decl::Var(_) | Decl::Class(_) | Decl::Module(_) | Decl::Enum(_) => {
                    !hir.is_ambient(hir.node(decl))
                }
                Decl::Interface(_)
                | Decl::Alias(_)
                | Decl::TypeParam(_)
                | Decl::CommonJsVariable => false,
                _ => true,
            })
}

fn names_global(module: &Module<'_>, atoms: &Interner<'_>, e: ExprId, name: Atom) -> bool {
    module.bound.expr_parent[e.idx()] != Parent::None
        && is_free(module, e)
        && !(module.builtin.is_some() && atoms.bytes(name).starts_with(b"$"))
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
            Parent::Prop(prop) | Parent::PropKey(_, prop) | Parent::MethodKey(prop) => {
                Parent::Expr(bound.prop_owner[prop.idx()])
            }
            Parent::Case(case) => Parent::Stmt(bound.case_stmt[case.idx()]),
            Parent::MemberInit(member) | Parent::MemberKey(member) => around_member(member),
            Parent::PatPropDefault(prop) | Parent::PatKey(prop) => around_pattern(hir[prop].value),
            Parent::PatElemDefault(element) => around_pattern(hir[element].pat),
            Parent::ClassExtends(class) | Parent::Decorator(class, _) => {
                bound.class_owner[class.idx()].to_parent()
            }
            Parent::EnumInit(member) => {
                Parent::Stmt(hir[bound.enum_member_owner[member.idx()]].stmt)
            }
            Parent::Module(namespace) => Parent::Stmt(hir[namespace].stmt),
            Parent::None | Parent::File | Parent::Expr(_) | Parent::Stmt(_) => return FnId::NONE,
        };
    }
}

fn is_in_compiled_program(program: &Program, file: FileId, place: ExprId) -> bool {
    let module = program.files.module(file);
    let Some(compiled) = module.compiled_functions.get() else {
        return true;
    };
    if place.is_none() {
        return compiled.is_evaluated;
    }
    is_child_in_compiled_program(
        program,
        file,
        module.bound.expr_parent[place.idx()],
        module.hir[place].pos,
    )
}

fn is_child_in_compiled_program(program: &Program, file: FileId, parent: Parent, pos: u32) -> bool {
    let module = program.files.module(file);
    let Some(compiled) = module.compiled_functions.get() else {
        return true;
    };
    if program
        .files
        .enclosing_dead_range_start(file, pos)
        .is_some()
    {
        return false;
    }
    let mut function = function_around(module, parent);
    while function.is_some() && !compiled.is_defined(function) {
        function = module.bound.fns[function.idx()].enclosing;
    }
    if function.is_some() {
        compiled.is_reached(function)
    } else {
        compiled.is_evaluated
    }
}

const HAND_OUT_A_MEMBER: [(&[u8], &[u8]); 3] = [
    (b"Reflect", b"get"),
    (b"Reflect", b"getOwnPropertyDescriptor"),
    (b"Object", b"getOwnPropertyDescriptor"),
];

struct Properties<'a, 's> {
    module: &'a Module<'s>,
    atoms: &'a Interner<'s>,
}

impl Properties<'_, '_> {
    fn is_global(&self, e: ExprId, name: &[u8]) -> bool {
        matches!(self.module.hir[e].kind, ExprKind::Ident(written) if self.atoms.bytes(written) == name)
            && is_free(self.module, e)
    }

    fn constant_key(&self, mut e: ExprId) -> Option<Atom> {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let skip_assertions = |mut e: ExprId| {
            while let ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) = hir[e].kind
            {
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
            && !bound.symbols[symbol.idx()]
                .flags
                .intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
            && bound.assignments_to(symbol).is_empty()
        {
            e = skip_assertions(hir[declaration].init);
        }
        match hir[e].kind {
            ExprKind::String(name) => Some(name),
            ExprKind::Template { exprs } if exprs.is_empty() => {
                Some(hir.id_at(hir.template_texts(exprs), 0))
            }
            _ => None,
        }
    }

    fn named_by(&self, e: ExprId, found: &mut Vec<Atom>) {
        let (hir, bound) = (&self.module.hir, &self.module.bound);
        let hands_out = |obj: ExprId, name: Atom| {
            HAND_OUT_A_MEMBER
                .iter()
                .any(|it| it.1 == self.atoms.bytes(name) && self.is_global(obj, it.0))
        };
        match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => {
                found.push(name);
                let is_called = matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) if hir[call].callee == e));
                if hands_out(obj, name) && !is_called
                    || self.atoms.bytes(name) == b"getOwnPropertyDescriptors"
                        && self.is_global(obj, b"Object")
                {
                    found.push(Atom::NONE);
                }
            }
            ExprKind::Index { index: key, .. }
            | ExprKind::Binary {
                op: BinOp::In,
                left: key,
                ..
            } => found.extend(self.constant_key(key)),
            ExprKind::Call(call) => {
                if let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind
                    && hands_out(obj, name)
                {
                    found.push(
                        hir.ids(hir[call].args)
                            .nth(1)
                            .and_then(|key: ExprId| self.constant_key(key))
                            .unwrap_or(Atom::NONE),
                    );
                }
            }
            ExprKind::Ident(_) if self.is_global(e, b"Reflect") || self.is_global(e, b"Object") => {
                let is_only_read = matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if match hir[around].kind {
                    ExprKind::Dot { obj, .. } => obj == e,
                    ExprKind::Index { obj, index, .. } => obj == e && self.constant_key(index).is_some(),
                    ExprKind::Binary { op: BinOp::Instanceof, right, .. } => right == e,
                    ExprKind::Unary { op: UnOp::Typeof, .. } => true,
                    ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee == e,
                    _ => false,
                });
                if !is_only_read {
                    found.push(Atom::NONE);
                }
            }
            ExprKind::Assign {
                op: None, target, ..
            } => {
                let mut targets = vec![target];
                while let Some(target) = targets.pop() {
                    match hir[target].kind {
                        ExprKind::Object(props) => {
                            for prop in props.iter().map(|prop| &hir[prop]) {
                                match prop.key {
                                    PropKey::Name(name) => found.push(name),
                                    PropKey::Computed(key) => found.extend(self.constant_key(key)),
                                    PropKey::None | PropKey::Private(_) => {}
                                }
                                targets.extend(prop.value.some());
                            }
                        }
                        ExprKind::Array(elements) => targets.extend(
                            hir.ids(elements)
                                .filter(|element: &ExprId| element.is_some()),
                        ),
                        ExprKind::Assign {
                            op: None, target, ..
                        }
                        | ExprKind::Spread(target) => targets.push(target),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
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
    openings_if_events_are_dispatched: Vec<(u32, ExprId, &'static str)>,
    stored_on_global_object: FxHashSet<Atom>,
    called_on_global_object: Vec<(u32, ExprId, Atom)>,
    touches_every_member_of: [bool; GLOBALS.len() + 1],
    named_at: Vec<(u32, ExprId, Name)>,
}

impl<'a, 's> Scan<'a, 's> {
    fn empty(atoms: &'a Interner<'s>, preserves_source_paths: bool) -> Scan<'a, 's> {
        Scan {
            atoms,
            get_builtin_module: atoms.lookup(b"getBuiltinModule"),
            globals: GLOBALS.map(|global| atoms.lookup(global.0)),
            global_objects: GLOBAL_OBJECTS
                .iter()
                .filter_map(|name| atoms.lookup(name))
                .collect(),
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
            openings_if_events_are_dispatched: Vec::new(),
            stored_on_global_object: FxHashSet::default(),
            called_on_global_object: Vec::new(),
            touches_every_member_of: Default::default(),
            named_at: Vec::new(),
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
        self.file_loader_entry_sites
            .extend(later.file_loader_entry_sites);
        self.has_unlocated_loader_entry |= later.has_unlocated_loader_entry;
        self.leaks_global_object |= later.leaks_global_object;
        self.listens_for_messages |= later.listens_for_messages;
        self.global_names.extend(later.global_names);
        self.native_bindings.extend(later.native_bindings);
        self.openings.extend(later.openings);
        self.openings_if_events_are_dispatched
            .extend(later.openings_if_events_are_dispatched);
        self.stored_on_global_object
            .extend(later.stored_on_global_object);
        self.called_on_global_object
            .extend(later.called_on_global_object);
        for (touches, later) in self
            .touches_every_member_of
            .iter_mut()
            .zip(later.touches_every_member_of)
        {
            *touches |= later;
        }
        self.named_at.extend(later.named_at);
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
        let mut why_open: Vec<(&'static str, ExprId)> = Vec::new();
        let mut global_names: Vec<Atom> = Vec::new();
        let mut listeners: Vec<ExprId> = Vec::new();
        let mut own_functions = OwnFunctionsOnGlobalObject::default();
        let mut aliases: Vec<(Atom, usize)> = Vec::new();
        for import in hir.imports.iter().filter(|import| !import.type_only) {
            let Some(global) = self.module_global(import.spec) else {
                continue;
            };
            aliases.extend(
                [import.default, import.namespace]
                    .into_iter()
                    .filter(|name| name.is_some())
                    .map(|name| (name, global)),
            );
            for spec in import
                .named
                .iter()
                .map(|spec| &hir[spec])
                .filter(|spec| !spec.type_only)
            {
                self.read.insert((global, spec.imported));
                named_at.push((ExprId::NONE, Name::Member(global, spec.imported)));
            }
        }
        for used in hir.specifier_uses.iter() {
            let mut imports = hir
                .imports
                .iter()
                .filter(|import| import.spec == used.spec)
                .peekable();
            let is_only_for_types = used.kind == SpecifierKind::ImportType
                || used.kind == SpecifierKind::Import
                    && imports.peek().is_some()
                    && imports.all(|import| import.type_only);
            if is_only_for_types {
                continue;
            }
            self.name(used.spec);
            if used.spec.is_some() && self.atoms.bytes(used.spec) == b"bun:internal-for-testing" {
                why_open.push(("bun:internal-for-testing", ExprId::NONE));
            }
            if used.kind != SpecifierKind::Import
                && used.kind != SpecifierKind::SideEffect
                && used.kind != SpecifierKind::RequireCall
                && let Some(global) = self.module_global(used.spec)
            {
                self.read.insert((global, Atom::NONE));
                self.has_unlocated_loader_entry = true;
                self.file_loader_entry_sites.push((number, ExprId::NONE));
                why_open.push(("Bun or process as a whole", ExprId::NONE));
            }
        }
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            let ExprKind::String(specifier) = hir[hir.id_at(call.args, 0)].kind else {
                continue;
            };
            let loads = match hir[call.callee].kind {
                ExprKind::Ident(known::require) => call.args.len() == 1,
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => true,
                ExprKind::Dot {
                    obj,
                    name: known::require,
                    ..
                } => {
                    call.args.len() == 1 && matches!(hir[obj].kind, ExprKind::Ident(known::module))
                }
                _ => false,
            };
            if loads {
                self.name(specifier);
                if self.atoms.bytes(specifier) == b"bun:internal-for-testing" {
                    why_open.push(("bun:internal-for-testing", call.callee));
                }
            }
        }
        let asserted = |mut e: ExprId| loop {
            match hir[e].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => e = expr,
                _ => return e,
            }
        };
        let global_of_global_object = |obj: ExprId, name: Atom| match hir[asserted(obj)].kind {
            ExprKind::Ident(object)
                if self.global_objects.contains(&object) && is_free(asserted(obj)) =>
            {
                self.globals.iter().position(|&global| global == Some(name))
            }
            _ => None,
        };
        let global_at = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) => {
                match self.globals.iter().position(|&global| global == Some(name)) {
                    Some(global) if is_free(e) => Some(global),
                    _ => aliases
                        .iter()
                        .find(|alias| alias.0 == name)
                        .map(|alias| alias.1),
                }
            }
            ExprKind::Dot { obj, name, .. } => global_of_global_object(obj, name),
            ExprKind::Index { obj, index, .. } => match hir[index].kind {
                ExprKind::String(name) => global_of_global_object(obj, name),
                _ => None,
            },
            ExprKind::Call(call)
                if hir[call].args.len() == 1
                    && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) =>
            {
                match hir[hir.id_at(hir[call].args, 0)].kind {
                    ExprKind::String(specifier) => GLOBALS
                        .iter()
                        .position(|global| global.1.contains(&self.atoms.bytes(specifier))),
                    _ => None,
                }
            }
            _ => None,
        };
        for call in hir
            .calls
            .iter()
            .filter(|call| is_runtime_source && call.args.len() >= 2)
        {
            if let ExprKind::Ident(callee) = hir[call.callee].kind
                && matches!(
                    self.atoms.bytes(callee),
                    b"$cpp" | b"$rust" | b"$newCppFunction" | b"$newRustFunction" | b"$bindgen"
                )
                && let (ExprKind::String(file), ExprKind::String(symbol)) = (
                    hir[hir.id_at(call.args, 0)].kind,
                    hir[hir.id_at(call.args, 1)].kind,
                )
            {
                self.native_bindings.insert((file, symbol));
                named_at.push((call.callee, Name::Native(file, symbol)));
            }
        }
        let mut is_only_read: FxHashSet<ExprId> = FxHashSet::default();
        let mut read: Vec<(usize, Atom, ExprId)> = Vec::new();
        let mut mentions: Vec<(ExprId, usize)> = Vec::new();
        let mut touched: Vec<(usize, Atom, ExprId)> = Vec::new();
        let hands_receiver_on =
            |name: Atom| name.is_some() && HAND_THE_RECEIVER_ON.contains(&self.atoms.bytes(name));
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if matches!(expr.kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
                && is_operand_of_type_query(module, e)
            {
                continue;
            }
            if let Some(global) = global_at(e) {
                mentions.push((e, global));
            }
            if let ExprKind::Ident(name) = expr.kind
                && names_global(module, self.atoms, e, name)
            {
                global_names.push(name);
                touched.extend(is_deleted(module, e).then_some((GLOBAL_OBJECT, Atom::NONE, e)));
                if self.atoms.bytes(name) == b"addEventListener" {
                    listeners.push(e);
                }
            }
            let (obj, name) = match expr.kind {
                ExprKind::Dot { obj, name, .. } => (obj, name),
                ExprKind::Index { obj, index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (obj, name),
                    _ => continue,
                },
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    operand,
                } => (operand, Atom::NONE),
                _ => continue,
            };
            let obj = asserted(obj);
            if let Some(global) = global_at(obj).filter(|_| !hands_receiver_on(name)) {
                is_only_read.insert(obj);
                if name.is_some() {
                    read.push((global, name, e));
                    touched.extend(
                        looked_up_through(module, self.atoms, name, e)
                            .map(|name| (global, name, e)),
                    );
                }
            }
        }
        for declaration in hir
            .var_decls
            .iter()
            .filter(|declaration| declaration.init.is_some())
        {
            let destructured = asserted(declaration.init);
            let (Some(global), PatKind::Object(props)) =
                (global_at(destructured), hir[declaration.pat].kind)
            else {
                continue;
            };
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
            let loads_modules = |name: Atom| {
                Some(name) == self.get_builtin_module || self.atoms.bytes(name) == b"mainModule"
            };
            if let Some(names) =
                names.filter(|names| !names.iter().any(|&name| loads_modules(name)))
            {
                is_only_read.insert(destructured);
                read.extend(names.into_iter().map(|name| (global, name, destructured)));
            }
        }
        let loads_modules = |name: Atom| {
            Some(name) == self.get_builtin_module || self.atoms.bytes(name) == b"mainModule"
        };
        let mut listens_under_alias = false;
        let mut file_loader_entries: Vec<(&'static str, u32, ExprId)> = Vec::new();
        for (mention, global) in mentions
            .into_iter()
            .filter(|mention| !is_only_read.contains(&mention.0))
        {
            let mut reads = Vec::new();
            let mut looked_up = Vec::new();
            if is_read_only_by_literal_names(
                module,
                self.atoms,
                mention,
                &|_| false,
                &mut reads,
                &mut looked_up,
            ) && !reads.iter().any(|it| loads_modules(it.0))
            {
                listens_under_alias |= global == 0
                    && reads
                        .iter()
                        .any(|it| LISTENS.contains(&self.atoms.bytes(it.0)));
                looked_up.extend(
                    reads
                        .iter()
                        .filter_map(|it| looked_up_through(module, self.atoms, it.0, it.1)),
                );
                touched.extend(looked_up.into_iter().map(|name| (global, name, mention)));
                read.extend(
                    reads
                        .into_iter()
                        .map(|it| (global, it.0, it.1.some().unwrap_or(mention))),
                );
            } else {
                read.push((global, Atom::NONE, mention));
                if global < 2 {
                    file_loader_entries.push((
                        if global == 0 { "process" } else { "Bun" },
                        hir[mention].pos,
                        mention,
                    ));
                }
            }
        }
        named_at.extend(
            read.iter()
                .filter(|it| it.1.is_some() || it.0 == 2)
                .map(|it| (it.2, Name::Member(it.0, it.1))),
        );
        self.read.extend(read.into_iter().map(|it| (it.0, it.1)));

        let is = |name: Atom, text: &[u8]| self.atoms.bytes(name) == text;
        let is_one_of = |name: Atom, names: &[&[u8]]| names.contains(&self.atoms.bytes(name));
        let variable_at = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name)
                if (matches!(
                    name,
                    known::require | known::module | known::eval | known::Function
                ) || is(name, b"Worker")
                    || is(name, b"ShadowRealm"))
                    && is_free(e) =>
            {
                Some(name)
            }
            ExprKind::Dot { obj, name, .. } => match hir[asserted(obj)].kind {
                ExprKind::Ident(object)
                    if self.global_objects.contains(&object) && is_free(asserted(obj)) =>
                {
                    Some(name)
                }
                _ => None,
            },
            _ => None,
        };
        let mut is_harmless: FxHashSet<ExprId> = FxHashSet::default();
        let mut listens_for_messages = listens_under_alias;
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            if let ExprKind::Dot { obj, name, .. } = hir[call.callee].kind
                && global_at(asserted(obj)) == Some(0)
                && is_one_of(name, &LISTENS)
                && !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(event) if !is(event, b"message"))
            {
                listens_for_messages = true;
            }
            if matches!(hir[call.callee].kind, ExprKind::Ident(known::require))
                && cannot_name_builtin_module(module, self.atoms, hir.id_at(call.args, 0))
            {
                is_harmless.insert(call.callee);
                if !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(_))
                    && is_free(call.callee)
                {
                    self.file_loader_entry_sites.push((number, call.callee));
                    why_open.push(("require of a path that is computed", call.callee));
                }
            }
            if let ExprKind::String(_) = hir[hir.id_at(call.args, 0)].kind {
                match hir[call.callee].kind {
                    ExprKind::Ident(known::require) => _ = is_harmless.insert(call.callee),
                    ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => {
                        _ = is_harmless.insert(call.callee)
                    }
                    ExprKind::Dot {
                        obj,
                        name: known::require,
                        ..
                    } if call.args.len() == 1
                        && matches!(hir[obj].kind, ExprKind::Ident(known::module)) =>
                    {
                        _ = is_harmless.insert(obj)
                    }
                    _ => {}
                }
            }
        }
        let is_define_property = |callee: ExprId| matches!(hir[callee].kind, ExprKind::Dot { obj, name, .. } if is(name, b"defineProperty") && matches!(hir[obj].kind, ExprKind::Ident(object) if is(object, b"Object") && is_free(obj)));
        let does_not_escape = |mut e: ExprId| loop {
            match module.bound.expr_parent[e.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Unary {
                        op: UnOp::Not | UnOp::Typeof,
                        ..
                    }
                    | ExprKind::Binary {
                        op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                        ..
                    } => return true,
                    ExprKind::Binary {
                        op: BinOp::And,
                        left,
                        ..
                    } if left == e => return true,
                    ExprKind::Cond { test, .. } if test == e => return true,
                    ExprKind::Binary {
                        op: BinOp::And | BinOp::Or | BinOp::Nullish,
                        ..
                    }
                    | ExprKind::Cond { .. } => e = around,
                    ExprKind::Call(call)
                        if !hir[call].args.is_empty()
                            && hir.id_at(hir[call].args, 0) == e
                            && is_define_property(hir[call].callee) =>
                    {
                        e = around
                    }
                    ExprKind::Dot { obj, name, .. } => {
                        return obj == e && is_one_of(name, &OF_MODULE);
                    }
                    _ => return false,
                },
                Parent::Stmt(around) => {
                    return matches!(
                        hir[around].kind,
                        StmtKind::Expr(_)
                            | StmtKind::If { .. }
                            | StmtKind::While { .. }
                            | StmtKind::DoWhile { .. }
                    );
                }
                _ => return false,
            }
        };
        let mut global_object_members: Vec<ExprId> = Vec::new();
        let is_only_compared = |e: ExprId| matches!(module.bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. }));
        for (index, expr) in hir.exprs.iter().enumerate() {
            let (obj, name) = match expr.kind {
                ExprKind::Dot { obj, name, .. } => (obj, name),
                ExprKind::Index { obj, index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (obj, name),
                    _ => continue,
                },
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    operand,
                } => {
                    is_harmless.insert(asserted(operand));
                    continue;
                }
                ExprKind::Binary {
                    op: BinOp::Instanceof,
                    right,
                    ..
                } => {
                    is_harmless.insert(asserted(right));
                    continue;
                }
                ExprKind::Binary {
                    op: BinOp::EqEqEq | BinOp::NotEqEq,
                    left,
                    right,
                } => {
                    is_harmless.insert(asserted(left));
                    is_harmless.insert(asserted(right));
                    continue;
                }
                _ => continue,
            };
            let obj = asserted(obj);
            match hir[obj].kind {
                ExprKind::Ident(object)
                    if self.global_objects.contains(&object)
                        && is_free(obj)
                        && !is_operand_of_type_query(module, obj) =>
                {
                    global_names.push(name);
                    named_at.push((
                        ExprId::from(index as u32),
                        Name::Member(GLOBAL_OBJECT, name),
                    ));
                    touched.extend(
                        looked_up_through(module, self.atoms, name, ExprId::from(index as u32))
                            .map(|name| (GLOBAL_OBJECT, name, ExprId::from(index as u32))),
                    );
                    own_functions.add_member(module, name, ExprId::from(index as u32));
                    if self.global_objects.contains(&name) {
                        global_object_members.push(ExprId::from(index as u32));
                    }
                    if is(name, b"addEventListener") {
                        listeners.push(ExprId::from(index as u32));
                    }
                }
                ExprKind::Ident(known::require)
                    if is_free(obj)
                        && (is(name, b"cache")
                            || is(name, b"extensions")
                            || is(name, b"main")
                                && !is_only_compared(ExprId::from(index as u32))) =>
                {
                    why_open.push((
                        "require.main, require.cache or require.extensions",
                        ExprId::from(index as u32),
                    ))
                }
                ExprKind::Ident(known::module) if is_free(obj) && is(name, b"constructor") => {
                    why_open.push(("module.constructor", ExprId::from(index as u32)))
                }
                _ => {}
            }
            let may_be_read = match hir[obj].kind {
                ExprKind::ImportMeta => is_one_of(name, &SAFE_IMPORT_META_PROPERTIES),
                ExprKind::Ident(known::require) => is_one_of(name, &SAFE_REQUIRE_PROPERTIES),
                ExprKind::Ident(known::module) => {
                    is_one_of(name, &OF_MODULE)
                        || is(name, b"hot")
                        || (is(name, b"parent") || is(name, b"children"))
                            && does_not_escape(ExprId::from(index as u32))
                }
                ExprKind::Ident(object) if self.global_objects.contains(&object) => {
                    !hands_receiver_on(name)
                }
                _ => variable_at(obj) == Some(known::Function),
            };
            if may_be_read {
                is_harmless.insert(obj);
            }
        }
        let mut read_via_global_object: Vec<(usize, Atom)> = Vec::new();
        let mut touched_via_global_object: Vec<(usize, Atom, ExprId)> = Vec::new();
        let mut named_via_global_object: Vec<(ExprId, Name)> = Vec::new();
        let mut names_via_global_object: Vec<(Atom, ExprId)> = Vec::new();
        let mut stays_visible = |e: ExprId| match reads_of_global_object(
            module,
            self.atoms,
            &self.global_objects,
            &self.globals,
            self.get_builtin_module,
            e,
        ) {
            Some((names, found, touched)) => {
                named_via_global_object.extend(names.iter().map(|&(name, member)| {
                    (
                        member.some().unwrap_or(e),
                        Name::Member(GLOBAL_OBJECT, name),
                    )
                }));
                named_via_global_object.extend(
                    found
                        .iter()
                        .map(|&(global, name)| (e, Name::Member(global, name))),
                );
                names_via_global_object.extend(names);
                read_via_global_object.extend(found);
                touched_via_global_object
                    .extend(touched.into_iter().map(|(kind, name)| (kind, name, e)));
                true
            }
            None => false,
        };
        for member in global_object_members {
            if !stays_visible(member) {
                why_open.push(("the global object", member));
            }
        }
        for (index, expr) in hir.exprs.iter().enumerate() {
            let (ExprKind::Call(call) | ExprKind::New(call)) = expr.kind else {
                continue;
            };
            let created = ExprId::from(index as u32);
            if variable_at(hir[call].callee) != Some(known::Function)
                || hir[call].args.len() != 1
                || !matches!(hir[hir.id_at(hir[call].args, 0)].kind, ExprKind::String(text) if matches!(self.atoms.bytes(text), b"return this" | b"return this;"))
            {
                continue;
            }
            if let Parent::Expr(called) = module.bound.expr_parent[created.idx()]
                && matches!(hir[called].kind, ExprKind::Call(outer) if hir[outer].callee == created && hir[outer].args.is_empty())
                && stays_visible(called)
            {
                is_harmless.insert(hir[call].callee);
                if !is_in_try_block_with_handler(module, created) {
                    why_open.push(("a call of Function", created));
                }
            }
        }
        let mut loader_entry = self.loader_entry;
        let mut named_via_created_requires: Vec<Atom> = Vec::new();
        let has_loader_access = |specifier: Atom| {
            specifier.is_some() && MODULES_WITH_LOADER_ACCESS.contains(&self.atoms.bytes(specifier))
        };
        for (index, expr) in hir.exprs.iter().enumerate() {
            let (loads, argument) = match expr.kind {
                ExprKind::ImportCall { args } => (ExprId::from(index as u32), hir.id_at(args, 0)),
                ExprKind::Call(call)
                    if hir[call].args.len() == 1
                        && matches!(
                            hir[hir[call].callee].kind,
                            ExprKind::Ident(known::require)
                        ) =>
                {
                    (hir[call].callee, hir.id_at(hir[call].args, 0))
                }
                _ => continue,
            };
            if let Some(handed) = string_arguments_for_parameter(module, argument)
                .filter(|handed| !handed.iter().any(|&specifier| has_loader_access(specifier)))
            {
                is_harmless.insert(loads);
                self.file_loader_entry_sites.push((number, loads));
                why_open.push(("require or import() of a parameter", loads));
                named_via_created_requires.extend(handed);
            }
        }
        let is_loaded_by_call = hir
            .calls
            .iter()
            .filter(|call| !call.args.is_empty())
            .any(|call| {
                let ExprKind::String(specifier) = hir[hir.id_at(call.args, 0)].kind else {
                    return false;
                };
                let loads = match hir[call.callee].kind {
                    ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => true,
                    ExprKind::Dot {
                        obj,
                        name: known::require,
                        ..
                    } => matches!(hir[obj].kind, ExprKind::Ident(known::module)),
                    _ => false,
                };
                loads && has_loader_access(specifier)
            });
        let required: Vec<(ExprId, Atom)> = hir
            .exprs
            .iter()
            .enumerate()
            .filter_map(|(index, expr)| match expr.kind {
                ExprKind::Call(call)
                    if !hir[call].args.is_empty()
                        && matches!(
                            hir[hir[call].callee].kind,
                            ExprKind::Ident(known::require)
                        ) =>
                {
                    match hir[hir.id_at(hir[call].args, 0)].kind {
                        ExprKind::String(specifier) if has_loader_access(specifier) => {
                            Some((ExprId::from(index as u32), specifier))
                        }
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect();
        if is_loaded_by_call
            || !required.is_empty()
            || hir
                .specifier_uses
                .iter()
                .any(|used| has_loader_access(used.spec))
        {
            let bound = &module.bound;
            let makes_requires = |spec: bun_sema::hir::ImportSpecId| {
                let from = hir[hir[spec].import].spec;
                from.is_some()
                    && is(hir[spec].imported, b"createRequire")
                    && matches!(self.atoms.bytes(from), b"module" | b"node:module")
            };
            let is_safe_name = |spec: bun_sema::hir::ImportSpecId| {
                let names: &[&[u8]] = match self.atoms.bytes(hir[hir[spec].import].spec) {
                    b"module" | b"node:module" => &SAFE_NODE_MODULE_EXPORTS,
                    b"worker_threads" | b"node:worker_threads" => &SAFE_WORKER_THREADS_EXPORTS,
                    _ => &[],
                };
                hir[spec].type_only || is_one_of(hir[spec].imported, names) || makes_requires(spec)
            };
            let mut is_always_safe = !is_loaded_by_call
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
                .filter(|&e| {
                    bound.expr_symbol[e.idx()].is_some()
                        && bound.expr_parent[e.idx()] != Parent::None
                        && !bound.is_in_type_query(e)
                })
                .collect();
            let reads_only_safe_names = |e: ExprId, specifier: Atom| {
                let names: &[&[u8]] = match self.atoms.bytes(specifier) {
                    b"module" | b"node:module" => &SAFE_NODE_MODULE_EXPORTS,
                    b"worker_threads" | b"node:worker_threads" => &SAFE_WORKER_THREADS_EXPORTS,
                    _ => &[],
                };
                let may_bind_create_require =
                    matches!(bound.expr_parent[e.idx()], Parent::VarInit(_))
                        && matches!(self.atoms.bytes(specifier), b"module" | b"node:module");
                let mut reads = Vec::new();
                is_read_only_by_literal_names(
                    module,
                    self.atoms,
                    e,
                    &|_| false,
                    &mut reads,
                    &mut Vec::new(),
                ) && reads.iter().all(|it| {
                    is_one_of(it.0, names)
                        || may_bind_create_require && it.1.is_none() && is(it.0, b"createRequire")
                })
            };
            let is_create_require = |symbol: SymbolId| {
                bound.symbols[symbol.idx()].decls.iter().any(|&decl| match decl {
                    Decl::ImportSpec(spec) => makes_requires(spec),
                    Decl::Var(pat) | Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                        PatParent::Prop(outer, prop) => {
                            let is_the_property = match (hir[prop].key, hir[pat].kind) {
                                (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => is(key, b"createRequire"),
                                _ => false,
                            };
                            is_the_property && matches!(bound.pat_parent[outer.idx()], PatParent::Var(declaration) if required.iter().any(|it| it.0 == hir[declaration].init && matches!(self.atoms.bytes(it.1), b"module" | b"node:module")))
                        }
                        _ => false,
                    },
                    _ => false,
                })
            };
            if !required
                .iter()
                .all(|&(call, specifier)| reads_only_safe_names(call, specifier))
            {
                is_always_safe = false;
            }
            for &e in &identifiers {
                let whole = bound.symbols[bound.expr_symbol[e.idx()].idx()]
                    .decls
                    .iter()
                    .find_map(|&decl| match decl {
                        Decl::ImportDefault(import) | Decl::ImportNamespace(import)
                            if !hir[import].type_only && has_loader_access(hir[import].spec) =>
                        {
                            Some(hir[import].spec)
                        }
                        _ => None,
                    });
                if whole.is_some_and(|specifier| !reads_only_safe_names(e, specifier)) {
                    is_always_safe = false;
                }
            }
            let mut created: Vec<bun_sema::bind::SymbolId> = Vec::new();
            for &e in &identifiers {
                if !is_create_require(bound.expr_symbol[e.idx()]) {
                    continue;
                }
                if called_by(e).is_some_and(|(call, _)| matches!(bound.expr_parent[call.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Dot { obj, name, .. } if obj == call && is(name, b"resolve")))) {
                    continue;
                }
                let holder =
                    called_by(e).and_then(|(call, _)| match bound.expr_parent[call.idx()] {
                        Parent::VarInit(declaration)
                            if matches!(
                                hir[hir[declaration].pat].kind,
                                bun_sema::hir::PatKind::Ident(_)
                            ) && !hir[declaration]
                                .flags
                                .contains(bun_sema::hir::Flags::EXPORT) =>
                        {
                            Some(bound.pat_symbol[hir[declaration].pat.idx()])
                        }
                        _ => None,
                    });
                let is_plain = |holder: bun_sema::bind::SymbolId| {
                    let symbol = &bound.symbols[holder.idx()];
                    symbol.decls.len() == 1
                        && !symbol.flags.intersects(
                            bun_sema::bind::SymFlags::ASSIGNED | bun_sema::bind::SymFlags::MERGED,
                        )
                        && bound.assignments_to(holder).is_empty()
                        && !hir.exports.iter().any(|export| {
                            export.spec.is_none()
                                && export
                                    .items
                                    .iter()
                                    .any(|item| hir[item].local == symbol.name)
                        })
                };
                match holder.filter(|&holder| holder.is_some() && is_plain(holder)) {
                    Some(holder) => created.push(holder),
                    None => is_always_safe = false,
                }
            }
            for &e in &identifiers {
                if !created.contains(&bound.expr_symbol[e.idx()]) {
                    continue;
                }
                let written = called_by(e)
                    .filter(|found| !hir[found.1].args.is_empty())
                    .and_then(|found| match hir[hir.id_at(hir[found.1].args, 0)].kind {
                        ExprKind::String(specifier) => Some(specifier),
                        _ => None,
                    });
                let is_resolve = matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Dot { obj, name, .. } if obj == e && is(name, b"resolve")));
                match written {
                    Some(specifier) => named_via_created_requires.push(specifier),
                    None if is_resolve => {}
                    None => is_always_safe = false,
                }
            }
            if !is_always_safe
                || named_via_created_requires
                    .iter()
                    .any(|&specifier| has_loader_access(specifier))
            {
                loader_entry =
                    loader_entry.or(Some("a module that loads modules or evaluates text"));
                file_loader_entries.push((
                    "a module that loads modules or evaluates text",
                    0,
                    ExprId::NONE,
                ));
            }
        }
        let mut leaks_global_object = false;
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if is_harmless.contains(&e)
                || matches!(expr.kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
                    && is_operand_of_type_query(module, e)
            {
                continue;
            }
            if matches!(expr.kind, ExprKind::ImportCall { args } if !matches!(hir[hir.id_at(args, 0)].kind, ExprKind::String(_)) && cannot_name_builtin_module(module, self.atoms, hir.id_at(args, 0)))
            {
                self.file_loader_entry_sites.push((number, e));
                why_open.push(("import() of a path that is computed", e));
            }
            let found = match expr.kind {
                ExprKind::ImportCall { args }
                    if !matches!(hir[hir.id_at(args, 0)].kind, ExprKind::String(_))
                        && !cannot_name_builtin_module(module, self.atoms, hir.id_at(args, 0)) =>
                {
                    Some("import() of a name that is computed")
                }
                ExprKind::ImportMeta => Some("import.meta"),
                ExprKind::Ident(object)
                    if self.global_objects.contains(&object) && is_free(e) && stays_visible(e) =>
                {
                    None
                }
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(e) => {
                    leaks_global_object = true;
                    Some("the global object")
                }
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => {
                    Some("getBuiltinModule")
                }
                ExprKind::Dot { name, .. } if is(name, b"mainModule") => Some("mainModule"),
                _ => match variable_at(e) {
                    Some(known::require | known::module)
                        if matches!(expr.kind, ExprKind::Ident(_)) && does_not_escape(e) =>
                    {
                        None
                    }
                    Some(known::require) => Some("require"),
                    Some(known::module)
                        if matches!(expr.kind, ExprKind::Ident(_))
                            && self.preserves_source_paths =>
                    {
                        Some("module")
                    }
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
        self.read.extend(read_via_global_object);
        named_at.extend(named_via_global_object);
        for (kind, name, place) in touched.into_iter().chain(touched_via_global_object) {
            named_at.push((place, Name::Member(kind, name)));
            match kind {
                _ if name.is_none() => self.touches_every_member_of[kind] = true,
                GLOBAL_OBJECT => global_names.push(name),
                _ => _ = self.read.insert((kind, name)),
            }
        }
        for listener in listeners {
            let event = match module.bound.expr_parent[listener.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Call(call)
                        if hir[call].callee == listener && !hir[call].args.is_empty() =>
                    {
                        match hir[hir.id_at(hir[call].args, 0)].kind {
                            ExprKind::String(event) => Some(event),
                            _ => None,
                        }
                    }
                    _ => None,
                },
                _ => None,
            };
            match event {
                Some(event) if !is_one_of(event, &EVENTS_OF_THE_GLOBAL_OBJECT) => {
                    self.openings_if_events_are_dispatched.push((
                        number,
                        listener,
                        "addEventListener and dispatchEvent of the global object",
                    ))
                }
                _ => why_open.push(("addEventListener of the global object", listener)),
            }
        }
        for &(name, member) in &names_via_global_object {
            own_functions.add_member(module, name, member);
        }
        for call in hir
            .calls
            .iter()
            .filter(|call| call.args.len() >= 2 && is_define_property(call.callee))
        {
            let receiver = asserted(hir.id_at(call.args, 0));
            if !matches!(hir[receiver].kind, ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(receiver))
            {
                continue;
            }
            let has_only_a_value = call.args.len() == 3
                && matches!(hir[hir.id_at(call.args, 2)].kind, ExprKind::Object(props) if props.iter().all(|prop| matches!(hir[prop].key, PropKey::Name(key) if !is(key, b"get") && !is(key, b"set"))));
            match hir[hir.id_at(call.args, 1)].kind {
                ExprKind::String(name) if has_only_a_value => _ = own_functions.stored.insert(name),
                _ => why_open.push(("an accessor on the global object", receiver)),
            }
        }
        self.stored_on_global_object.extend(own_functions.stored);
        self.called_on_global_object.extend(
            own_functions
                .called
                .into_iter()
                .map(|(name, member)| (number, member, name)),
        );
        if names_via_global_object
            .iter()
            .any(|&(name, _)| is(name, b"addEventListener"))
        {
            why_open.push(("addEventListener of the global object", ExprId::NONE));
        }
        global_names.extend(names_via_global_object.into_iter().map(|read| read.0));
        why_open.extend(file_loader_entries.iter().filter_map(|entry| {
            match (
                entry.0,
                entry
                    .2
                    .some()
                    .map(|evaluator| use_of_evaluator(module, evaluator)),
            ) {
                ("Function", Some(EvaluatorUse::CaughtCalls)) => None,
                ("Function", Some(EvaluatorUse::Calls)) => Some(("a call of Function", entry.2)),
                ("eval", Some(EvaluatorUse::CaughtCalls | EvaluatorUse::Calls)) => {
                    Some(("a call of eval", entry.2))
                }
                _ => Some((entry.0, entry.2)),
            }
        }));
        self.openings
            .extend(why_open.into_iter().map(|(why, at)| (number, at, why)));
        self.global_names.extend(global_names);
        self.named_at.extend(
            named_at
                .into_iter()
                .map(|(place, name)| (number, place, name)),
        );
        self.loader_entry = loader_entry;
        self.loader_entry_sites.extend(
            file_loader_entries
                .iter()
                .map(|loader_entry| (number, loader_entry.2)),
        );
        self.file_loader_entry_sites.extend(
            file_loader_entries
                .iter()
                .map(|loader_entry| (number, loader_entry.2)),
        );
        self.loader_entries
            .extend(
                file_loader_entries
                    .into_iter()
                    .take(4)
                    .map(|(loader_entry, position, _)| {
                        (loader_entry, module.path.text.to_vec(), position)
                    }),
            );
        for specifier in named_via_created_requires {
            self.name(specifier);
        }
        self.leaks_global_object |= leaks_global_object;
        self.listens_for_messages |= listens_for_messages;
    }

    fn reads(&self, global: &[u8], property: &[u8]) -> bool {
        let Some(global) = GLOBALS.iter().position(|it| *it.0 == *global) else {
            return true;
        };
        self.leaks_global_object
            || self.listens_for_messages && global == 0 && property == b"send"
            || self.read.contains(&(global, Atom::NONE))
            || self.touches_every_member_of[global]
            || self
                .atoms
                .lookup(property)
                .is_some_and(|property| self.read.contains(&(global, property)))
    }

    fn fires(&self, trigger: &Trigger) -> bool {
        self.reads(&trigger.global, &trigger.property)
    }

    fn fires_on_literal_name(&self, trigger: &Trigger) -> bool {
        let Some(global) = GLOBALS.iter().position(|it| *it.0 == *trigger.global) else {
            return true;
        };
        self.listens_for_messages && global == 0 && *trigger.property == *b"send"
            || global >= 2 && self.read.contains(&(global, Atom::NONE))
            || self.touches_every_member_of[global]
            || self
                .atoms
                .lookup(&trigger.property)
                .is_some_and(|property| self.read.contains(&(global, property)))
    }

    fn loader_entry(&self) -> Option<&'static str> {
        if self.loader_entry.is_some() {
            return self.loader_entry;
        }
        if self.read.contains(&(0, Atom::NONE)) {
            return Some("process");
        }
        self.reads(b"Bun", b"plugin").then_some("Bun.plugin")
    }
}

fn looked_through<'a, 's>(
    empty: &(dyn Fn() -> Scan<'a, 's> + Sync),
    files: &[(u32, &Module<'_>)],
    in_parallel: crate::InParallel<'_>,
) -> Scan<'a, 's> {
    const FILES_PER_TASK: usize = 64;
    let slices: Vec<&[(u32, &Module<'_>)]> = files.chunks(FILES_PER_TASK).collect();
    let found: Vec<std::sync::OnceLock<Scan<'a, 's>>> =
        slices.iter().map(|_| std::sync::OnceLock::new()).collect();
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

pub(crate) fn find(
    loaded: &[Option<Box<Module<'_>>>],
    atoms: &Interner<'_>,
    is_compiled: &[bool],
    preserves_source_paths: bool,
    in_parallel: crate::InParallel<'_>,
) -> Found {
    let manifest = Archive::embedded().manifest();
    let empty = || Scan::empty(atoms, preserves_source_paths);
    let files: Vec<(u32, &Module<'_>)> = loaded
        .iter()
        .enumerate()
        .zip(is_compiled)
        .filter(|it| *it.1)
        .filter_map(|it| Some((it.0.0 as u32, it.0.1.as_deref()?)))
        .collect();
    let scan = looked_through(&empty, &files, in_parallel);
    let mut program_roots: Vec<u32> = Vec::new();
    let mut roots_without_loader_entries: Vec<u32> = Vec::new();
    let mut why: FxHashMap<u32, InclusionReason> = FxHashMap::default();
    let mut add = |id: u32, reason: InclusionReason| {
        if reason != InclusionReason::Always {
            program_roots.push(id);
        }
        if !matches!(
            reason,
            InclusionReason::Always | InclusionReason::AnyName(_)
        ) {
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
        let Some(alias) = Alias::get(text, bun_ast::Target::Bun, Cfg::default()) else {
            continue;
        };
        match manifest.module_for_loader(alias.path.as_bytes()) {
            Some(id) => add(id, InclusionReason::Named(text.to_vec())),
            None => native.push((
                alias.path.as_bytes().to_vec(),
                manifest
                    .modules()
                    .iter()
                    .find(|module| *module.name == *alias.path.as_bytes())
                    .map(|module| module.id),
            )),
        }
    }
    for trigger in manifest
        .triggers()
        .iter()
        .filter(|trigger| scan.fires(trigger))
    {
        let behind = scan
            .loader_entry()
            .filter(|_| !scan.fires_on_literal_name(trigger));
        for &id in &trigger.modules {
            add(
                id,
                behind.map_or_else(
                    || {
                        InclusionReason::Trigger(
                            [&trigger.global[..], b".", &trigger.property].concat(),
                        )
                    },
                    InclusionReason::AnyName,
                ),
            );
        }
    }
    if let Some(loader_entry) = scan.loader_entry() {
        for module in manifest
            .modules()
            .iter()
            .filter(|module| !module.path.is_empty())
        {
            if module.name.starts_with(b"internal:")
                && !bun_resolve_builtins::expose_internals_enabled()
            {
                continue;
            }
            add(module.id, InclusionReason::AnyName(loader_entry));
        }
    }
    let without_loader_entries: FxHashMap<u32, Reason> = manifest
        .closure(&roots_without_loader_entries, manifest.always_included())
        .into_iter()
        .collect();
    let mut included: Vec<Included> = Vec::new();
    for (id, reason) in manifest.closure(&program_roots, manifest.always_included()) {
        let Some(module) = manifest.module(id) else {
            continue;
        };
        if module.path.is_empty() {
            native.push((module.name.to_vec(), Some(id)));
            continue;
        }
        let is_read_by_dynamic_name = matches!(why.get(&id), Some(InclusionReason::AnyName(_)));
        let loaded_by = match (without_loader_entries.get(&id), reason) {
            (Some(Reason::Root), _) => LoadedBy::NativeCodeOrLiteralName,
            (Some(Reason::RequiredBy(_)), _) if is_read_by_dynamic_name => {
                LoadedBy::RuntimeModulesOrComputedName
            }
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
    let is_plugin_named = atoms
        .lookup(b"plugin")
        .is_some_and(|plugin| scan.read.contains(&(1, plugin)));
    let may_be_sloppy = files
        .iter()
        .filter(|file| file.1.is_commonjs() || file.1.hir.is_js);
    let mut runtime_use = RuntimeUse {
        files_that_may_be_sloppy: may_be_sloppy
            .map(|file| file.1.path.text.to_vec())
            .collect(),
        ..Default::default()
    };
    runtime_use.names_plugin = is_plugin_named;
    runtime_use.runs_in_place = preserves_source_paths;
    let dispatches_events = atoms
        .lookup(b"dispatchEvent")
        .is_some_and(|name| scan.global_names.contains(&name));
    let if_dispatched = scan
        .openings_if_events_are_dispatched
        .iter()
        .filter(|_| dispatches_events);
    let own_calls: Vec<(u32, ExprId, &'static str)> = (scan.called_on_global_object.iter())
        .filter(|call| scan.stored_on_global_object.contains(&call.2))
        .map(|call| {
            (
                call.0,
                call.1,
                "a function of the program's own that is called on the global object",
            )
        })
        .collect();
    runtime_use.openings = scan
        .openings
        .iter()
        .chain(if_dispatched)
        .chain(&own_calls)
        .filter_map(|&(number, at, why)| {
            Some((
                loaded[number as usize].as_deref()?.path.text.to_vec(),
                at,
                why,
            ))
        })
        .collect();
    runtime_use.open_for(
        runtime_use
            .openings
            .iter()
            .map(|opening| (opening.2, opening.0.clone()))
            .collect(),
    );
    runtime_use.native_modules = native
        .iter()
        .map(|module| [b"native ", &module.0[..]].concat())
        .collect();
    runtime_use
        .facts
        .extend_from_slice(&runtime_use.native_modules);
    runtime_use.add_names_of(&scan);
    for of_file in scan.named_at.chunk_by(|one, next| one.0 == next.0) {
        let Some(module) = loaded[of_file[0].0 as usize].as_deref() else {
            continue;
        };
        runtime_use.named_at.push((
            module.path.text.to_vec(),
            of_file.iter().map(|named| (named.1, named.2)).collect(),
        ));
    }
    let loader_entry_sites = if scan.has_unlocated_loader_entry || is_plugin_named {
        Vec::new()
    } else {
        scan.loader_entry_sites
    };
    Found {
        included,
        native,
        loader_entries: scan.loader_entries,
        loader_entry_sites,
        file_loader_entry_sites: scan.file_loader_entry_sites,
        runtime_use,
    }
}

pub(crate) fn add_what_the_loaded_program_shows(
    found: &mut Found,
    program: &Program,
    in_parallel: crate::InParallel<'_>,
) {
    let (atoms, modules) = (&program.files.atoms, &program.files.modules);
    let empty = || Scan::empty(atoms, false);
    let is_reached_without_loader_entries = |module: &Module<'_>| match module.builtin {
        Some(Builtin::Module(_, loaded_by)) => !matches!(
            loaded_by,
            LoadedBy::ComputedName | LoadedBy::RuntimeModulesBehindLoader
        ),
        Some(Builtin::Functions) => true,
        None => false,
    };
    let runtime_sources: Vec<(u32, &Module<'_>)> = modules
        .iter()
        .enumerate()
        .filter(|it| is_reached_without_loader_entries(it.1))
        .map(|it| (it.0 as u32, &**it.1))
        .collect();
    let scanned: Vec<std::sync::OnceLock<RuntimeSource>> = runtime_sources
        .iter()
        .map(|_| std::sync::OnceLock::new())
        .collect();
    in_parallel(runtime_sources.len(), &|index| {
        let (number, module) = runtime_sources[index];
        let mut scan = empty();
        scan.file(number, module);
        let mut of_source = RuntimeUse::default();
        of_source.add_names_of(&scan);
        let named = match module.builtin {
            Some(Builtin::Module(id, _)) => Archive::embedded().manifest().module(id),
            _ => None,
        };
        let name_of_module = named.map(|named| [b"module ", &*named.name].concat());
        of_source.facts.extend(name_of_module.clone());
        let escapes = scan
            .openings
            .iter()
            .filter(|opening| ESCAPES.iter().any(|escape| escape.0 == opening.2))
            .map(|opening| (opening.1, opening.2))
            .collect();
        let named_at = scan
            .named_at
            .iter()
            .map(|named| (named.1, named.2))
            .collect();
        _ = scanned[index].set(RuntimeSource {
            path: module.path.text.to_vec(),
            module: name_of_module,
            facts: of_source.facts,
            named_at,
            escapes,
        });
    });
    found.runtime_use.runtime_sources = scanned
        .into_iter()
        .filter_map(std::sync::OnceLock::into_inner)
        .collect();

    let checker = program.checker();
    let context = empty();
    let mut names: Vec<Atom> = Vec::new();
    let mut read: Vec<(usize, Atom)> = Vec::new();
    let mut touches_every_member_of = [false; GLOBALS.len() + 1];
    for path in std::mem::take(&mut found.runtime_use.files_that_may_be_sloppy) {
        let Some(file) = program.files.by_path.get(&path) else {
            continue;
        };
        let module = program.files.module(file);
        let (hir, bound) = (&module.hir, &module.bound);
        let mut is_sloppy: FxHashMap<FnId, bool> = FxHashMap::default();
        let mut named_through_this: Vec<(ExprId, Name)> = Vec::new();
        for (index, _) in hir
            .exprs
            .iter()
            .enumerate()
            .filter(|it| matches!(it.1.kind, ExprKind::This))
        {
            let this = ExprId::from(index as u32);
            let mut owner = checker
                .enclosing_fn_of_expr(file, this)
                .unwrap_or(FnId::NONE);
            while owner.is_some() && hir[owner].kind == FnKind::Arrow {
                owner = bound.fns[owner.idx()].enclosing;
            }
            if owner.is_none()
                || !*is_sloppy
                    .entry(owner)
                    .or_insert_with(|| checker.is_sloppy_function(file, owner))
            {
                continue;
            }
            match reads_of_global_object(
                module,
                atoms,
                &context.global_objects,
                &context.globals,
                context.get_builtin_module,
                this,
            ) {
                Some((names_of_this, read_of_this, touched_through_this)) => {
                    named_through_this.extend(names_of_this.iter().map(|&(name, member)| {
                        (
                            member.some().unwrap_or(this),
                            Name::Member(GLOBAL_OBJECT, name),
                        )
                    }));
                    named_through_this.extend(
                        read_of_this
                            .iter()
                            .chain(&touched_through_this)
                            .map(|&(kind, name)| (this, Name::Member(kind, name))),
                    );
                    names.extend(names_of_this.into_iter().map(|read| read.0));
                    read.extend(read_of_this);
                    for (kind, name) in touched_through_this {
                        match kind {
                            _ if name.is_none() => touches_every_member_of[kind] = true,
                            GLOBAL_OBJECT => names.push(name),
                            _ => read.push((kind, name)),
                        }
                    }
                }
                None => found.runtime_use.openings.push((
                    path.clone(),
                    this,
                    "this in a function that is not strict",
                )),
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

    let reasons = found
        .runtime_use
        .openings
        .iter()
        .map(|opening| (opening.2, opening.0.clone()))
        .collect();
    found.runtime_use.open_for(reasons);
}

pub(crate) fn keep_what_the_compiled_program_reaches(
    found: &mut Found,
    program: &Program,
    in_parallel: crate::InParallel<'_>,
) {
    let (atoms, files, runtime_use) =
        (&program.files.atoms, &program.files, &mut found.runtime_use);
    runtime_use.uncompiled_runtime_sources = program
        .uncompiled_runtime_sources
        .lock()
        .iter()
        .map(|&file| files.module(file).path.text.to_vec())
        .collect();
    let reached_in = |path: &[u8]| {
        let file = files.by_path.get(path);
        move |place: ExprId| file.is_none_or(|file| is_in_compiled_program(program, file, place))
    };
    let reached = runtime_use
        .openings
        .iter()
        .filter(|opening| reached_in(&opening.0)(opening.1))
        .map(|opening| (opening.2, opening.0.clone()))
        .collect();
    runtime_use.open_for(reached);
    if !files
        .modules
        .iter()
        .any(|module| module.compiled_functions.get().is_some())
    {
        return;
    }
    let mut named: FxHashSet<Name> = FxHashSet::default();
    for (path, named_at) in &runtime_use.named_at {
        let is_reached = reached_in(path);
        named.extend(named_at.iter().filter(|it| is_reached(it.0)).map(|it| it.1));
    }
    for source in &mut runtime_use.runtime_sources {
        let is_reached = reached_in(&source.path);
        named.extend(
            source
                .named_at
                .iter()
                .filter(|it| is_reached(it.0))
                .map(|it| it.1),
        );
        source.escapes.retain(|escape| is_reached(escape.0));
        source.facts = source
            .module
            .iter()
            .filter(|_| is_reached(ExprId::NONE))
            .cloned()
            .collect();
    }
    let is_scanned = |module: &Module<'_>| {
        module.compiled_functions.get().is_some()
            && !matches!(
                module.builtin,
                Some(Builtin::Module(
                    _,
                    LoadedBy::ComputedName | LoadedBy::RuntimeModulesBehindLoader
                ))
            )
    };
    let scanned: Vec<FileId> = (0..files.modules.len())
        .filter(|&file| is_scanned(&files.modules[file]))
        .map(|file| FileId(file as u32))
        .collect();
    const FILES_PER_TASK: usize = 64;
    let slices: Vec<&[FileId]> = scanned.chunks(FILES_PER_TASK).collect();
    let walked: Vec<std::sync::OnceLock<(FxHashSet<Name>, Vec<FileId>)>> =
        slices.iter().map(|_| std::sync::OnceLock::new()).collect();
    in_parallel(slices.len(), &|slice| {
        let mut of_slice: FxHashSet<Name> = FxHashSet::default();
        let mut handing_out_members: Vec<FileId> = Vec::new();
        let mut names: Vec<Atom> = Vec::new();
        for &file in slices[slice] {
            let module = files.module(file);
            let (hir, properties) = (&module.hir, Properties { module, atoms });
            let is_private = |name: Atom| {
                module.builtin.is_some() && name.is_some() && atoms.bytes(name).starts_with(b"$")
            };
            let add = |of_slice: &mut FxHashSet<Name>,
                       handing_out_members: &mut Vec<FileId>,
                       names: &mut Vec<Atom>,
                       parent: Parent,
                       pos: u32| {
                for name in names.drain(..).filter(|&name| !is_private(name)) {
                    let is_known = if name.is_some() {
                        of_slice.contains(&Name::Property(name))
                    } else {
                        handing_out_members.last() == Some(&file)
                    };
                    if is_known || !is_child_in_compiled_program(program, file, parent, pos) {
                        continue;
                    }
                    match name.is_some() {
                        true => _ = of_slice.insert(Name::Property(name)),
                        false => handing_out_members.push(file),
                    }
                }
            };
            for (index, expr) in hir
                .exprs
                .iter()
                .enumerate()
                .filter(|it| module.bound.expr_parent[it.0] != Parent::None)
            {
                let e = ExprId::from(index as u32);
                if let ExprKind::Ident(name) = expr.kind
                    && !of_slice.contains(&Name::Member(GLOBAL_OBJECT, name))
                    && names_global(module, atoms, e, name)
                    && !is_operand_of_type_query(module, e)
                    && is_in_compiled_program(program, file, e)
                {
                    of_slice.insert(Name::Member(GLOBAL_OBJECT, name));
                }
                properties.named_by(e, &mut names);
                add(
                    &mut of_slice,
                    &mut handing_out_members,
                    &mut names,
                    module.bound.expr_parent[index],
                    expr.pos,
                );
            }
            for (index, prop) in hir.pat_props.iter().enumerate().filter(|it| !it.1.is_rest) {
                names.extend(match (prop.key, hir[prop.value].kind) {
                    (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => Some(name),
                    (PropKey::Computed(key), _) => properties.constant_key(key),
                    _ => None,
                });
                add(
                    &mut of_slice,
                    &mut handing_out_members,
                    &mut names,
                    Parent::PatKey(bun_sema::hir::PatPropId::from(index as u32)),
                    prop.pos,
                );
            }
        }
        _ = walked[slice].set((of_slice, handing_out_members));
    });
    let mut reading_any_property: Vec<FileId> = program
        .reads_of_any_property
        .lock()
        .iter()
        .map(|read| read.0)
        .collect();
    for (of_slice, handing_out_members) in walked
        .into_iter()
        .filter_map(std::sync::OnceLock::into_inner)
    {
        named.extend(of_slice);
        reading_any_property.extend(handing_out_members);
    }
    reading_any_property
        .sort_unstable_by_key(|&file| (files.module(file).builtin.is_some(), file.idx()));
    reading_any_property.dedup();
    named.extend(
        reading_any_property
            .first()
            .map(|_| Name::Property(Atom::NONE)),
    );
    runtime_use.reading_any_property = reading_any_property
        .chunk_by(|one, next| {
            files.module(*one).builtin.is_some() == files.module(*next).builtin.is_some()
        })
        .flat_map(|alike| alike.iter().take(PLACES_SHOWN_PER_REASON))
        .map(|&file| files.module(file).path.text.to_vec())
        .collect();
    runtime_use.facts = runtime_use
        .native_modules
        .iter()
        .cloned()
        .chain(named.into_iter().map(|name| name.fact(atoms)))
        .collect();
}
