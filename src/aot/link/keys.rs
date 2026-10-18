use crate::declared::{Declared, Part, prim};
use crate::id::{StrId, V};
use crate::ir::{Def, Func, Op, Operation, Program, Term, class_flags, func_flags};
use bun_sema::program::FileId;
use bun_sema::util::{FxHashSet, InParallel, for_each_mut};

const FUNCTIONS_PER_TASK: usize = 256;

fn layouts_of_own_objects(program: &Program) -> Vec<bool> {
    let may_be_foreign = |flags: u32| flags & (class_flags::HAS_UNTYPED_BASE | class_flags::MAY_HAVE_OTHER_PROTOTYPE) != 0;
    let mut is_own: Vec<bool> = program.layouts.iter().map(|layout| !layout.accepts_untyped && !may_be_foreign(layout.class_flags)).collect();
    loop {
        let mut has_changed = false;
        for (index, layout) in program.layouts.iter().enumerate() {
            let mut related = Some(layout.base).filter(|base| base.is_some()).into_iter().chain(layout.members.iter().copied()).chain(layout.structural_subtypes.iter().copied()).chain(layout.specializations.iter().copied());
            if is_own[index] && related.any(|other| !is_own[other.idx()]) {
                is_own[index] = false;
                has_changed = true;
            }
        }
        if !has_changed {
            return is_own;
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

fn may_be_a_name(program: &Program, func: &Func, key: V, joins_seen: &mut Vec<V>) -> bool {
    let declared: &Declared = program.tys.get(func.ty(key));
    if declared.prims & (prim::STRING | prim::LITERAL_STRING) == 0 && !declared.has_objects() {
        return false;
    }
    match func.values[key.idx()].def {
        Def::Op(Op::PropGet { obj, name }) => !(WELL_KNOWN_SYMBOLS.contains(&program.strs.get(name)) && matches!(func.op(obj), Some(&Op::FreeGet { name, .. }) if program.strs.get(name) == b"Symbol")),
        Def::Op(Op::Coerce { value, .. }) => may_be_a_name(program, func, value, joins_seen),
        Def::Op(Op::Operation { which: Operation::ToLength, .. }) => false,
        Def::Param(block, index) if block != Func::ENTRY && !joins_seen.contains(&key) => {
            joins_seen.push(key);
            let mut handed: Vec<V> = Vec::new();
            for term in func.blocks.iter().filter_map(|from| from.term.as_ref()) {
                term.for_each_target(|target| handed.extend((target.block == block).then(|| target.args[index as usize])));
            }
            handed.into_iter().any(|value| may_be_a_name(program, func, value, joins_seen))
        }
        Def::Param(block, _) => block == Func::ENTRY,
        Def::Op(_) => true,
    }
}

fn is_own_object(receiver: &Declared, is_own: &[bool]) -> bool {
    receiver.prims & !prim::NULLISH == 0 && receiver.ints.is_none() && !receiver.any_object && !receiver.any_function && receiver.parts.iter().all(|part| matches!(part, Part::Class(layout) if layout.is_some() && is_own[layout.idx()]))
}

fn read_by_any_key(op: &Op) -> Option<(V, V)> {
    match op {
        &Op::ElemGet { obj, key } => Some((obj, key)),
        Op::Operation { which: Operation::SuperGet | Operation::GetOwnProperty, args } => Some((args[0], args[1])),
        Op::Operation { which: Operation::GetByValWithThis, args } => Some((args[0], args[2])),
        _ => None,
    }
}

fn read_by_key(func: &Func, op: &Op) -> Option<(V, V)> {
    read_by_any_key(op).filter(|&(_, key)| !matches!(func.op(key), Some(Op::Str(_) | Op::Int(_) | Op::Symbol(_))))
}

fn may_be_a_function(receiver: &Declared, is_own: &[bool]) -> bool {
    receiver.any_object
        || receiver.any_function
        || receiver.parts.iter().any(|part| match part {
            Part::Class(layout) => layout.is_none() || !is_own[layout.idx()],
            Part::Array(_) | Part::Global(..) => true,
        })
}

fn is_only_looked_at(func: &Func, found: V, casts_followed: u32) -> bool {
    let is_operand = |op: &Op| {
        let mut is_operand = false;
        op.for_each_operand(|operand| is_operand |= operand == found);
        is_operand
    };
    let by_operations = func.values.iter().enumerate().all(|(index, value)| match &value.def {
        Def::Op(op) if is_operand(op) => match op {
            Op::StrictEq { .. } | Op::LooseEq { .. } | Op::InstanceOf { .. } | Op::TypeOf(_) | Op::Truthy(_) | Op::Not(_) | Op::IsNullish(_) | Op::PropHas { .. } | Op::PropGet { .. } => true,
            &Op::ElemGet { obj, key } => obj == found && key != found && matches!(func.op(key), Some(Op::Int(_) | Op::Str(_) | Op::Symbol(_))),
            Op::Coerce { .. } => casts_followed > 0 && is_only_looked_at(func, V::new(index), casts_followed - 1),
            _ => false,
        },
        _ => true,
    });
    by_operations
        && func.blocks.iter().filter_map(|block| block.term.as_ref()).all(|term| {
            let mut is_handed_on = matches!(term, Term::Return(value) | Term::Throw { value, .. } | Term::Switch { value, .. } if *value == found);
            term.for_each_target(|target| is_handed_on |= target.args.contains(&found));
            !is_handed_on
        })
}

fn may_find_the_constructor_of_functions(program: &Program, func: &Func, at: V, op: &Op, is_own: &[bool]) -> bool {
    let is_constructor = |name: StrId| program.strs.get(name) == b"constructor";
    let of_function = |obj: V| may_be_a_function(program.tys.get(func.ty(obj)), is_own);
    match op {
        &Op::CallMethod { obj, name, .. } => is_constructor(name) && of_function(obj),
        &Op::PropGet { obj, name } => is_constructor(name) && of_function(obj) && !is_only_looked_at(func, at, 2),
        Op::Operation { which: Operation::SuperGet, args } if matches!(func.op(args[1]), Some(&Op::Str(name)) if is_constructor(name)) => true,
        _ => match read_by_any_key(op) {
            Some((obj, key)) => {
                let may_say_constructor = match func.op(key) {
                    Some(&Op::Str(name)) => is_constructor(name),
                    Some(Op::Int(_) | Op::Symbol(_)) => false,
                    _ => may_be_a_name(program, func, key, &mut Vec::new()),
                };
                may_say_constructor && of_function(obj) && !is_only_looked_at(func, at, 2)
            }
            None => false,
        },
    }
}

const MAKE_OR_LOAD_CODE: [&[u8]; 17] = [
    b"FFI",
    b"Function",
    b"ModuleGraph",
    b"ShadowRealm",
    b"Worker",
    b"_linkedBinding",
    b"binding",
    b"dlopen",
    b"enableLoadExtension",
    b"eval",
    b"getBuiltinModule",
    b"getProtectedObjects",
    b"loadExtension",
    b"mainModule",
    b"plugin",
    b"require",
    b"setCustomSQLite",
];

fn may_find_what_makes_or_loads_code(program: &Program, func: &Func, at: V, op: &Op, is_own: &[bool]) -> bool {
    let is_such = |obj: V, name: StrId| MAKE_OR_LOAD_CODE.contains(&program.strs.get(name)) && !matches!(func.op(obj), Some(Op::FreeGet { .. })) && may_be_a_function(program.tys.get(func.ty(obj)), is_own);
    match op {
        &Op::CallMethod { obj, name, .. } => is_such(obj, name),
        &Op::PropGet { obj, name } => is_such(obj, name) && !is_only_looked_at(func, at, 2),
        _ => false,
    }
}

pub(super) struct Reads {
    pub(super) of_any_property: Vec<(FileId, u32)>,
    pub(super) that_may_find_the_constructor_of_functions: Vec<(FileId, u32)>,
    pub(super) that_may_find_what_makes_or_loads_code: Vec<(FileId, u32)>,
}

pub(super) fn reads_without_a_name(program: &Program, modules: &[FileId], files_of_prelude: &FxHashSet<FileId>, in_parallel: InParallel<'_>) -> Reads {
    let is_own = layouts_of_own_objects(program);
    let mut tasks: Vec<(&[Func], Vec<(FileId, u32)>, Vec<(FileId, u32)>, Vec<(FileId, u32)>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new(), Vec::new(), Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, found, finding_constructor, finding_loaders)| {
        for func in funcs.iter().filter(|func| func.module.is_some()) {
            let file = modules[func.module.idx()];
            let is_of_runtime = func.has(func_flags::IS_BUILTIN) || func.has(func_flags::IS_IN_BUILTIN_MODULE);
            if !is_of_runtime && !files_of_prelude.contains(&file) && finding_constructor.last().is_none_or(|last| last.0 != file) {
                let finds = func.values.iter().enumerate().find(|(index, value)| matches!(&value.def, Def::Op(op) if may_find_the_constructor_of_functions(program, func, V::new(*index), op, &is_own)));
                finding_constructor.extend(finds.map(|(_, value)| (file, value.pos)));
            }
            if !is_of_runtime && !files_of_prelude.contains(&file) && finding_loaders.last().is_none_or(|last| last.0 != file) {
                let finds = func.values.iter().enumerate().find(|(index, value)| matches!(&value.def, Def::Op(op) if may_find_what_makes_or_loads_code(program, func, V::new(*index), op, &is_own)));
                finding_loaders.extend(finds.map(|(_, value)| (file, value.pos)));
            }
            for value in &func.values {
                if let Def::Op(op) = &value.def
                    && let Some((obj, key)) = read_by_key(func, op)
                    && may_be_a_name(program, func, key, &mut Vec::new())
                    && !is_own_object(program.tys.get(func.ty(obj)), &is_own)
                    && (is_of_runtime || found.last().is_none_or(|last| last.0 != file))
                {
                    found.push((file, value.pos));
                    if is_of_runtime {
                        break;
                    }
                }
            }
        }
    });
    let mut reads = Reads { of_any_property: Vec::new(), that_may_find_the_constructor_of_functions: Vec::new(), that_may_find_what_makes_or_loads_code: Vec::new() };
    for (_, of_any_property, finding_constructor, finding_loaders) in tasks {
        reads.of_any_property.extend(of_any_property);
        reads.that_may_find_the_constructor_of_functions.extend(finding_constructor);
        reads.that_may_find_what_makes_or_loads_code.extend(finding_loaders);
    }
    reads
}
