use super::alternatives::names_own_url;
use super::call_sites::{follow_initialized_bindings, is_free_common_js, is_free_name};
use super::changed_files::{
    TextsOfFile, find_constant, is_bun_function, is_fs_function, opens_for_reading_only,
    skip_to_called,
};
use super::parameters::is_exported;
use super::{NamedPath, ScanInputs};
use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingInitializer, CommonJsVariable, Parent, SymbolId};
use crate::fold::{Constant, FoldedValue, Passes, find_members_below_module};
use crate::hir::{BinOp, CallId, ExprId, ExprKind, MemberKey, PatKind, PropKey, StmtKind};
use crate::util::{FxHashMap, FxHashSet, SharedSort};
use bun_core::strings;

const LONGEST_CHAIN: usize = 6;

#[derive(Copy, Clone)]
pub(super) struct Candidate {
    pub(super) operand: ExprId,
    callee: Option<ExprId>,
    is_named_by_arguments: bool,
    is_needed_on_disk: bool,
}

impl Candidate {
    pub(super) fn find_argument(&self) -> Option<(ExprId, Option<ExprId>)> {
        let is_argument = !self.is_named_by_arguments && !self.is_needed_on_disk;
        is_argument.then_some((self.operand, self.callee))
    }
}

pub(super) fn collect_candidates(
    inputs: &ScanInputs<'_, '_>,
    e: ExprId,
    candidates: &mut Vec<Candidate>,
    created: &mut Vec<ExprId>,
) {
    let hir = inputs.hir;
    let mut add = |operand: ExprId, callee: Option<ExprId>| {
        candidates.push(Candidate {
            operand,
            callee,
            is_named_by_arguments: false,
            is_needed_on_disk: false,
        });
    };
    let call = match hir[e].kind {
        ExprKind::Call(call) | ExprKind::New(call) => hir[call],
        ExprKind::TaggedTemplate(call) => {
            let call = hir[call];
            let callee = skip_to_called(hir, call.callee);
            let mut operands = hir.ids(call.args);
            if operands.any(|it| leads_to_own_folder(inputs, it, LONGEST_CHAIN))
                && is_shell(inputs, callee)
            {
                add_operands_needed_on_disk(inputs, callee, hir.ids(call.args), candidates);
            }
            return;
        }
        ExprKind::Dot { name, .. } if !is_own_path_name(name) => return,
        ExprKind::Ident(_)
        | ExprKind::Dot { .. }
        | ExprKind::Template { .. }
        | ExprKind::Binary { op: BinOp::Add, .. } => {
            if is_handed_on(inputs, e) && leads_to_own_folder(inputs, e, LONGEST_CHAIN) {
                add(e, None);
            }
            return;
        }
        _ => return,
    };
    let mut names_own_folder = false;
    for argument in hir.ids(call.args) {
        names_own_folder |= leads_to_own_folder(inputs, argument, LONGEST_CHAIN);
    }
    if !names_own_folder && !leads_to_own_folder(inputs, e, LONGEST_CHAIN) {
        return;
    }
    let callee = skip_to_called(hir, hir.skip_type_assertions(call.callee));
    if is_path_function(inputs, callee) {
        if is_handed_on(inputs, e) {
            add(e, None);
        }
        return;
    }
    if needs_paths_on_disk(inputs, callee) {
        add_operands_needed_on_disk(inputs, callee, hir.ids(call.args), candidates);
        return;
    }
    if matches!(hir[e].kind, ExprKind::New(_))
        && names_function_of(inputs, callee, &[b"node:sqlite"])
        && opens_for_reading_only(inputs, hir.ids(call.args).nth(1))
    {
        let path = hir.ids(call.args).take(1);
        add_operands_needed_on_disk(inputs, callee, path, candidates);
        return;
    }
    if matches!(hir[e].kind, ExprKind::New(_))
        && names_function_of(inputs, callee, &MODULES_OF_DATABASES)
        && !opens_for_reading_only(inputs, hir.ids(call.args).nth(1))
    {
        created.extend(hir.ids(call.args).next());
    }
    for argument in hir.ids(call.args) {
        if leads_to_own_folder(inputs, argument, LONGEST_CHAIN) {
            add(argument, Some(callee));
        }
    }
    if names_own_folder {
        candidates.push(Candidate {
            operand: e,
            callee: Some(callee),
            is_named_by_arguments: true,
            is_needed_on_disk: false,
        });
    }
}

