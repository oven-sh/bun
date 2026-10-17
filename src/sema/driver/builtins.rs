use bun_builtin_syntax::{Archive, Reason, Trigger};
use bun_resolve_builtins::HardcodedModule::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Decl, FnOwner, Parent, PatParent, SymFlags, SymbolId};
use bun_sema::hir::{BinOp, ExprId, ExprKind, Flags, FnBody, PatKind, PropKey, SpecifierKind, StmtKind, UnOp};
use bun_sema::program::{LoadedBy, Module};
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
}

const GLOBALS: [(&[u8], &[&[u8]]); 3] = [(b"process", &[b"process", b"node:process"]), (b"Bun", &[b"bun"]), (b"console", &[])];
const GLOBAL_OBJECTS: [&[u8]; 4] = [b"globalThis", b"global", b"self", b"window"];
const SAFE_REQUIRE_PROPERTIES: [&[u8]; 4] = [b"resolve", b"cache", b"main", b"extensions"];
const OF_MODULE: [&[u8]; 7] = [b"exports", b"id", b"filename", b"path", b"paths", b"loaded", b"constructor"];
const SAFE_IMPORT_META_PROPERTIES: [&[u8]; 9] = [b"url", b"dir", b"dirname", b"file", b"filename", b"path", b"main", b"env", b"resolve"];
const LISTENS: [&[u8]; 5] = [b"on", b"once", b"addListener", b"prependListener", b"prependOnceListener"];
const MODULES_WITH_LOADER_ACCESS: [&[u8]; 8] = [b"module", b"node:module", b"vm", b"node:vm", b"repl", b"node:repl", b"worker_threads", b"node:worker_threads"];
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

const NATIVE_FUNCTIONS: [&[u8]; 9] = [b"queueMicrotask", b"setTimeout", b"setInterval", b"setImmediate", b"clearTimeout", b"clearInterval", b"clearImmediate", b"fetch", b"structuredClone"];

fn is_read_only_by_literal_names(module: &Module<'_>, atoms: &Interner<'_>, start: ExprId, is_itself: &dyn Fn(Atom) -> bool, reads: &mut Vec<(Atom, ExprId)>) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_receiver_of_native_function = |call: bun_sema::hir::CallId, e: ExprId| {
        !hir[call].args.is_empty()
            && hir.id_at(hir[call].args, 0) == e
            && matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, name, .. } if matches!(atoms.bytes(name), b"bind" | b"call" | b"apply")
                && matches!(hir[obj].kind, ExprKind::Ident(function) if bound.expr_symbol[obj.idx()].is_none() && NATIVE_FUNCTIONS.contains(&atoms.bytes(function))))
    };
    let initializer_of_constant = |e: ExprId| {
        let symbol = bound.expr_symbol[e.idx()];
        if symbol.is_none() || bound.symbols[symbol.idx()].flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED) || !bound.assignments_to(symbol).is_empty() {
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
    let is_symbol = |key: ExprId| creates_symbol(key) || matches!(hir[key].kind, ExprKind::Ident(_)) && initializer_of_constant(key).is_some_and(|created| creates_symbol(created));
    let is_stored_to = |member: ExprId| matches!(bound.expr_parent[member.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Assign { op: None, target, .. } if target == member));
    let receives_property = |call: bun_sema::hir::CallId, e: ExprId| {
        !hir[call].args.is_empty()
            && hir.id_at(hir[call].args, 0) == e
            && matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, name, .. } if atoms.bytes(name) == b"defineProperty" && matches!(hir[obj].kind, ExprKind::Ident(object) if atoms.bytes(object) == b"Object" && bound.expr_symbol[obj.idx()].is_none()))
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
                [Decl::Fn(function)] => function,
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
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, .. } | ExprKind::Cond { .. } | ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) => pending.push(around),
                ExprKind::Dot { obj, name, .. } if obj == e && is_itself(name) => pending.push(around),
                ExprKind::Dot { obj, name, .. } if obj == e => reads.push((name, around)),
                ExprKind::Index { obj, index, .. } if obj == e => match hir[index].kind {
                    ExprKind::String(name) if is_itself(name) => pending.push(around),
                    ExprKind::String(name) => reads.push((name, around)),
                    _ if is_stored_to(around) || is_symbol(index) => {}
                    _ => return false,
                },
                ExprKind::Assign { target, .. } if target == e => {}
                ExprKind::Assign { op: None, target, value } if value == e && matches!(hir[target].kind, ExprKind::Ident(_)) => {
                    holder = bound.expr_symbol[target.idx()];
                    if holder.is_none() {
                        return false;
                    }
                    pending.push(around);
                }
                ExprKind::Call(call) if is_receiver_of_native_function(call, e) => {}
                ExprKind::Call(call) if receives_property(call, e) => {
                    if hir[call].args.len() < 2 {
                        return false;
                    }
                    let key = hir.id_at(hir[call].args, 1);
                    match hir[key].kind {
                        ExprKind::String(name) if !is_itself(name) => reads.push((name, ExprId::NONE)),
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
                    Decl::Param(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Param(parameter) if !mentions_arguments(bound.param_fn[parameter.idx()])),
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
    let is_stored_once = |symbol: SymbolId| symbol.is_some() && bound.symbols[symbol.idx()].decls.len() == 1 && !bound.symbols[symbol.idx()].flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED) && bound.assignments_to(symbol).is_empty();
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
        let is_constant = symbol.is_some() && !bound.symbols[symbol.idx()].flags.intersects(bun_sema::bind::SymFlags::ASSIGNED | bun_sema::bind::SymFlags::MERGED) && bound.assignments_to(symbol).is_empty();
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
}

