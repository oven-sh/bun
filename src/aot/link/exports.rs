use crate::fragment::{Body, Fragment, FuncKey, ReferenceCollector, ReferencedIds};
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, V};
use crate::ir::{self, CoerceReason, Def, Func, FuncKind, Op, Operation, Term, func_flags};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashMap;

#[derive(Default)]
struct Namespace {
    names: Vec<Vec<u8>>,
    is_read: Vec<bool>,
    is_called_as_method: Vec<bool>,
    escapes: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Wrapping {
    Itself,
    ListOfPromises,
    PromiseOfList,
    List,
    IteratorOfList,
}

#[derive(Copy, Clone, PartialEq, Eq)]
struct Followed {
    function: FuncId,
    value: V,
    is_awaited: bool,
    wrapping: Wrapping,
    index: u32,
}

#[derive(Default)]
struct Uses {
    names_read: Vec<Vec<u8>>,
    methods_called: Vec<Vec<u8>>,
    is_returned: bool,
    escapes: bool,
}

fn without_casts(func: &Func, mut value: V) -> V {
    while let Some(&Op::Coerce { value: inner, .. }) = func.op(value) {
        value = inner;
    }
    value
}

fn is_promise_constructor(fragment: &Fragment, func: &Func, value: V) -> bool {
    matches!(func.op(value), Some(&Op::FreeGet { name, is_typeof: false }) if fragment.strs.get(name) == b"Promise")
}

fn collect_namespace_uses(
    fragment: &Fragment,
    starts_in: FuncId,
    start: V,
    is_promise: bool,
) -> Uses {
    let mut uses = Uses::default();
    let mut handlers: Vec<(FuncId, Followed)> = Vec::new();
    let mut returned_by_handlers: Vec<Followed> = Vec::new();
    let mut work = vec![Followed {
        function: starts_in,
        value: start,
        is_awaited: !is_promise,
        wrapping: Wrapping::Itself,
        index: 0,
    }];
    let mut seen: Vec<Followed> = Vec::new();
    fn resolve(work: &mut Vec<Followed>, uses: &mut Uses, created: Followed, returned: Followed) {
        match returned.wrapping {
            Wrapping::Itself => work.push(Followed {
                is_awaited: false,
                wrapping: Wrapping::Itself,
                index: 0,
                ..created
            }),
            Wrapping::List | Wrapping::PromiseOfList => work.push(Followed {
                wrapping: Wrapping::PromiseOfList,
                index: returned.index,
                ..created
            }),
            Wrapping::ListOfPromises | Wrapping::IteratorOfList => uses.escapes = true,
        }
    }
    while let Some(next) = work.pop() {
        if seen.contains(&next) {
            continue;
        }
        seen.push(next);
        let Some(func) = fragment.funcs[next.function.idx()].func.as_ref() else {
            uses.escapes = true;
            continue;
        };
        let wrapping = next.value;
        let is_promise_now = next.wrapping == Wrapping::PromiseOfList
            || (next.wrapping == Wrapping::Itself && !next.is_awaited);
        for block in &func.blocks {
            for &at in &block.ops {
                let Some(op) = func.op(at) else { continue };
                let mut use_count = 0;
                op.for_each_operand(|operand| use_count += usize::from(operand == wrapping));
                if use_count == 0 {
                    continue;
                }
                let on = |value: V| Followed { value, ..next };
                match *op {
                    Op::Coerce { to, why, .. } => {
                        let inspects_only_kind = matches!(
                            why,
                            CoerceReason::Store | CoerceReason::Cast | CoerceReason::Coerce
                        ) && fragment.tys.get(to).parts.is_empty();
                        if matches!(
                            why,
                            CoerceReason::Claim
                                | CoerceReason::Flow
                                | CoerceReason::Upcast
                                | CoerceReason::NonNull(_)
                        ) || inspects_only_kind
                        {
                            work.push(on(at));
                        } else {
                            uses.escapes = true;
                        }
                        continue;
                    }
                    Op::IsNullish(_) | Op::StrictEq { .. } | Op::Not(_) | Op::Truthy(_) => continue,
                    _ => {}
                }
                if is_promise_now
                    && let Op::CallMethod {
                        obj,
                        name,
                        ref args,
                    } = *op
                    && obj == wrapping
                    && !args.contains(&wrapping)
                {
                    let name = fragment.strs.get(name);
                    if name == b"catch" || name == b"finally" {
                        work.push(on(at));
                        continue;
                    }
                    if name == b"then"
                        && let Some(&first) = args.first()
                    {
                        match func.op(without_casts(func, first)) {
                            Some(Op::Undefined | Op::Null) => {
                                work.push(on(at));
                                continue;
                            }
                            Some(&(Op::FuncRef(handler) | Op::Closure { func: handler, .. })) => {
                                let taken = fragment.funcs[handler.idx()]
                                    .func
                                    .as_ref()
                                    .filter(|_| fragment.funcs[handler.idx()].body.is_some())
                                    .filter(|taken| {
                                        const DISQUALIFYING_FLAGS: u16 = func_flags::GENERATOR
                                            | func_flags::HAS_REST
                                            | func_flags::HAS_THIS
                                            | func_flags::HAS_NEW_TARGET
                                            | func_flags::IS_SLOPPY
                                            | func_flags::IS_BUILTIN;
                                        matches!(taken.kind, FuncKind::Plain | FuncKind::Arrow)
                                            && !taken.has(DISQUALIFYING_FLAGS)
                                            && !taken.blocks.is_empty()
                                            && taken.params.first().is_none_or(|&param| {
                                                param.is_none()
                                                    || fragment.tys.get(param).parts.is_empty()
                                            })
                                    });
                                if let Some(taken) = taken {
                                    if let Some(&parameter) = taken.blocks[Func::ENTRY.idx()]
                                        .params
                                        .get(taken.captures.len())
                                    {
                                        let as_what = if next.wrapping == Wrapping::Itself {
                                            Wrapping::Itself
                                        } else {
                                            Wrapping::List
                                        };
                                        work.push(Followed {
                                            function: handler,
                                            value: parameter,
                                            is_awaited: true,
                                            wrapping: as_what,
                                            index: next.index,
                                        });
                                    }
                                    handlers.push((handler, on(at)));
                                    for &returned in returned_by_handlers
                                        .iter()
                                        .filter(|returned| returned.function == handler)
                                    {
                                        resolve(&mut work, &mut uses, on(at), returned);
                                    }
                                    continue;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                match next.wrapping {
                    Wrapping::Itself => {}
                    Wrapping::ListOfPromises => {
                        let is_passed_to_promise_all = matches!(*op, Op::Call { callee, this, ref args } if use_count == 1 && args.len() == 1 && args[0] == wrapping && is_promise_constructor(fragment, func, this)
                            && matches!(func.op(callee), Some(&Op::PropGet { obj, name }) if fragment.strs.get(name) == b"all" && is_promise_constructor(fragment, func, obj)))
                            || matches!(*op, Op::CallMethod { obj, name, ref args } if use_count == 1 && args.len() == 1 && args[0] == wrapping && fragment.strs.get(name) == b"all" && is_promise_constructor(fragment, func, obj));
                        if is_passed_to_promise_all {
                            work.push(Followed {
                                wrapping: Wrapping::PromiseOfList,
                                ..on(at)
                            });
                        } else {
                            uses.escapes = true;
                        }
                        continue;
                    }
                    Wrapping::PromiseOfList => {
                        if matches!(*op, Op::Await(_)) {
                            work.push(Followed {
                                wrapping: Wrapping::List,
                                ..on(at)
                            });
                        } else {
                            uses.escapes = true;
                        }
                        continue;
                    }
                    Wrapping::List => {
                        match *op {
                            Op::ElemGet { obj, key }
                                if use_count == 1
                                    && obj == wrapping
                                    && matches!(func.op(key), Some(Op::Int(_))) =>
                            {
                                if matches!(func.op(key), Some(&Op::Int(number)) if number == i64::from(next.index))
                                {
                                    work.push(Followed {
                                        is_awaited: true,
                                        wrapping: Wrapping::Itself,
                                        index: 0,
                                        ..on(at)
                                    });
                                }
                            }
                            Op::IterOpen(_) => work.push(Followed {
                                wrapping: Wrapping::IteratorOfList,
                                ..on(at)
                            }),
                            Op::PropGet { name, .. } if fragment.strs.get(name) == b"length" => {}
                            _ => uses.escapes = true,
                        }
                        continue;
                    }
                    Wrapping::IteratorOfList => {
                        match *op {
                            Op::IterGet { iter, index }
                                if use_count == 1
                                    && iter == wrapping
                                    && matches!(func.op(index), Some(Op::Int(_))) =>
                            {
                                if matches!(func.op(index), Some(&Op::Int(number)) if number == i64::from(next.index))
                                {
                                    work.push(Followed {
                                        is_awaited: true,
                                        wrapping: Wrapping::Itself,
                                        index: 0,
                                        ..on(at)
                                    });
                                }
                            }
                            Op::IterHas { iter, .. } if use_count == 1 && iter == wrapping => {}
                            Op::IterClose(_) | Op::IterCloseForThrow(_) => {}
                            _ => uses.escapes = true,
                        }
                        continue;
                    }
                }
                match *op {
                    Op::Await(_) if !next.is_awaited => work.push(Followed {
                        is_awaited: true,
                        ..on(at)
                    }),
                    Op::PropGet { name, .. } if next.is_awaited => {
                        uses.names_read.push(fragment.strs.get(name).to_vec())
                    }
                    Op::CallMethod { obj, name, .. }
                        if next.is_awaited && use_count == 1 && obj == wrapping =>
                    {
                        uses.methods_called.push(fragment.strs.get(name).to_vec())
                    }
                    Op::Call { callee, this, .. }
                        if next.is_awaited && use_count == 1 && this == wrapping =>
                    {
                        match func.op(without_casts(func, callee)) {
                            Some(&Op::PropGet { obj, name }) if obj == wrapping => {
                                uses.methods_called.push(fragment.strs.get(name).to_vec())
                            }
                            _ => uses.escapes = true,
                        }
                    }
                    Op::Operation {
                        which: Operation::DefineField,
                        ref args,
                    } if next.is_awaited
                        && use_count == 1
                        && args.len() == 3
                        && args[0] == wrapping
                        && matches!(func.op(args[1]), Some(&Op::Str(key)) if fragment.strs.get(key) == b"__esModule")
                        && matches!(func.op(args[2]), Some(Op::Bool(_))) =>
                    {
                        work.push(on(at));
                    }
                    Op::NewArray(ref args) if !next.is_awaited => {
                        for (index, _) in args
                            .iter()
                            .enumerate()
                            .filter(|argument| *argument.1 == wrapping)
                        {
                            work.push(Followed {
                                wrapping: Wrapping::ListOfPromises,
                                index: index as u32,
                                ..on(at)
                            });
                        }
                    }
                    _ => uses.escapes = true,
                }
            }
            let Some(term) = &block.term else { continue };
            match *term {
                Term::Return(value) if value == wrapping => {
                    if next.function != starts_in {
                        returned_by_handlers.push(next);
                        for &(_, created) in
                            handlers.iter().filter(|handler| handler.0 == next.function)
                        {
                            resolve(&mut work, &mut uses, created, next);
                        }
                    } else if next.wrapping == Wrapping::Itself {
                        uses.is_returned = true;
                    } else {
                        uses.escapes = true;
                    }
                }
                Term::Switch { value, .. } | Term::Throw { value, .. } if value == wrapping => {
                    uses.escapes = true
                }
                _ => {}
            }
            term.for_each_target(|target| {
                for (index, _) in target
                    .args
                    .iter()
                    .enumerate()
                    .filter(|argument| *argument.1 == wrapping)
                {
                    work.push(Followed {
                        value: func.blocks[target.block.idx()].params[index],
                        ..next
                    });
                }
            });
        }
    }
    uses
}

fn returned_global(fragment: &Fragment, func: &Func, arm: BlockId) -> Option<GlobalId> {
    let mut produced: Option<GlobalId> = None;
    let mut factories: Vec<FuncId> = Vec::new();
    let mut is_seen = vec![false; func.blocks.len()];
    let mut work: Vec<BlockId> = vec![arm];
    while let Some(block) = work.pop() {
        if std::mem::replace(&mut is_seen[block.idx()], true) {
            continue;
        }
        for &at in &func.blocks[block.idx()].ops {
            match func.op(at)? {
                &Op::GlobalGet(global) => {
                    if produced.is_some_and(|known| known != global) {
                        return None;
                    }
                    produced = Some(global);
                }
                Op::CallDirect { func: maker, args } if args.is_empty() => factories.push(*maker),
                Op::IsNullish(_)
                | Op::StrictEq { .. }
                | Op::Undefined
                | Op::Null
                | Op::Bool(_)
                | Op::Coerce { .. }
                | Op::FreeGet { .. }
                | Op::Str(_)
                | Op::Construct { .. } => {}
                _ => return None,
            }
        }
        func.blocks[block.idx()]
            .term
            .as_ref()?
            .for_each_target(|target| work.push(target.block));
    }
    let produced = produced?;
    for maker in factories {
        let allocated_by = fragment.funcs[maker.idx()]
            .func
            .as_ref()
            .filter(|allocated_by| {
                fragment.funcs[maker.idx()].body.is_some() && allocated_by.kind == FuncKind::Module
            })?;
        for block in &allocated_by.blocks {
            if let Some(Term::Return(returned)) = block.term
                && (returned.is_none()
                    || !matches!(allocated_by.op(without_casts(allocated_by, returned)), Some(&Op::GlobalGet(global)) if global == produced))
            {
                return None;
            }
        }
    }
    Some(produced)
}

fn stores_possible_this_reader(fragment: &Fragment, func: &Func, stored: V) -> bool {
    match func.op(without_casts(func, stored)) {
        Some(Op::Undefined | Op::Null) => false,
        Some(
            &(Op::FuncRef(closed)
            | Op::Closure { func: closed, .. }
            | Op::ClosureOnce { func: closed, .. }),
        ) => !fragment.funcs[closed.idx()]
            .func
            .as_ref()
            .is_some_and(|closed| !closed.has(func_flags::HAS_THIS)),
        _ => true,
    }
}

fn namespace_names(fragment: &Fragment, func: &Func, file: FileId) -> Option<Vec<Vec<u8>>> {
    let created: Vec<&ir::Args> = (func.values.iter())
        .filter_map(|value| match &value.def {
            Def::Op(Op::Operation {
                which: Operation::MakeModuleNamespace,
                args,
            }) => Some(args),
            _ => None,
        })
        .collect();
    let [args] = created[..] else { return None };
    let (&reader, names) = args.split_first()?;
    if !matches!(func.op(reader), Some(&Op::FuncRef(reader)) if fragment.funcs[reader.idx()].key == FuncKey::ModuleNamespaceReader(file))
    {
        return None;
    }
    names
        .iter()
        .map(|&name| {
            if let Some(&Op::Str(name)) = func.op(name) {
                Some(fragment.strs.get(name).to_vec())
            } else {
                None
            }
        })
        .collect()
}

fn referenced_ids(body: &Body) -> impl Iterator<Item = &ReferencedIds> {
    std::iter::once(&body.mentions).chain(body.parts.iter().map(|part| &part.mentions))
}

pub(super) fn drop_unread_exports(
    fragments: &mut [Fragment],
    entry_points: &[Vec<FileId>],
    in_parallel: InParallel<'_>,
) -> (usize, usize, usize) {
    let mut namespaces: FxHashMap<FileId, Namespace> = FxHashMap::default();
    let mut looked_at: Vec<(&Fragment, Vec<(FileId, Option<Vec<Vec<u8>>>)>, Vec<u32>)> = fragments
        .iter()
        .map(|fragment| (fragment, Vec::new(), Vec::new()))
        .collect();
    for_each_mut(&mut looked_at, in_parallel, &|(
        fragment,
        created,
        readers,
    )| {
        let fragment: &Fragment = *fragment;
        for (index, function) in fragment
            .funcs
            .iter()
            .enumerate()
            .filter(|function| function.1.body.is_some())
        {
            match (function.key, &function.func) {
                (FuncKey::NamespaceObject(file, _), Some(func)) => {
                    if func.values.iter().any(|value| {
                        matches!(
                            &value.def,
                            Def::Op(Op::Operation {
                                which: Operation::MakeModuleNamespace,
                                ..
                            })
                        )
                    }) {
                        created.push((file, namespace_names(fragment, func, file)));
                    }
                }
                (FuncKey::ModuleNamespaceReader(_), Some(_)) => readers.push(index as u32),
                _ => {}
            }
        }
    });
    let readers: Vec<Vec<u32>> = looked_at
        .iter_mut()
        .map(|found| std::mem::take(&mut found.2))
        .collect();
    for (file, names) in looked_at.into_iter().flat_map(|found| found.1) {
        let known = namespaces.entry(file).or_insert_with(|| Namespace {
            names: names.clone().unwrap_or_default(),
            ..Namespace::default()
        });
        known.escapes |=
            names.as_ref() != Some(&known.names) || known.names.iter().any(|name| name == b"then");
    }
    for file in entry_points.iter().flatten() {
        if let Some(namespace) = namespaces.get_mut(file) {
            namespace.escapes = true;
        }
    }
    if namespaces.values().all(|namespace| namespace.escapes) {
        return (namespaces.len(), 0, 0);
    }
    for namespace in namespaces.values_mut() {
        namespace.is_read = vec![false; namespace.names.len()];
        namespace.is_called_as_method = vec![false; namespace.names.len()];
    }
    let mut found: Vec<(&Fragment, Vec<(FileId, Uses)>)> = fragments
        .iter()
        .map(|fragment| (fragment, Vec::new()))
        .collect();
    let known = &namespaces;
    for_each_mut(&mut found, in_parallel, &|(fragment, found)| {
        let fragment: &Fragment = *fragment;
        let result_file = |func: FuncId| match fragment.funcs[func.idx()].key {
            FuncKey::NamespaceObject(file, _) if known.contains_key(&file) => Some((file, false)),
            FuncKey::DynamicImport(file, _) if known.contains_key(&file) => Some((file, true)),
            _ => None,
        };
        if !(0..fragment.funcs.len()).any(|func| result_file(FuncId::new(func)).is_some()) {
            return;
        }
        for (index, function) in fragment.funcs.iter().enumerate() {
            let (Some(func), Some(body)) = (&function.func, &function.body) else {
                continue;
            };
            if !referenced_ids(body).any(|ids| {
                ids.called()
                    .chain(ids.values())
                    .any(|callee| result_file(callee).is_some())
            }) {
                continue;
            }
            for &at in func.blocks.iter().flat_map(|block| &block.ops) {
                match func.op(at) {
                    Some(&Op::CallDirect { func: callee, .. }) => {
                        let Some((file, is_promise)) = result_file(callee) else {
                            continue;
                        };
                        let mut uses =
                            collect_namespace_uses(fragment, FuncId::new(index), at, is_promise);
                        let is_importer = !is_promise
                            && matches!(function.key, FuncKey::DynamicImport(importing, _) if importing == file);
                        if is_importer
                            && uses.is_returned
                            && !uses.escapes
                            && uses.names_read.is_empty()
                            && uses.methods_called.is_empty()
                        {
                            continue;
                        }
                        uses.escapes |= uses.is_returned;
                        found.push((file, uses));
                    }
                    Some(
                        &(Op::FuncRef(named)
                        | Op::Closure { func: named, .. }
                        | Op::ClosureOnce { func: named, .. }),
                    ) => {
                        if let Some((file, _)) = result_file(named) {
                            found.push((
                                file,
                                Uses {
                                    escapes: true,
                                    ..Uses::default()
                                },
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }
    });
    let found: Vec<(FileId, Uses)> = found.into_iter().flat_map(|found| found.1).collect();
    for (file, uses) in found {
        let Some(namespace) = namespaces.get_mut(&file) else {
            continue;
        };
        namespace.escapes |= uses.escapes;
        for (names, is_method) in [(uses.names_read, false), (uses.methods_called, true)] {
            for name in names {
                if let Some(number) = namespace.names.iter().position(|known| *known == name) {
                    namespace.is_read[number] = true;
                    namespace.is_called_as_method[number] |= is_method;
                }
            }
        }
    }
    let mut called_via_namespace: FxHashMap<u32, Vec<FileId>> = FxHashMap::default();
    for (fragment, readers) in fragments.iter().zip(&readers) {
        for function in readers.iter().map(|&index| &fragment.funcs[index as usize]) {
            let (FuncKey::ModuleNamespaceReader(file), Some(func)) = (function.key, &function.func)
            else {
                continue;
            };
            let Some(namespace) = namespaces.get_mut(&file) else {
                continue;
            };
            let Some(Term::Switch { cases, .. }) = &func.blocks[Func::ENTRY.idx()].term else {
                namespace.escapes = true;
                continue;
            };
            for &(number, ref target) in cases {
                if namespace.is_called_as_method.get(number as usize) != Some(&true) {
                    continue;
                }
                if let [only] = func.blocks[target.block.idx()].ops[..]
                    && let Some(&Op::FuncRef(exported)) = func.op(only)
                {
                    namespace.escapes |= !fragment.funcs[exported.idx()]
                        .func
                        .as_ref()
                        .is_some_and(|exported| !exported.has(func_flags::HAS_THIS));
                } else if let Some(global) = returned_global(fragment, func, target.block) {
                    called_via_namespace
                        .entry(fragment.program_ids.globals[global.idx()])
                        .or_default()
                        .push(file);
                } else {
                    namespace.escapes = true;
                }
            }
        }
    }
    if !called_via_namespace.is_empty() {
        let mut found: Vec<(&Fragment, Vec<u32>)> = fragments
            .iter()
            .map(|fragment| (fragment, Vec::new()))
            .collect();
        let asked = &called_via_namespace;
        for_each_mut(&mut found, in_parallel, &|(fragment, found)| {
            let fragment: &Fragment = *fragment;
            for function in &fragment.funcs {
                let (Some(func), Some(body)) = (&function.func, &function.body) else {
                    continue;
                };
                if !referenced_ids(body).any(|ids| {
                    ids.globals().any(|global| {
                        asked.contains_key(&fragment.program_ids.globals[global.idx()])
                    })
                }) {
                    continue;
                }
                for value in &func.values {
                    if let Def::Op(Op::GlobalSet(global, stored)) = value.def
                        && asked.contains_key(&fragment.program_ids.globals[global.idx()])
                        && stores_possible_this_reader(fragment, func, stored)
                    {
                        found.push(fragment.program_ids.globals[global.idx()]);
                    }
                }
            }
        });
        for global in found.into_iter().flat_map(|found| found.1) {
            for file in &called_via_namespace[&global] {
                if let Some(namespace) = namespaces.get_mut(file) {
                    namespace.escapes = true;
                }
            }
        }
    }
    let stay = namespaces
        .values()
        .filter(|namespace| !namespace.escapes)
        .count();
    let unread = namespaces
        .values()
        .filter(|namespace| !namespace.escapes)
        .map(|namespace| {
            namespace
                .is_read
                .iter()
                .filter(|is_read| !**is_read)
                .count()
        })
        .sum();
    let known = &namespaces;
    let mut with_readers: Vec<(&mut Fragment, &[u32])> = fragments
        .iter_mut()
        .zip(&readers)
        .filter(|(_, readers)| !readers.is_empty())
        .map(|(fragment, readers)| (fragment, &readers[..]))
        .collect();
    for_each_mut(&mut with_readers, in_parallel, &|(fragment, readers)| {
        let (anything, mut mentioning) = (fragment.tys.anything, ReferenceCollector::default());
        let classes: Vec<LayoutId> = fragment
            .funcs
            .iter()
            .map(|function| {
                function
                    .body
                    .as_ref()
                    .map_or(LayoutId::NONE, |body| body.class)
            })
            .collect();
        for &reader in readers.iter() {
            let function = &mut fragment.funcs[reader as usize];
            let (FuncKey::ModuleNamespaceReader(file), Some(func), Some(body)) =
                (function.key, &mut function.func, &mut function.body)
            else {
                continue;
            };
            let Some(namespace) = known.get(&file).filter(|namespace| !namespace.escapes) else {
                continue;
            };
            if !matches!(
                func.blocks[Func::ENTRY.idx()].term,
                Some(Term::Switch { .. })
            ) {
                continue;
            }
            let Some(Term::Switch {
                value,
                mut cases,
                default,
            }) = func.blocks[Func::ENTRY.idx()].term.take()
            else {
                continue;
            };
            let is_dropped = |case: &(i64, ir::Target)| {
                namespace.is_read.get(case.0 as usize) == Some(&false)
                    && case.1.args.is_empty()
                    && case.1.block != default.block
            };
            let dead = cases
                .iter()
                .find(|case| is_dropped(case))
                .map(|case| case.1.block);
            let is_dead_block_free = dead.is_some_and(|dead| {
                func.blocks[dead.idx()].params.is_empty()
                    && !cases
                        .iter()
                        .any(|case| case.1.block == dead && !is_dropped(case))
            });
            let Some(dead) = dead.filter(|_| is_dead_block_free) else {
                func.blocks[Func::ENTRY.idx()].term = Some(Term::Switch {
                    value,
                    cases,
                    default,
                });
                continue;
            };
            for number in 0..cases.len() {
                if is_dropped(&cases[number]) {
                    cases[number].1 = ir::Target::new(dead);
                }
            }
            func.blocks[Func::ENTRY.idx()].term = Some(Term::Switch {
                value,
                cases,
                default,
            });
            func.blocks[dead.idx()].term = Some(Term::Unreachable);
            let mut is_reached = vec![false; func.blocks.len()];
            let mut work: Vec<BlockId> = vec![Func::ENTRY];
            while let Some(block) = work.pop() {
                if std::mem::replace(&mut is_reached[block.idx()], true) {
                    continue;
                }
                if let Some(term) = &func.blocks[block.idx()].term {
                    term.for_each_target(|target| work.push(target.block));
                }
            }
            let mut classes_dropped: Vec<LayoutId> = Vec::new();
            for number in
                (0..func.blocks.len()).filter(|&number| !is_reached[number] || number == dead.idx())
            {
                let ir::Block { params, ops, .. } = std::mem::replace(
                    &mut func.blocks[number],
                    ir::Block {
                        params: Vec::new(),
                        ops: Vec::new(),
                        term: Some(Term::Unreachable),
                    },
                );
                for at in params.into_iter().chain(ops) {
                    if let Some(&Op::FuncRef(exported)) = func.op(at)
                        && classes[exported.idx()].is_some()
                    {
                        classes_dropped.push(classes[exported.idx()]);
                    }
                    func.values[at.idx()] = ir::Value::new(Def::Op(Op::Undefined), 0, anything);
                }
            }
            let still_referenced: Vec<LayoutId> = func
                .values
                .iter()
                .filter_map(|value| {
                    if let Def::Op(Op::FuncRef(exported)) = value.def {
                        Some(classes[exported.idx()])
                    } else {
                        None
                    }
                })
                .collect();
            body.classes_as_values.retain(|class| {
                !classes_dropped.contains(class) || still_referenced.contains(class)
            });
            body.mentions = mentioning.collect_func(func);
        }
    });
    (namespaces.len(), stay, unread)
}