fn is_own_path_name(name: Atom) -> bool {
    matches!(
        name,
        known::meta_dir | known::meta_dirname | known::meta_filename | known::path | known::url
    )
}

fn add_operands_needed_on_disk(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    operands: impl Iterator<Item = ExprId>,
    candidates: &mut Vec<Candidate>,
) {
    let own = operands.filter(|&it| leads_to_own_folder(inputs, it, LONGEST_CHAIN));
    candidates.extend(own.map(|operand| Candidate {
        operand,
        callee: Some(callee),
        is_named_by_arguments: false,
        is_needed_on_disk: true,
    }));
}

pub(super) fn find_database_read(inputs: &ScanInputs<'_, '_>, e: ExprId) -> Option<ExprId> {
    let hir = inputs.hir;
    let ExprKind::New(call) = hir[e].kind else {
        return None;
    };
    let mut arguments = hir.ids(hir[call].args);
    let path = arguments.next()?;
    let reads_alone = opens_for_reading_only(inputs, arguments.next());
    let callee = hir.skip_type_assertions(hir[call].callee);
    (reads_alone && names_function_of(inputs, callee, &[b"bun:sqlite"])).then_some(path)
}

fn is_handed_on(inputs: &ScanInputs<'_, '_>, e: ExprId) -> bool {
    let &ScanInputs { hir, bound, .. } = inputs;
    let mut e = e;
    for _ in 0..LONGEST_CHAIN {
        let above = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                return matches!(hir[pattern].kind, PatKind::Ident(_))
                    && matches!(bound.initialized_binding(pattern), Binding::Symbol(symbol)
                        if is_exported(hir, bound, symbol));
            }
            Parent::Stmt(statement) => {
                return matches!(hir[statement].kind, StmtKind::Return(_));
            }
            Parent::None => return false,
            _ => return true,
        };
        match hir[above].kind {
            ExprKind::Array(_) => return true,
            ExprKind::Assign {
                op: None, value, ..
            } => return value == e,
            ExprKind::Cond { .. }
            | ExprKind::Binary {
                op: BinOp::Or | BinOp::And | BinOp::Nullish,
                ..
            } => e = above,
            _ if hir.type_assertion_operand(above).is_some() => e = above,
            _ => return false,
        }
    }
    true
}

pub(super) fn find_named_paths(
    inputs: &ScanInputs<'_, '_>,
    texts: &TextsOfFile<'_, '_>,
    candidate: Candidate,
    named: &mut Vec<NamedPath>,
) {
    let receiver = match candidate.is_named_by_arguments {
        true => None,
        false => find_receiver(inputs, candidate),
    };
    let is_passed_to_package =
        receiver.is_some_and(|it| comes_from_package(inputs, it, LONGEST_CHAIN));
    let is_needed_on_disk =
        candidate.is_needed_on_disk || receiver.is_some_and(|it| needs_paths_on_disk(inputs, it));
    let becomes_working_folder = is_needed_on_disk && becomes_working_folder(inputs, candidate);
    let mut add = |operand: ExprId, path: Atom| {
        named.push(NamedPath {
            operand,
            callee: candidate.callee,
            path,
            is_passed_to_package,
            is_needed_on_disk,
            becomes_working_folder,
        });
    };
    if !candidate.is_named_by_arguments {
        let paths = match becomes_working_folder {
            true => texts.find_module_relative_reads(candidate.operand).paths,
            false => texts.find_files_named(candidate.operand),
        };
        for path in paths {
            add(candidate.operand, path);
        }
        return;
    }
    let hir = inputs.hir;
    let (ExprKind::Call(call) | ExprKind::New(call)) = hir[candidate.operand].kind else {
        return;
    };
    let mut folders: Vec<Vec<u8>> = Vec::new();
    let mut below: Vec<u8> = Vec::new();
    for argument in hir.ids(hir[call].args) {
        let argument = hir.skip_type_assertions(argument);
        if matches!(hir[argument].kind, ExprKind::Spread(_)) {
            return;
        }
        if let Some(text) = find_text(inputs, argument) {
            if !is_relative_path(text) || below.len() + text.len() > LONGEST_PATH {
                continue;
            }
            if !below.is_empty() {
                below.push(b'/');
            }
            below.extend_from_slice(text);
        } else if folders.is_empty() && leads_to_own_folder(inputs, argument, LONGEST_CHAIN) {
            let source = follow_initialized_bindings(hir, inputs.bound, argument, argument);
            match names_own_url(hir, inputs.bound, source) {
                true => folders.push(b".".to_vec()),
                false => {
                    let found = texts.find_module_relative_reads(argument).paths.into_iter();
                    folders.extend(found.map(|it| inputs.atoms.bytes(it).to_vec()));
                }
            }
        }
    }
    if below.is_empty() {
        return;
    }
    for folder in folders {
        let path = [&folder[..], b"/", &below].concat();
        add(candidate.operand, inputs.atoms.intern(&path));
    }
}

