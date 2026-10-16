use crate::fragment::{Fragment, FuncKey, Mentioning};
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, V};
use crate::ir::{self, Def, Func, FuncKind, Op, Operation, Term, Why, func_flags};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashMap;

#[derive(Default)]
struct Namespace {
    names: Vec<Vec<u8>>,
    is_read: Vec<bool>,
    is_called_as_method: Vec<bool>,
    gets_away: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Held {
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
    held: Held,
    index: u32,
}

#[derive(Default)]
struct Uses {
    names_read: Vec<Vec<u8>>,
    methods_called: Vec<Vec<u8>>,
    is_returned: bool,
    gets_away: bool,
}

fn without_casts(func: &Func, mut value: V) -> V {
    while let Some(&Op::Coerce { value: inner, .. }) = func.op(value) {
        value = inner;
    }
    value
}

fn is_the_promise_constructor(fragment: &Fragment, func: &Func, value: V) -> bool {
    matches!(func.op(value), Some(&Op::FreeGet { name, is_typeof: false }) if fragment.strs.get(name) == b"Promise")
}

fn uses_of(fragment: &Fragment, starts_in: FuncId, start: V, is_promise: bool) -> Uses {
    let mut uses = Uses::default();
    let mut handlers: Vec<(FuncId, Followed)> = Vec::new();
    let mut returned_by_handlers: Vec<Followed> = Vec::new();
    let mut work = vec![Followed { function: starts_in, value: start, is_awaited: !is_promise, held: Held::Itself, index: 0 }];
    let mut seen: Vec<Followed> = Vec::new();
    fn resolve(work: &mut Vec<Followed>, uses: &mut Uses, made: Followed, returned: Followed) {
        match returned.held {
            Held::Itself => work.push(Followed { is_awaited: false, held: Held::Itself, index: 0, ..made }),
            Held::List | Held::PromiseOfList => work.push(Followed { held: Held::PromiseOfList, index: returned.index, ..made }),
            Held::ListOfPromises | Held::IteratorOfList => uses.gets_away = true,
        }
    }
    while let Some(next) = work.pop() {
        if seen.contains(&next) {
            continue;
        }
        seen.push(next);
        let Some(func) = fragment.funcs[next.function.idx()].func.as_ref() else {
            uses.gets_away = true;
            continue;
        };
        let held = next.value;
        let is_promise_now = next.held == Held::PromiseOfList || (next.held == Held::Itself && !next.is_awaited);
        for block in &func.blocks {
            for &at in &block.ops {
                let Some(op) = func.op(at) else { continue };
                let mut times_used = 0;
                op.for_each_operand(|operand| times_used += usize::from(operand == held));
                if times_used == 0 {
                    continue;
                }
                let on = |value: V| Followed { value, ..next };
                match *op {
                    Op::Coerce { to, why, .. } => {
                        let looks_at_the_kind_alone = matches!(why, Why::Store | Why::Cast | Why::Coerce) && fragment.tys.get(to).parts.is_empty();
                        if matches!(why, Why::Claim | Why::Flow | Why::Upcast | Why::NonNull(_)) || looks_at_the_kind_alone {
                            work.push(on(at));
                        } else {
                            uses.gets_away = true;
                        }
                        continue;
                    }
                    Op::IsNullish(_) | Op::StrictEq { .. } | Op::Not(_) | Op::Truthy(_) => continue,
                    _ => {}
                }
                if is_promise_now
                    && let Op::CallMethod { obj, name, ref args } = *op
                    && obj == held
                    && !args.contains(&held)
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
                                let taken = fragment.funcs[handler.idx()].func.as_ref().filter(|_| fragment.funcs[handler.idx()].body.is_some()).filter(|taken| {
                                    const RULES_IT_OUT: u16 = func_flags::GENERATOR | func_flags::HAS_REST | func_flags::HAS_THIS | func_flags::HAS_NEW_TARGET | func_flags::IS_SLOPPY | func_flags::IS_BUILTIN;
                                    matches!(taken.kind, FuncKind::Plain | FuncKind::Arrow)
                                        && !taken.has(RULES_IT_OUT)
                                        && !taken.blocks.is_empty()
                                        && taken.params.first().is_none_or(|&param| param.is_none() || fragment.tys.get(param).parts.is_empty())
                                });
                                if let Some(taken) = taken {
                                    if let Some(&parameter) = taken.blocks[Func::ENTRY.idx()].params.get(taken.captures.len()) {
                                        let as_what = if next.held == Held::Itself { Held::Itself } else { Held::List };
                                        work.push(Followed { function: handler, value: parameter, is_awaited: true, held: as_what, index: next.index });
                                    }
                                    handlers.push((handler, on(at)));
                                    for &returned in returned_by_handlers.iter().filter(|returned| returned.function == handler) {
                                        resolve(&mut work, &mut uses, on(at), returned);
                                    }
                                    continue;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                match next.held {
                    Held::Itself => {}
                    Held::ListOfPromises => {
                        let is_handed_to_all = matches!(*op, Op::Call { callee, this, ref args } if times_used == 1 && args.len() == 1 && args[0] == held && is_the_promise_constructor(fragment, func, this)
                            && matches!(func.op(callee), Some(&Op::PropGet { obj, name }) if fragment.strs.get(name) == b"all" && is_the_promise_constructor(fragment, func, obj)))
                            || matches!(*op, Op::CallMethod { obj, name, ref args } if times_used == 1 && args.len() == 1 && args[0] == held && fragment.strs.get(name) == b"all" && is_the_promise_constructor(fragment, func, obj));
                        if is_handed_to_all {
                            work.push(Followed { held: Held::PromiseOfList, ..on(at) });
                        } else {
                            uses.gets_away = true;
                        }
                        continue;
                    }
                    Held::PromiseOfList => {
                        if matches!(*op, Op::Await(_)) {
                            work.push(Followed { held: Held::List, ..on(at) });
                        } else {
                            uses.gets_away = true;
                        }
                        continue;
                    }
                    Held::List => {
                        match *op {
                            Op::ElemGet { obj, key } if times_used == 1 && obj == held && matches!(func.op(key), Some(Op::Int(_))) => {
                                if matches!(func.op(key), Some(&Op::Int(number)) if number == i64::from(next.index)) {
                                    work.push(Followed { is_awaited: true, held: Held::Itself, index: 0, ..on(at) });
                                }
                            }
                            Op::IterOpen(_) => work.push(Followed { held: Held::IteratorOfList, ..on(at) }),
                            Op::PropGet { name, .. } if fragment.strs.get(name) == b"length" => {}
                            _ => uses.gets_away = true,
                        }
                        continue;
                    }
                    Held::IteratorOfList => {
                        match *op {
                            Op::IterGet { iter, index } if times_used == 1 && iter == held && matches!(func.op(index), Some(Op::Int(_))) => {
                                if matches!(func.op(index), Some(&Op::Int(number)) if number == i64::from(next.index)) {
                                    work.push(Followed { is_awaited: true, held: Held::Itself, index: 0, ..on(at) });
                                }
                            }
                            Op::IterHas { iter, .. } if times_used == 1 && iter == held => {}
                            Op::IterClose(_) | Op::IterCloseForThrow(_) => {}
                            _ => uses.gets_away = true,
                        }
                        continue;
                    }
                }
                match *op {
                    Op::Await(_) if !next.is_awaited => work.push(Followed { is_awaited: true, ..on(at) }),
                    Op::PropGet { name, .. } if next.is_awaited => uses.names_read.push(fragment.strs.get(name).to_vec()),
                    Op::CallMethod { obj, name, .. } if next.is_awaited && times_used == 1 && obj == held => uses.methods_called.push(fragment.strs.get(name).to_vec()),
                    Op::Call { callee, this, .. } if next.is_awaited && times_used == 1 && this == held => match func.op(without_casts(func, callee)) {
                        Some(&Op::PropGet { obj, name }) if obj == held => uses.methods_called.push(fragment.strs.get(name).to_vec()),
                        _ => uses.gets_away = true,
                    },
                    Op::Operation { which: Operation::DefineField, ref args }
                        if next.is_awaited
                            && times_used == 1
                            && args.len() == 3
                            && args[0] == held
                            && matches!(func.op(args[1]), Some(&Op::Str(key)) if fragment.strs.get(key) == b"__esModule")
                            && matches!(func.op(args[2]), Some(Op::Bool(_))) =>
                    {
                        work.push(on(at));
                    }
                    Op::NewArray(ref args) if !next.is_awaited => {
                        for (index, _) in args.iter().enumerate().filter(|argument| *argument.1 == held) {
                            work.push(Followed { held: Held::ListOfPromises, index: index as u32, ..on(at) });
                        }
                    }
                    _ => uses.gets_away = true,
                }
            }
            let Some(term) = &block.term else { continue };
            match *term {
                Term::Return(value) if value == held => {
                    if next.function != starts_in {
                        returned_by_handlers.push(next);
                        for &(_, made) in handlers.iter().filter(|handler| handler.0 == next.function) {
                            resolve(&mut work, &mut uses, made, next);
                        }
                    } else if next.held == Held::Itself {
                        uses.is_returned = true;
                    } else {
                        uses.gets_away = true;
                    }
                }
                Term::Switch { value, .. } | Term::Throw { value, .. } if value == held => uses.gets_away = true,
                _ => {}
            }
            term.for_each_target(|target| {
                for (index, _) in target.args.iter().enumerate().filter(|argument| *argument.1 == held) {
                    work.push(Followed { value: func.blocks[target.block.idx()].params[index], ..next });
                }
            });
        }
    }
    uses
}

fn global_yielded_by(fragment: &Fragment, func: &Func, arm: BlockId) -> Option<GlobalId> {
    let mut yielded: Option<GlobalId> = None;
    let mut makers: Vec<FuncId> = Vec::new();
    let mut is_seen = vec![false; func.blocks.len()];
    let mut work: Vec<BlockId> = vec![arm];
    while let Some(block) = work.pop() {
        if std::mem::replace(&mut is_seen[block.idx()], true) {
            continue;
        }
        for &at in &func.blocks[block.idx()].ops {
            match func.op(at)? {
                &Op::GlobalGet(global) => {
                    if yielded.is_some_and(|known| known != global) {
                        return None;
                    }
                    yielded = Some(global);
                }
                Op::CallDirect { func: maker, args } if args.is_empty() => makers.push(*maker),
                Op::IsNullish(_) | Op::StrictEq { .. } | Op::Undefined | Op::Null | Op::Bool(_) | Op::Coerce { .. } | Op::FreeGet { .. } | Op::Str(_) | Op::Construct { .. } => {}
                _ => return None,
            }
        }
        func.blocks[block.idx()].term.as_ref()?.for_each_target(|target| work.push(target.block));
    }
    let yielded = yielded?;
    for maker in makers {
        let made_by = fragment.funcs[maker.idx()].func.as_ref().filter(|made_by| fragment.funcs[maker.idx()].body.is_some() && made_by.kind == FuncKind::Module)?;
        for block in &made_by.blocks {
            if let Some(Term::Return(returned)) = block.term
                && (returned.is_none() || !matches!(made_by.op(without_casts(made_by, returned)), Some(&Op::GlobalGet(global)) if global == yielded))
            {
                return None;
            }
        }
    }
    Some(yielded)
}

fn stores_what_may_read_this(fragment: &Fragment, func: &Func, stored: V) -> bool {
    match func.op(without_casts(func, stored)) {
        Some(Op::Undefined | Op::Null) => false,
        Some(&(Op::FuncRef(closed) | Op::Closure { func: closed, .. } | Op::ClosureOnce { func: closed, .. })) => !fragment.funcs[closed.idx()].func.as_ref().is_some_and(|closed| !closed.has(func_flags::HAS_THIS)),
        _ => true,
    }
}

fn names_of_namespace(fragment: &Fragment, func: &Func, file: FileId) -> Option<Vec<Vec<u8>>> {
    let made: Vec<&ir::Args> = (func.values.iter())
        .filter_map(|value| match &value.def {
            Def::Op(Op::Operation { which: Operation::MakeModuleNamespace, args }) => Some(args),
            _ => None,
        })
        .collect();
    let [args] = made[..] else { return None };
    let (&reader, names) = args.split_first()?;
    if !matches!(func.op(reader), Some(&Op::FuncRef(reader)) if fragment.funcs[reader.idx()].key == FuncKey::ModuleNamespaceReader(file)) {
        return None;
    }
    names.iter().map(|&name| if let Some(&Op::Str(name)) = func.op(name) { Some(fragment.strs.get(name).to_vec()) } else { None }).collect()
}

pub(super) fn drop_exports_nobody_reads(fragments: &mut [Fragment], entry_points: &[Vec<FileId>], in_parallel: InParallel<'_>) -> (usize, usize, usize) {
    let mut namespaces: FxHashMap<FileId, Namespace> = FxHashMap::default();
    let mut looked_at: Vec<(&Fragment, Vec<(FileId, Option<Vec<Vec<u8>>>)>, Vec<u32>)> = fragments.iter().map(|fragment| (fragment, Vec::new(), Vec::new())).collect();
    for_each_mut(&mut looked_at, in_parallel, &|(fragment, made, readers)| {
        let fragment: &Fragment = *fragment;
        for (index, function) in fragment.funcs.iter().enumerate().filter(|function| function.1.body.is_some()) {
            match (function.key, &function.func) {
                (FuncKey::NamespaceObject(file, _), Some(func)) => {
                    if func.values.iter().any(|value| matches!(&value.def, Def::Op(Op::Operation { which: Operation::MakeModuleNamespace, .. }))) {
                        made.push((file, names_of_namespace(fragment, func, file)));
                    }
                }
                (FuncKey::ModuleNamespaceReader(_), Some(_)) => readers.push(index as u32),
                _ => {}
            }
        }
    });
    let readers: Vec<Vec<u32>> = looked_at.iter_mut().map(|found| std::mem::take(&mut found.2)).collect();
    for (file, names) in looked_at.into_iter().flat_map(|found| found.1) {
        let known = namespaces.entry(file).or_insert_with(|| Namespace { names: names.clone().unwrap_or_default(), ..Namespace::default() });
        known.gets_away |= names.as_ref() != Some(&known.names) || known.names.iter().any(|name| name == b"then");
    }
    for file in entry_points.iter().flatten() {
        if let Some(namespace) = namespaces.get_mut(file) {
            namespace.gets_away = true;
        }
    }
    if namespaces.values().all(|namespace| namespace.gets_away) {
        return (namespaces.len(), 0, 0);
    }
    for namespace in namespaces.values_mut() {
        namespace.is_read = vec![false; namespace.names.len()];
        namespace.is_called_as_method = vec![false; namespace.names.len()];
    }
    let mut found: Vec<(&Fragment, Vec<(FileId, Uses)>)> = fragments.iter().map(|fragment| (fragment, Vec::new())).collect();
    let known = &namespaces;
    for_each_mut(&mut found, in_parallel, &|(fragment, found)| {
        let fragment: &Fragment = *fragment;
        let file_yielded_by = |func: FuncId| match fragment.funcs[func.idx()].key {
            FuncKey::NamespaceObject(file, _) if known.contains_key(&file) => Some((file, false)),
            FuncKey::DynamicImport(file, _) if known.contains_key(&file) => Some((file, true)),
            _ => None,
        };
        for (index, function) in fragment.funcs.iter().enumerate().filter(|function| function.1.body.is_some()) {
            let Some(func) = &function.func else { continue };
            for &at in func.blocks.iter().flat_map(|block| &block.ops) {
                match func.op(at) {
                    Some(&Op::CallDirect { func: callee, .. }) => {
                        let Some((file, is_promise)) = file_yielded_by(callee) else { continue };
                        let mut uses = uses_of(fragment, FuncId::new(index), at, is_promise);
                        let is_the_importer = !is_promise && matches!(function.key, FuncKey::DynamicImport(importing, _) if importing == file);
                        if is_the_importer && uses.is_returned && !uses.gets_away && uses.names_read.is_empty() && uses.methods_called.is_empty() {
                            continue;
                        }
                        uses.gets_away |= uses.is_returned;
                        found.push((file, uses));
                    }
                    Some(&(Op::FuncRef(named) | Op::Closure { func: named, .. } | Op::ClosureOnce { func: named, .. })) => {
                        if let Some((file, _)) = file_yielded_by(named) {
                            found.push((file, Uses { gets_away: true, ..Uses::default() }));
                        }
                    }
                    _ => {}
                }
            }
        }
    });
    let found: Vec<(FileId, Uses)> = found.into_iter().flat_map(|found| found.1).collect();
    for (file, uses) in found {
        let Some(namespace) = namespaces.get_mut(&file) else { continue };
        namespace.gets_away |= uses.gets_away;
        for (names, is_method) in [(uses.names_read, false), (uses.methods_called, true)] {
            for name in names {
                if let Some(number) = namespace.names.iter().position(|known| *known == name) {
                    namespace.is_read[number] = true;
                    namespace.is_called_as_method[number] |= is_method;
                }
            }
        }
    }
    let mut called_on_their_namespace: FxHashMap<u32, Vec<FileId>> = FxHashMap::default();
    for (fragment, readers) in fragments.iter().zip(&readers) {
        for function in readers.iter().map(|&index| &fragment.funcs[index as usize]) {
            let (FuncKey::ModuleNamespaceReader(file), Some(func)) = (function.key, &function.func) else { continue };
            let Some(namespace) = namespaces.get_mut(&file) else { continue };
            let Some(Term::Switch { cases, .. }) = &func.blocks[Func::ENTRY.idx()].term else {
                namespace.gets_away = true;
                continue;
            };
            for &(number, ref target) in cases {
                if namespace.is_called_as_method.get(number as usize) != Some(&true) {
                    continue;
                }
                if let [only] = func.blocks[target.block.idx()].ops[..]
                    && let Some(&Op::FuncRef(exported)) = func.op(only)
                {
                    namespace.gets_away |= !fragment.funcs[exported.idx()].func.as_ref().is_some_and(|exported| !exported.has(func_flags::HAS_THIS));
                } else if let Some(global) = global_yielded_by(fragment, func, target.block) {
                    called_on_their_namespace.entry(fragment.program_ids.globals[global.idx()]).or_default().push(file);
                } else {
                    namespace.gets_away = true;
                }
            }
        }
    }
    if !called_on_their_namespace.is_empty() {
        let mut found: Vec<(&Fragment, Vec<u32>)> = fragments.iter().map(|fragment| (fragment, Vec::new())).collect();
        let asked = &called_on_their_namespace;
        for_each_mut(&mut found, in_parallel, &|(fragment, found)| {
            let fragment: &Fragment = *fragment;
            for func in fragment.funcs.iter().filter(|function| function.body.is_some()).filter_map(|function| function.func.as_ref()) {
                for value in &func.values {
                    if let Def::Op(Op::GlobalSet(global, stored)) = value.def
                        && asked.contains_key(&fragment.program_ids.globals[global.idx()])
                        && stores_what_may_read_this(fragment, func, stored)
                    {
                        found.push(fragment.program_ids.globals[global.idx()]);
                    }
                }
            }
        });
        for global in found.into_iter().flat_map(|found| found.1) {
            for file in &called_on_their_namespace[&global] {
                if let Some(namespace) = namespaces.get_mut(file) {
                    namespace.gets_away = true;
                }
            }
        }
    }
    let stay = namespaces.values().filter(|namespace| !namespace.gets_away).count();
    let unread = namespaces.values().filter(|namespace| !namespace.gets_away).map(|namespace| namespace.is_read.iter().filter(|is_read| !**is_read).count()).sum();
    let known = &namespaces;
    let mut all: Vec<&mut Fragment> = fragments.iter_mut().collect();
    for_each_mut(&mut all, in_parallel, &|fragment| {
        let (anything, mut mentioning) = (fragment.tys.anything, Mentioning::default());
        let classes: Vec<LayoutId> = fragment.funcs.iter().map(|function| function.body.as_ref().map_or(LayoutId::NONE, |body| body.class)).collect();
        for function in &mut fragment.funcs {
            let (FuncKey::ModuleNamespaceReader(file), Some(func), Some(body)) = (function.key, &mut function.func, &mut function.body) else { continue };
            let Some(namespace) = known.get(&file).filter(|namespace| !namespace.gets_away) else { continue };
            if !matches!(func.blocks[Func::ENTRY.idx()].term, Some(Term::Switch { .. })) {
                continue;
            }
            let Some(Term::Switch { value, mut cases, default }) = func.blocks[Func::ENTRY.idx()].term.take() else { continue };
            let is_dropped = |case: &(i64, ir::Target)| namespace.is_read.get(case.0 as usize) == Some(&false) && case.1.args.is_empty() && case.1.block != default.block;
            let dead = cases.iter().find(|case| is_dropped(case)).map(|case| case.1.block);
            let is_dead_block_free = dead.is_some_and(|dead| func.blocks[dead.idx()].params.is_empty() && !cases.iter().any(|case| case.1.block == dead && !is_dropped(case)));
            let Some(dead) = dead.filter(|_| is_dead_block_free) else {
                func.blocks[Func::ENTRY.idx()].term = Some(Term::Switch { value, cases, default });
                continue;
            };
            for number in 0..cases.len() {
                if is_dropped(&cases[number]) {
                    cases[number].1 = ir::Target::new(dead);
                }
            }
            func.blocks[Func::ENTRY.idx()].term = Some(Term::Switch { value, cases, default });
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
            for number in (0..func.blocks.len()).filter(|&number| !is_reached[number] || number == dead.idx()) {
                let ir::Block { params, ops, .. } = std::mem::replace(&mut func.blocks[number], ir::Block { params: Vec::new(), ops: Vec::new(), term: Some(Term::Unreachable) });
                for at in params.into_iter().chain(ops) {
                    if let Some(&Op::FuncRef(exported)) = func.op(at)
                        && classes[exported.idx()].is_some()
                    {
                        classes_dropped.push(classes[exported.idx()]);
                    }
                    func.values[at.idx()] = ir::Value::new(Def::Op(Op::Undefined), 0, anything);
                }
            }
            let still_named: Vec<LayoutId> = func.values.iter().filter_map(|value| if let Def::Op(Op::FuncRef(exported)) = value.def { Some(classes[exported.idx()]) } else { None }).collect();
            body.classes_as_values.retain(|class| !classes_dropped.contains(class) || still_named.contains(class));
            body.mentions = mentioning.of_func(func);
        }
    });
    (namespaces.len(), stay, unread)
}