impl Scan<'_, '_> {
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
    }

    fn module_global(&self, specifier: Atom) -> Option<usize> {
        let text = self.atoms.bytes(specifier);
        GLOBALS.iter().position(|global| global.1.contains(&text))
    }

    fn file(&mut self, number: u32, module: &Module<'_>) {
        let hir = &module.hir;
        let is_free = |e: ExprId| {
            let symbol = module.bound.expr_symbol[e.idx()];
            symbol.is_none()
                || !module.bound.symbols[symbol.idx()].decls.iter().any(|&decl| match decl {
                    Decl::Fn(f) => !matches!(hir[f].body, FnBody::None),
                    Decl::Var(_) | Decl::Class(_) | Decl::Module(_) | Decl::Enum(_) => !hir.is_ambient(hir.node(decl)),
                    Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) | Decl::CommonJsVariable => false,
                    _ => true,
                })
        };
        let mut aliases: Vec<(Atom, usize)> = Vec::new();
        for import in hir.imports.iter().filter(|import| !import.type_only) {
            let Some(global) = self.module_global(import.spec) else { continue };
            aliases.extend([import.default, import.namespace].into_iter().filter(|name| name.is_some()).map(|name| (name, global)));
            for spec in import.named.iter().map(|spec| &hir[spec]).filter(|spec| !spec.type_only) {
                self.read.insert((global, spec.imported));
            }
        }
        for used in hir.specifier_uses.iter() {
            let mut imports = hir.imports.iter().filter(|import| import.spec == used.spec).peekable();
            let is_only_for_types = used.kind == SpecifierKind::ImportType
                || used.kind == SpecifierKind::Import && imports.peek().is_some() && imports.all(|import| import.type_only);
            if is_only_for_types {
                continue;
            }
            self.name(used.spec);
            if used.kind != SpecifierKind::Import
                && used.kind != SpecifierKind::SideEffect
                && used.kind != SpecifierKind::RequireCall
                && let Some(global) = self.module_global(used.spec)
            {
                self.read.insert((global, Atom::NONE));
                self.has_unlocated_loader_entry = true;
                self.file_loader_entry_sites.push((number, ExprId::NONE));
            }
        }
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            let ExprKind::String(specifier) = hir[hir.id_at(call.args, 0)].kind else { continue };
            match hir[call.callee].kind {
                ExprKind::Ident(known::require) if call.args.len() == 1 => self.name(specifier),
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => self.name(specifier),
                ExprKind::Dot { obj, name: known::require, .. } if call.args.len() == 1 && matches!(hir[obj].kind, ExprKind::Ident(known::module)) => self.name(specifier),
                _ => {}
            }
        }
        let global_at = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) => match self.globals.iter().position(|&global| global == Some(name)) {
                Some(global) if is_free(e) => Some(global),
                _ => aliases.iter().find(|alias| alias.0 == name).map(|alias| alias.1),
            },
            ExprKind::Dot { obj, name, .. } => match hir[obj].kind {
                ExprKind::Ident(object) if self.global_objects.contains(&object) && is_free(obj) => self.globals.iter().position(|&global| global == Some(name)),
                _ => None,
            },
            ExprKind::Call(call) if hir[call].args.len() == 1 && matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) => match hir[hir.id_at(hir[call].args, 0)].kind {
                ExprKind::String(specifier) => GLOBALS.iter().position(|global| global.1.contains(&self.atoms.bytes(specifier))),
                _ => None,
            },
            _ => None,
        };
        let asserted = |mut e: ExprId| loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => e = expr,
                _ => return e,
            }
        };
        let mut is_only_read: FxHashSet<ExprId> = FxHashSet::default();
        let mut read: Vec<(usize, Atom)> = Vec::new();
        let mut mentions: Vec<(ExprId, usize)> = Vec::new();
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if let Some(global) = global_at(e) {
                mentions.push((e, global));
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
            if let Some(global) = global_at(obj) {
                is_only_read.insert(obj);
                if name.is_some() {
                    read.push((global, name));
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
            if let Some(names) = names.filter(|names| !names.iter().any(|&name| loads_modules(name))) {
                is_only_read.insert(destructured);
                read.extend(names.into_iter().map(|name| (global, name)));
            }
        }
        let loads_modules = |name: Atom| Some(name) == self.get_builtin_module || self.atoms.bytes(name) == b"mainModule";
        let mut listens_under_alias = false;
        let mut file_loader_entries: Vec<(&'static str, u32, ExprId)> = Vec::new();
        for (mention, global) in mentions.into_iter().filter(|mention| !is_only_read.contains(&mention.0)) {
            let mut reads = Vec::new();
            if is_read_only_by_literal_names(module, self.atoms, mention, &|_| false, &mut reads) && !reads.iter().any(|it| loads_modules(it.0)) {
                listens_under_alias |= global == 0 && reads.iter().any(|it| LISTENS.contains(&self.atoms.bytes(it.0)));
                read.extend(reads.into_iter().map(|it| (global, it.0)));
            } else {
                read.push((global, Atom::NONE));
                if global < 2 {
                    file_loader_entries.push((if global == 0 { "process" } else { "Bun" }, hir[mention].pos, mention));
                }
            }
        }
        self.read.extend(read);

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
        let mut listens_for_messages = listens_under_alias;
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            if let ExprKind::Dot { obj, name, .. } = hir[call.callee].kind
                && global_at(asserted(obj)) == Some(0)
                && is_one_of(name, &LISTENS)
                && !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(event) if !is(event, b"message"))
            {
                listens_for_messages = true;
            }
            if matches!(hir[call.callee].kind, ExprKind::Ident(known::require)) && cannot_name_builtin_module(module, self.atoms, hir.id_at(call.args, 0)) {
                is_harmless.insert(call.callee);
                if !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(_)) && is_free(call.callee) {
                    self.file_loader_entry_sites.push((number, call.callee));
                }
            }
            if let ExprKind::String(_) = hir[hir.id_at(call.args, 0)].kind {
                match hir[call.callee].kind {
                    ExprKind::Ident(known::require) => _ = is_harmless.insert(call.callee),
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
            let may_be_read = match hir[obj].kind {
                ExprKind::ImportMeta => is_one_of(name, &SAFE_IMPORT_META_PROPERTIES),
                ExprKind::Ident(known::require) => is_one_of(name, &SAFE_REQUIRE_PROPERTIES),
                ExprKind::Ident(known::module) => is_one_of(name, &OF_MODULE) || is(name, b"hot") || (is(name, b"parent") || is(name, b"children")) && does_not_escape(ExprId::from(index as u32)),
                ExprKind::Ident(object) if self.global_objects.contains(&object) => true,
                _ => variable_at(obj) == Some(known::Function),
            };
            if may_be_read {
                is_harmless.insert(obj);
            }
        }
        let mut read_via_global_object: Vec<(usize, Atom)> = Vec::new();
        let mut stays_visible = |e: ExprId| {
            let is_global_object = |name: Atom| self.global_objects.contains(&name);
            let mut reads = Vec::new();
            if !is_read_only_by_literal_names(module, self.atoms, e, &is_global_object, &mut reads) {
                return false;
            }
            let mut found = Vec::new();
            for (name, member) in reads {
                if matches!(name, known::require | known::module | known::eval | known::Function) || is(name, b"Worker") || is(name, b"ShadowRealm") {
                    return false;
                }
                let Some(global) = self.globals.iter().position(|&global| global == Some(name)) else { continue };
                let mut of_global = Vec::new();
                if member.is_none() || !is_read_only_by_literal_names(module, self.atoms, member, &|_| false, &mut of_global) || of_global.iter().any(|it| Some(it.0) == self.get_builtin_module || is(it.0, b"mainModule") || is_one_of(it.0, &LISTENS)) {
                    return false;
                }
                found.extend(of_global.into_iter().map(|it| (global, it.0)));
            }
            read_via_global_object.extend(found);
            true
        };
        for (index, expr) in hir.exprs.iter().enumerate() {
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
                named_via_created_requires.extend(handed);
            }
        }
        let is_loaded_by_call = hir.calls.iter().filter(|call| !call.args.is_empty()).any(|call| {
            let ExprKind::String(specifier) = hir[hir.id_at(call.args, 0)].kind else { return false };
            let loads = match hir[call.callee].kind {
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => true,
                ExprKind::Dot { obj, name: known::require, .. } => matches!(hir[obj].kind, ExprKind::Ident(known::module)),
                _ => false,
            };
            loads && has_loader_access(specifier)
        });
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
        if is_loaded_by_call || !required.is_empty() || hir.specifier_uses.iter().any(|used| has_loader_access(used.spec)) {
            let bound = &module.bound;
            let makes_requires = |spec: bun_sema::hir::ImportSpecId| {
                let from = hir[hir[spec].import].spec;
                from.is_some() && is(hir[spec].imported, b"createRequire") && matches!(self.atoms.bytes(from), b"module" | b"node:module")
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
                && hir.imports.iter().filter(|import| !import.type_only && has_loader_access(import.spec)).all(|import| import.named.iter().all(|spec| is_safe_name(spec)));
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
                    b"module" | b"node:module" => &SAFE_NODE_MODULE_EXPORTS,
                    b"worker_threads" | b"node:worker_threads" => &SAFE_WORKER_THREADS_EXPORTS,
                    _ => &[],
                };
                let may_bind_create_require = matches!(bound.expr_parent[e.idx()], Parent::VarInit(_)) && matches!(self.atoms.bytes(specifier), b"module" | b"node:module");
                let mut reads = Vec::new();
                is_read_only_by_literal_names(module, self.atoms, e, &|_| false, &mut reads) && reads.iter().all(|it| is_one_of(it.0, names) || may_bind_create_require && it.1.is_none() && is(it.0, b"createRequire"))
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
            let mut created: Vec<bun_sema::bind::SymbolId> = Vec::new();
            for &e in &identifiers {
                if !is_create_require(bound.expr_symbol[e.idx()]) {
                    continue;
                }
                if called_by(e).is_some_and(|(call, _)| matches!(bound.expr_parent[call.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Dot { obj, name, .. } if obj == call && is(name, b"resolve")))) {
                    continue;
                }
                let holder = called_by(e).and_then(|(call, _)| match bound.expr_parent[call.idx()] {
                    Parent::VarInit(declaration) if matches!(hir[hir[declaration].pat].kind, bun_sema::hir::PatKind::Ident(_)) && !hir[declaration].flags.contains(bun_sema::hir::Flags::EXPORT) => Some(bound.pat_symbol[hir[declaration].pat.idx()]),
                    _ => None,
                });
                let is_plain = |holder: bun_sema::bind::SymbolId| {
                    let symbol = &bound.symbols[holder.idx()];
                    symbol.decls.len() == 1
                        && !symbol.flags.intersects(bun_sema::bind::SymFlags::ASSIGNED | bun_sema::bind::SymFlags::MERGED)
                        && bound.assignments_to(holder).is_empty()
                        && !hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name))
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
                let written = called_by(e).filter(|found| !hir[found.1].args.is_empty()).and_then(|found| match hir[hir.id_at(hir[found.1].args, 0)].kind {
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
            if !is_always_safe || named_via_created_requires.iter().any(|&specifier| has_loader_access(specifier)) {
                loader_entry = loader_entry.or(Some("a module that loads modules or evaluates text"));
                file_loader_entries.push(("a module that loads modules or evaluates text", 0, ExprId::NONE));
            }
        }
        let mut leaks_global_object = false;
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if is_harmless.contains(&e) {
                continue;
            }
            if matches!(expr.kind, ExprKind::ImportCall { args } if !matches!(hir[hir.id_at(args, 0)].kind, ExprKind::String(_)) && cannot_name_builtin_module(module, self.atoms, hir.id_at(args, 0))) {
                self.file_loader_entry_sites.push((number, e));
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
        self.loader_entry = loader_entry;
        self.loader_entry_sites.extend(file_loader_entries.iter().map(|loader_entry| (number, loader_entry.2)));
        self.file_loader_entry_sites.extend(file_loader_entries.iter().map(|loader_entry| (number, loader_entry.2)));
        self.loader_entries.extend(file_loader_entries.into_iter().take(4).map(|(loader_entry, position, _)| (loader_entry, module.path.text.to_vec(), position)));
        for specifier in named_via_created_requires {
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
            || self.atoms.lookup(property).is_some_and(|property| self.read.contains(&(global, property)))
    }

    fn fires(&self, trigger: &Trigger) -> bool {
        self.reads(&trigger.global, &trigger.property)
    }

    fn fires_on_literal_name(&self, trigger: &Trigger) -> bool {
        let Some(global) = GLOBALS.iter().position(|it| *it.0 == *trigger.global) else { return true };
        self.listens_for_messages && global == 0 && *trigger.property == *b"send"
            || global >= 2 && self.read.contains(&(global, Atom::NONE))
            || self.atoms.lookup(&trigger.property).is_some_and(|property| self.read.contains(&(global, property)))
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
    let empty = || Scan {
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
    };
    let files: Vec<(u32, &Module<'_>)> = loaded.iter().enumerate().zip(is_compiled).filter(|it| *it.1).filter_map(|it| Some((it.0.0 as u32, it.0.1.as_deref()?))).collect();
    let scan = looked_through(&empty, &files, in_parallel);
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
        let loaded_by = match (without_loader_entries.get(&id), reason) {
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
    let is_plugin_named = atoms.lookup(b"plugin").is_some_and(|plugin| scan.read.contains(&(1, plugin)));
    let loader_entry_sites = if scan.has_unlocated_loader_entry || is_plugin_named { Vec::new() } else { scan.loader_entry_sites };
    Found { included, native, loader_entries: scan.loader_entries, loader_entry_sites, file_loader_entry_sites: scan.file_loader_entry_sites }
}