pub(super) fn add_forwarding_functions(
    inputs: &ScanInputs<'_, '_>,
    texts: &TextsOfFile<'_, '_>,
    reading: &mut Vec<SymbolId>,
) {
    let &ScanInputs { hir, bound, .. } = inputs;
    let mut calls: FxHashMap<SymbolId, Vec<CallId>> = FxHashMap::default();
    for written in hir.exprs.iter() {
        let ExprKind::Call(call) = written.kind else {
            continue;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        if let (ExprKind::Ident(_), Binding::Symbol(function)) =
            (hir[callee].kind, bound.binding(callee))
        {
            calls.entry(function).or_default().push(call);
        }
    }
    let mut known: FxHashSet<SymbolId> = reading.iter().copied().collect();
    let mut pending = reading.clone();
    while let Some(function) = pending.pop() {
        for &call in calls.get(&function).into_iter().flatten() {
            for argument in hir.ids(hir[call].args) {
                let open = texts.find_module_relative_reads(argument).open_parameters;
                let functions = open.into_iter().filter_map(|it| texts.find_function_of(it));
                pending.extend(functions.filter(|it| known.insert(*it)));
            }
        }
    }
    *reading = known.into_iter().collect();
    reading.shared_sort_unstable();
}

const LONGEST_PATH: usize = 512;

fn find_text<'a>(inputs: &ScanInputs<'a, '_>, e: ExprId) -> Option<&'a [u8]> {
    match inputs.decisions.constant(inputs.hir, e) {
        FoldedValue::Constant(Constant::String(text))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => {
            Some(inputs.atoms.bytes(text))
        }
        _ => None,
    }
}

pub(super) fn is_relative_path(text: &[u8]) -> bool {
    let is_unusual = |&byte: &u8| byte < b' ' || b"*?#<>|\"".contains(&byte);
    !text.is_empty()
        && text[0] != b'/'
        && !strings::contains(text, b"://")
        && !text.iter().any(is_unusual)
}

const MODULES_OF_PATHS: [&[u8]; 6] = [
    b"path",
    b"node:path",
    b"path/posix",
    b"node:path/posix",
    b"url",
    b"node:url",
];

const MODULES_OF_PROCESSES: [&[u8]; 2] = [b"child_process", b"node:child_process"];

const MODULES_OF_PROMISES: [&[u8]; 2] = [b"util", b"node:util"];

const MODULES_OF_DATABASES: [&[u8]; 2] = [b"bun:sqlite", b"node:sqlite"];

pub(super) fn find_paths_created(
    inputs: &ScanInputs<'_, '_>,
    texts: &TextsOfFile<'_, '_>,
    operand: ExprId,
    created: &mut Vec<Atom>,
) {
    let hir = inputs.hir;
    if !leads_to_own_folder(inputs, operand, LONGEST_CHAIN) {
        return;
    }
    let paths = texts.find_files_named(operand);
    if !paths.is_empty() {
        created.extend(paths);
        return;
    }
    let written = follow_initialized_bindings(hir, inputs.bound, operand, operand);
    let ExprKind::Call(call) = hir[hir.skip_type_assertions(written)].kind else {
        return;
    };
    let mut arguments = hir.ids(hir[call].args);
    let Some(first) = arguments.next() else {
        return;
    };
    let known = arguments.map_while(|it| find_text(inputs, hir.skip_type_assertions(it)));
    let below: Vec<&[u8]> = known.filter(|text| is_relative_path(text)).collect();
    for folder in texts.find_module_relative_reads(first).paths {
        let folder = inputs.atoms.bytes(folder);
        if folder != b"." || !below.is_empty() {
            let path = [&[folder][..], &below[..]].concat().join(&b"/"[..]);
            created.push(inputs.atoms.intern(&path));
        }
    }
}

fn find_receiver(inputs: &ScanInputs<'_, '_>, candidate: Candidate) -> Option<ExprId> {
    let &ScanInputs { hir, bound, .. } = inputs;
    if candidate.callee.is_some() {
        return candidate.callee;
    }
    let mut e = candidate.operand;
    for _ in 0..LONGEST_CHAIN {
        e = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::Prop(property) => bound.prop_owner[property.idx()],
            _ => return None,
        };
        match hir[e].kind {
            ExprKind::Call(call) | ExprKind::New(call) => return Some(hir[call].callee),
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Spread(_)
            | ExprKind::Cond { .. }
            | ExprKind::Binary {
                op: BinOp::Or | BinOp::And | BinOp::Nullish,
                ..
            } => {}
            _ if hir.type_assertion_operand(e).is_some() => {}
            _ => return None,
        }
    }
    None
}

fn starts_process(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> bool {
    let &ScanInputs { hir, bound, .. } = inputs;
    let callee = skip_to_called(hir, hir.skip_type_assertions(callee));
    if names_function_of(inputs, callee, &MODULES_OF_PROCESSES)
        || is_bun_function(inputs, callee, &[b"spawn", b"spawnSync"])
    {
        return true;
    }
    let made = follow_initialized_bindings(hir, bound, callee, callee);
    let ExprKind::Call(call) = hir[hir.skip_type_assertions(made)].kind else {
        return false;
    };
    let call = hir[call];
    let maker = skip_to_called(hir, hir.skip_type_assertions(call.callee));
    names_function_of(inputs, maker, &MODULES_OF_PROMISES)
        && (hir.ids(call.args).next())
            .is_some_and(|it| names_function_of(inputs, it, &MODULES_OF_PROCESSES))
}

fn becomes_working_folder(inputs: &ScanInputs<'_, '_>, candidate: Candidate) -> bool {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    if let Some(callee) = candidate.callee {
        return find_shell_command(inputs, callee).is_some();
    }
    let mut e = candidate.operand;
    for _ in 0..LONGEST_CHAIN {
        e = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::Prop(property) => {
                return matches!(hir.runtime_property_key(property), PropKey::Name(name)
                    if atoms.bytes(name) == b"cwd");
            }
            _ => return false,
        };
        if matches!(
            hir[e].kind,
            ExprKind::Array(_) | ExprKind::Call(_) | ExprKind::New(_)
        ) {
            return false;
        }
    }
    false
}

fn is_shell(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> bool {
    is_bun_function(inputs, callee, &[b"$"])
}

fn find_shell_command(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> Option<ExprId> {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let (command, MemberKey::Name(method)) = hir.member_key(callee)? else {
        return None;
    };
    let command = hir.skip_type_assertions(command);
    let ExprKind::TaggedTemplate(call) = hir[command].kind else {
        return None;
    };
    let is_command =
        atoms.bytes(method) == b"cwd" && is_shell(inputs, skip_to_called(hir, hir[call].callee));
    is_command.then_some(command)
}

fn needs_paths_on_disk(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> bool {
    let hir = inputs.hir;
    let called = skip_to_called(hir, hir.skip_type_assertions(callee));
    starts_process(inputs, callee)
        || is_bun_function(inputs, called, &[b"build"])
        || is_fs_function(inputs, called, &[b"watch"])
        || find_shell_command(inputs, called).is_some()
}

fn comes_from_package(inputs: &ScanInputs<'_, '_>, e: ExprId, steps_left: usize) -> bool {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let e = skip_to_called(hir, hir.skip_type_assertions(e));
    let Some(steps_left) = steps_left.checked_sub(1) else {
        return false;
    };
    let is_package = |specifier: Atom| names_package(atoms.bytes(specifier));
    let find_constant = |e| find_constant(inputs, e);
    let passes = Passes {
        awaited_imports: true,
        wrappers: true,
    };
    if find_members_below_module(hir, bound, e, &find_constant, &is_package, passes).is_some() {
        return true;
    }
    let comes = |it: ExprId| comes_from_package(inputs, it, steps_left);
    match hir[e].kind {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => comes(obj),
        ExprKind::Call(call) | ExprKind::New(call) => comes(hir[call].callee),
        ExprKind::Await(awaited) => comes(awaited),
        ExprKind::Ident(_) => match bound.binding(e) {
            Binding::Symbol(symbol) => match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Expression(source)
                | BindingInitializer::PatternProperty { source, .. } => comes(source),
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}

fn names_package(specifier: &[u8]) -> bool {
    let is_builtin = |specifier: &[u8]| BUILTIN_MODULES.contains(&specifier);
    let package = strings::split(specifier, b"/").next();
    !specifier.is_empty()
        && !matches!(specifier[0], b'.' | b'/' | b'#')
        && !strings::contains_char(specifier, b':')
        && !package.is_some_and(is_builtin)
}

const BUILTIN_MODULES: [&[u8]; 40] = [
    b"assert",
    b"async_hooks",
    b"buffer",
    b"bun",
    b"child_process",
    b"cluster",
    b"console",
    b"constants",
    b"crypto",
    b"dgram",
    b"diagnostics_channel",
    b"dns",
    b"domain",
    b"events",
    b"fs",
    b"http",
    b"http2",
    b"https",
    b"inspector",
    b"module",
    b"net",
    b"os",
    b"path",
    b"perf_hooks",
    b"process",
    b"punycode",
    b"querystring",
    b"readline",
    b"repl",
    b"stream",
    b"string_decoder",
    b"timers",
    b"tls",
    b"tty",
    b"url",
    b"util",
    b"v8",
    b"vm",
    b"worker_threads",
    b"zlib",
];

fn is_path_function(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> bool {
    is_free_name(inputs.hir, inputs.bound, callee, &[known::URL])
        || names_function_of(inputs, callee, &MODULES_OF_PATHS)
}

fn names_function_of(inputs: &ScanInputs<'_, '_>, callee: ExprId, modules: &[&[u8]]) -> bool {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let is_module = |specifier: Atom| modules.contains(&atoms.bytes(specifier));
    let find_constant = |e| find_constant(inputs, e);
    let passes = Passes {
        awaited_imports: true,
        wrappers: true,
    };
    find_members_below_module(hir, bound, callee, &find_constant, &is_module, passes).is_some()
}

pub(super) fn may_lead_to_own_folder(inputs: &ScanInputs<'_, '_>, e: ExprId) -> bool {
    leads_to_own_folder(inputs, e, LONGEST_CHAIN)
}

fn leads_to_own_folder(inputs: &ScanInputs<'_, '_>, e: ExprId, steps_left: usize) -> bool {
    let &ScanInputs { hir, bound, .. } = inputs;
    let e = hir.skip_type_assertions(e);
    let Some(steps_left) = steps_left.checked_sub(1) else {
        return false;
    };
    let leads = |it: ExprId| leads_to_own_folder(inputs, it, steps_left);
    match hir[e].kind {
        ExprKind::Ident(_) => {
            is_free_common_js(hir, bound, e, CommonJsVariable::Dirname)
                || is_free_common_js(hir, bound, e, CommonJsVariable::Filename)
                || match bound.binding(e) {
                    Binding::Symbol(symbol) => matches!(bound.binding_initializer(hir, symbol),
                        BindingInitializer::Expression(source) if leads(source)),
                    _ => false,
                }
        }
        ExprKind::Dot { obj, .. } => {
            let obj = hir.skip_type_assertions(obj);
            matches!(hir[obj].kind, ExprKind::ImportMeta)
                || is_free_common_js(hir, bound, obj, CommonJsVariable::Module)
        }
        ExprKind::Call(call) => hir.ids(hir[call].args).next().is_some_and(leads),
        ExprKind::New(call) => hir.ids(hir[call].args).nth(1).is_some_and(leads),
        ExprKind::Template { exprs } => {
            let starts_with_text = (hir.ids(hir.template_texts(exprs)).next())
                .is_some_and(|text| !inputs.atoms.bytes(text).is_empty());
            !starts_with_text && hir.ids(exprs).next().is_some_and(leads)
        }
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            ..
        } => leads(left),
        _ => false,
    }
}
