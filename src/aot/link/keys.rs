use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{StrId, V};
use crate::ir::{Def, Func, Op, Operation, Program, Strs, Term, class_flags, func_flags};
use bun_sema::atom::{Interner, known};
use bun_sema::bind::{AccessKind, Decl, Parent, PatParent, SymFlags, SymbolId};
use bun_sema::hir::{BinOp, ExprId, ExprKind, Flags, PropKey, PropKind, StmtKind, UnOp, VarKind};
use bun_sema::program::{FileId, Files, Module};
use bun_sema::util::{FxHashMap, FxHashSet, InParallel, for_each_mut};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

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
        Def::Op(Op::StrConcat(ref pieces)) => !pieces.iter().any(|&piece| matches!(func.op(piece), Some(&Op::Str(text)) if program.strs.get(text).iter().any(|&byte| byte.is_ascii() && !byte.is_ascii_alphanumeric() && !matches!(byte, b'_' | b'$')))),
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

const STEPS_OF_A_LOOK: u32 = 4;

fn is_only_looked_at(strs: &Strs, func: &Func, found: V, steps_followed: u32) -> bool {
    let is_of_runtime = func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE);
    let is_operand = |op: &Op| {
        let mut is_operand = false;
        op.for_each_operand(|operand| is_operand |= operand == found);
        is_operand
    };
    let by_operations = func.values.iter().enumerate().all(|(index, value)| match &value.def {
        Def::Op(op) if is_operand(op) => match op {
            Op::StrictEq { .. } | Op::LooseEq { .. } | Op::TypeOf(_) | Op::Truthy(_) | Op::Not(_) | Op::IsNullish(_) | Op::PropHas { .. } => true,
            &Op::InstanceOf { value, .. } => value != found,
            &Op::PropGet { name, .. } if is_of_runtime || matches!(strs.get(name), b"name" | b"length" | b"prototype") => true,
            &Op::ElemGet { obj, key } if obj != found || key == found || !matches!(func.op(key), Some(Op::Int(_) | Op::Str(_) | Op::Symbol(_))) => false,
            &Op::ElemGet { key, .. } if is_of_runtime || !matches!(func.op(key), Some(Op::Str(_))) => true,
            Op::PropGet { .. } | Op::ElemGet { .. } | Op::Coerce { .. } => steps_followed > 0 && is_only_looked_at(strs, func, V::new(index), steps_followed - 1),
            _ => false,
        },
        _ => true,
    });
    by_operations
        && func.blocks.iter().filter_map(|block| block.term.as_ref()).all(|term| {
            let mut is_handed_on = matches!(term, Term::Return(value) | Term::Throw { value, .. } | Term::Switch { value, .. } if *value == found);
            term.for_each_target(|target| {
                for (index, _) in target.args.iter().enumerate().filter(|argument| *argument.1 == found) {
                    let joined = func.values.iter().position(|value| matches!(value.def, Def::Param(block, at) if block == target.block && at as usize == index));
                    is_handed_on |= steps_followed == 0 || !joined.is_some_and(|joined| is_only_looked_at(strs, func, V::new(joined), steps_followed - 1));
                }
            });
            !is_handed_on
        })
}

fn may_find_the_constructor_of_functions(program: &Program, func: &Func, at: V, op: &Op) -> bool {
    let is_constructor = |name: StrId| program.strs.get(name) == b"constructor";
    let may_inherit_from_a_function = |obj: V| program.tys.get(func.ty(obj)).has_objects();
    let holds_a_symbol = |obj: V| program.tys.get(func.ty(obj)).prims & prim::SYMBOL != 0;
    let hands_out_descriptors = |name: StrId| matches!(program.strs.get(name), b"getOwnPropertyDescriptor" | b"getOwnPropertyDescriptors");
    let is_sought_in = |obj: V, name: StrId| is_constructor(name) || hands_out_descriptors(name) && !matches!(func.op(obj), Some(Op::FreeGet { .. }));
    match op {
        &Op::CallMethod { obj, name, .. } => is_sought_in(obj, name) && may_inherit_from_a_function(obj),
        &Op::PropGet { obj, name } => is_sought_in(obj, name) && (may_inherit_from_a_function(obj) || holds_a_symbol(obj)) && !is_only_looked_at(&program.strs, func, at, STEPS_OF_A_LOOK),
        Op::Operation { which: Operation::SuperGet, args } if matches!(func.op(args[1]), Some(&Op::Str(name)) if is_constructor(name) || hands_out_descriptors(name)) => true,
        _ => match read_by_any_key(op) {
            Some((obj, key)) => {
                let may_say_constructor = match func.op(key) {
                    Some(&Op::Str(name)) => is_sought_in(obj, name),
                    Some(Op::Int(_) | Op::Symbol(_)) => false,
                    _ => may_be_a_name(program, func, key, &mut Vec::new()),
                };
                may_say_constructor && (may_inherit_from_a_function(obj) || holds_a_symbol(obj)) && !is_only_looked_at(&program.strs, func, at, STEPS_OF_A_LOOK)
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
    let is_refused = |name: &[u8]| matches!(name, b"Function" | b"eval") && bun_core::code_generation_from_strings_in_built_executable() != bun_core::CodeGenerationFromStrings::Allowed;
    let is_such = |obj: V, name: StrId| MAKE_OR_LOAD_CODE.contains(&program.strs.get(name)) && !is_refused(program.strs.get(name)) && !matches!(func.op(obj), Some(Op::FreeGet { .. })) && may_be_a_function(program.tys.get(func.ty(obj)), is_own);
    match *op {
        Op::CallMethod { obj, name, .. } => is_such(obj, name),
        Op::PropGet { obj, name } => is_such(obj, name) && !is_only_looked_at(&program.strs, func, at, STEPS_OF_A_LOOK),
        _ => false,
    }
}

fn may_be_made_by_create_require(func: &Func, create_require: StrId, value: V, joins_seen: &mut Vec<V>) -> bool {
    match func.values[value.idx()].def {
        Def::Op(Op::Call { callee, .. }) => matches!(func.op(callee), Some(&Op::PropGet { name, .. }) if name == create_require),
        Def::Op(Op::CallMethod { name, .. }) => name == create_require,
        Def::Op(Op::Coerce { value, .. }) => may_be_made_by_create_require(func, create_require, value, joins_seen),
        Def::Param(block, index) if block != Func::ENTRY && !joins_seen.contains(&value) => {
            joins_seen.push(value);
            let mut handed: Vec<V> = Vec::new();
            for term in func.blocks.iter().filter_map(|from| from.term.as_ref()) {
                term.for_each_target(|target| handed.extend((target.block == block).then(|| target.args[index as usize])));
            }
            handed.into_iter().any(|value| may_be_made_by_create_require(func, create_require, value, joins_seen))
        }
        _ => false,
    }
}

fn module_loaded_by_name<'p>(program: &'p Program, func: &Func, made_by: Option<StrId>, op: &Op) -> Option<&'p [u8]> {
    let name = match op {
        &Op::ExternalModule(name) if made_by.is_none() => Some(name),
        Op::Call { callee, args, .. } if made_by.is_some_and(|create_require| may_be_made_by_create_require(func, create_require, *callee, &mut Vec::new())) => args.first().and_then(|&name| super::constant_string(func, name)),
        Op::Operation { which: Operation::RequireExternalModule | Operation::ImportExternalModule | Operation::GetExternalModuleWithType, args } if made_by.is_none() => args.first().and_then(|&name| super::constant_string(func, name)),
        _ => return None,
    };
    Some(name.map_or(&b""[..], |name| program.strs.get(name))).filter(|name| !crate::build::is_builtin_specifier(name))
}

pub(super) fn may_print_an_object(strs: &Strs, tys: &DeclaredTable, func: &Func) -> bool {
    let is_console = |value: V| value.is_some() && matches!(func.op(value), Some(&Op::FreeGet { name, is_typeof: false }) if strs.get(name) == b"console");
    let is_method_of_console = |value: V| value.is_some() && matches!(func.op(value), Some(&Op::PropGet { obj, .. }) if is_console(obj));
    let is_either = |value: V| is_console(value) || is_method_of_console(value);
    let may_be_an_object = |value: &V| value.is_none() || tys.get(func.ty(*value)).has_objects();
    let by_operations = func.values.iter().any(|value| match &value.def {
        Def::Op(Op::CallMethod { obj, args, .. }) if is_console(*obj) => args.iter().any(may_be_an_object),
        Def::Op(Op::Call { callee, this, args }) if is_method_of_console(*callee) && is_console(*this) => args.iter().any(may_be_an_object),
        Def::Op(Op::PropGet { obj, .. }) if is_console(*obj) => false,
        Def::Op(op) => {
            let mut is_handed_on = false;
            op.for_each_operand(|operand| is_handed_on |= is_either(operand));
            is_handed_on
        }
        Def::Param(..) => false,
    });
    by_operations
        || func.blocks.iter().filter_map(|block| block.term.as_ref()).any(|term| {
            let mut is_handed_on = false;
            term.for_each_operand(|operand| is_handed_on |= is_either(operand));
            is_handed_on
        })
}

pub(super) fn stores_under_a_key_that_is_not_seen(program: &Program, modules: &[FileId], files_of_prelude: &FxHashSet<FileId>) -> bool {
    let is_of_program = |func: &&Func| func.module.is_some() && !func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) && !files_of_prelude.contains(&modules[func.module.idx()]);
    program.funcs.iter().filter(is_of_program).any(|func| {
        func.values.iter().any(|value| {
            let key = match &value.def {
                &Def::Op(Op::ElemSet { key, .. }) => key,
                Def::Op(Op::Operation { which: Operation::SuperSet, args }) => args[1],
                _ => return false,
            };
            !matches!(func.op(key), Some(Op::Str(_) | Op::Int(_) | Op::Symbol(_))) && may_be_a_name(program, func, key, &mut Vec::new())
        })
    })
}

fn may_be_a_symbol(program: &Program, func: &Func, key: V) -> bool {
    match func.op(key) {
        Some(Op::Str(_) | Op::Int(_) | Op::Symbol(_)) => false,
        Some(&Op::ToKey(value)) => may_be_a_symbol(program, func, value),
        Some(&Op::PropGet { obj, name }) if WELL_KNOWN_SYMBOLS.contains(&program.strs.get(name)) && matches!(func.op(obj), Some(&Op::FreeGet { name, .. }) if program.strs.get(name) == b"Symbol") => false,
        _ => {
            let declared = program.tys.get(func.ty(key));
            declared.prims & prim::SYMBOL != 0 || declared.has_objects()
        }
    }
}

pub(super) fn reads_the_constructor_of_a_symbol(program: &Program, modules: &[FileId], files_of_prelude: &FxHashSet<FileId>) -> bool {
    let is_of_program = |func: &&Func| func.module.is_some() && !func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) && !files_of_prelude.contains(&modules[func.module.idx()]);
    program.funcs.iter().filter(is_of_program).any(|func| {
        let holds_a_symbol = |value: V| {
            value.is_some() && {
                let declared = program.tys.get(func.ty(value));
                declared.prims & prim::SYMBOL != 0 && !declared.any_object && !declared.any_function
            }
        };
        func.values.iter().any(|value| match value.def {
            Def::Op(Op::PropGet { obj, name } | Op::CallMethod { obj, name, .. }) => program.strs.get(name) == b"constructor" && holds_a_symbol(obj),
            Def::Op(Op::ElemGet { obj, key }) => {
                holds_a_symbol(obj)
                    && match func.op(key) {
                        Some(&Op::Str(name)) => program.strs.get(name) == b"constructor",
                        Some(Op::Int(_) | Op::Symbol(_)) => false,
                        _ => may_be_a_name(program, func, key, &mut Vec::new()),
                    }
            }
            _ => false,
        })
    })
}

const HAND_OUT_MEMBERS: [&[u8]; 3] = [b"values", b"entries", b"assign"];

pub(super) fn takes_members_without_naming_them(program: &Program, modules: &[FileId], files_of_prelude: &FxHashSet<FileId>) -> bool {
    let is_own = layouts_of_own_objects(program);
    let is_of_program = |func: &&Func| func.module.is_some() && !func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) && !files_of_prelude.contains(&modules[func.module.idx()]);
    program.funcs.iter().filter(is_of_program).any(|func| {
        let is_global = |value: V, written: &[u8]| value.is_some() && matches!(func.op(value), Some(&Op::FreeGet { name, .. }) if program.strs.get(name) == written);
        let may_be_of_the_runtime = |value: &V| {
            let declared = program.tys.get(func.ty(*value));
            declared.any_object || declared.any_function || declared.parts.iter().any(|part| !matches!(part, Part::Array(_)) && !matches!(part, Part::Class(layout) if layout.is_some() && is_own[layout.idx()]))
        };
        let may_be_a_function = |value: V| value.is_some() && (program.tys.get(func.ty(value)).any_object || program.tys.get(func.ty(value)).any_function);
        let hands_out_members = |holder: V, name: StrId| HAND_OUT_MEMBERS.contains(&program.strs.get(name)) && (is_global(holder, b"Object") || may_be_a_function(holder));
        let is_stringify = |holder: V, name: StrId| is_global(holder, b"JSON") && program.strs.get(name) == b"stringify";
        let is_taken_by = |holder: V, name: StrId, args: &[V]| {
            let targets = usize::from(program.strs.get(name) == b"assign");
            hands_out_members(holder, name) && args.iter().skip(targets).any(may_be_of_the_runtime) || is_stringify(holder, name) && args.len() > 1 && may_be_of_the_runtime(&args[0]) && may_be_of_the_runtime(&args[1])
        };
        let member_at = |value: V| match func.op(value) {
            Some(&Op::PropGet { obj, name }) if hands_out_members(obj, name) || is_stringify(obj, name) => Some((obj, name)),
            _ => None,
        };
        let by_operations = func.values.iter().any(|value| match &value.def {
            Def::Op(Op::CallMethod { obj, name, args }) => is_taken_by(*obj, *name, args),
            Def::Op(Op::Call { callee, args, .. }) if member_at(*callee).is_some() => member_at(*callee).is_some_and(|(holder, name)| is_taken_by(holder, name, args)),
            Def::Op(Op::Operation { which: Operation::CloneObject | Operation::CloneObjectWith | Operation::CopyDataPropertiesExcluding, args }) => args.first().is_some_and(may_be_of_the_runtime),
            Def::Op(Op::Operation { which: Operation::CopyDataProperties, args }) => args.get(1).is_some_and(may_be_of_the_runtime),
            Def::Op(op) => {
                let mut is_handed_on = false;
                op.for_each_operand(|operand| is_handed_on |= operand.is_some() && member_at(operand).is_some());
                is_handed_on
            }
            Def::Param(..) => false,
        });
        by_operations
            || func.blocks.iter().filter_map(|block| block.term.as_ref()).any(|term| {
                let mut is_handed_on = false;
                term.for_each_operand(|operand| is_handed_on |= operand.is_some() && member_at(operand).is_some());
                is_handed_on
            })
    })
}

pub(super) fn writes_under_a_key_that_may_be_a_symbol(program: &Program, modules: &[FileId], files_of_prelude: &FxHashSet<FileId>) -> bool {
    let is_of_program = |func: &&Func| func.module.is_some() && !func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) && !files_of_prelude.contains(&modules[func.module.idx()]);
    program.funcs.iter().filter(is_of_program).any(|func| {
        let may_be_called = |value: V| value.is_none() || program.tys.get(func.ty(value)).has_objects();
        func.values.iter().any(|value| match &value.def {
            &Def::Op(Op::ElemSet { key, value, .. }) => may_be_a_symbol(program, func, key) && may_be_called(value),
            Def::Op(Op::Operation { which: Operation::DefineField, args }) => args.len() > 2 && may_be_a_symbol(program, func, args[1]) && may_be_called(args[2]),
            Def::Op(Op::Operation { which: Operation::SuperSet | Operation::DefineGetter | Operation::DefineSetter | Operation::DefineMethod, args }) => args.len() > 1 && may_be_a_symbol(program, func, args[1]),
            _ => false,
        })
    })
}

fn with_assertions(module: &Module<'_>, mut e: ExprId) -> ExprId {
    while let Parent::Expr(around) = module.bound.expr_parent[e.idx()]
        && matches!(module.hir[around].kind, ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_))
    {
        e = around;
    }
    e
}

fn without_assertions(module: &Module<'_>, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) = module.hir[e].kind {
        e = expr;
    }
    e
}

fn members_ignore_the_receiver(module: &Module<'_>, literal: ExprId) -> bool {
    let hir = &module.hir;
    let ExprKind::Object(members) = hir[literal].kind else { return false };
    let are_functions = members.iter().all(|member| matches!(hir[member].kind, PropKind::Init | PropKind::Method) && matches!(hir[hir[member].value].kind, ExprKind::Fn(_)));
    are_functions && !hir.exprs.iter().any(|e| matches!(e.kind, ExprKind::This | ExprKind::Super) && (hir[literal].pos..hir[literal].end).contains(&e.pos))
}

fn hands_the_receiver_to_nothing_that_keeps_it(module: &Module<'_>, literal: ExprId, member: ExprId, call_of_member: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let (ExprKind::Call(call), ExprKind::Object(members)) = (hir[call_of_member].kind, hir[literal].kind) else { return false };
    if !members_ignore_the_receiver(module, literal) {
        return false;
    }
    if matches!(hir[member].kind, ExprKind::Dot { name, .. } if members.iter().any(|own| hir[own].key == PropKey::Name(name))) {
        return true;
    }
    let mut arguments = hir.ids(hir[call].args);
    let takes_one_at_most = match (arguments.next(), arguments.next()) {
        (None, _) => true,
        (Some(only), None) => {
            let only: ExprId = only;
            !matches!(hir[only].kind, ExprKind::Spread(_))
        }
        _ => false,
    };
    let result = match bound.expr_parent[with_assertions(module, call_of_member).idx()] {
        Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Await(_)) => around,
        _ => call_of_member,
    };
    takes_one_at_most && is_only_tested_or_called(module, result, false, EXPRESSIONS_FOLLOWED)
}

fn call_of(module: &Module<'_>, member: ExprId) -> Option<ExprId> {
    let read = with_assertions(module, member);
    match module.bound.expr_parent[read.idx()] {
        Parent::Expr(user) if matches!(module.hir[user].kind, ExprKind::Call(call) if module.hir[call].callee == read) => Some(user),
        _ => None,
    }
}

fn member_read_from(module: &Module<'_>, mention: ExprId, literal: ExprId) -> Option<ExprId> {
    let (hir, bound) = (&module.hir, &module.bound);
    let receiver = with_assertions(module, mention);
    let Parent::Expr(member) = bound.expr_parent[receiver.idx()] else { return None };
    if !matches!(hir[member].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == receiver) {
        return None;
    }
    let read = with_assertions(module, member);
    let hands_on_the_receiver = matches!(bound.expr_parent[read.idx()], Parent::Expr(user) if match hir[user].kind {
        ExprKind::Call(call) if hir[call].callee == read => !hands_the_receiver_to_nothing_that_keeps_it(module, literal, member, user),
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => hir[call].callee == read,
        ExprKind::Unary { op: UnOp::Delete, .. } | ExprKind::Instantiation { .. } => true,
        _ => false,
    });
    (bound.access_kind(hir, member) == AccessKind::Read && bound.access_kind(hir, read) == AccessKind::Read && !hands_on_the_receiver).then_some(member)
}

const EXPRESSIONS_FOLLOWED: u32 = 8;

fn is_only_tested_or_called(module: &Module<'_>, value: ExprId, may_be_held: bool, followed: u32) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let value = with_assertions(module, value);
    let is_nullish = |e: ExprId| matches!(hir[e].kind, ExprKind::Null | ExprKind::Ident(known::undefined));
    let is_member = matches!(hir[without_assertions(module, value)].kind, ExprKind::Dot { .. } | ExprKind::Index { .. });
    match bound.expr_parent[value.idx()] {
        Parent::Expr(around) => match hir[around].kind {
            ExprKind::Unary { op: UnOp::Typeof | UnOp::Not, .. } | ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, .. } => true,
            ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq, left, right } => is_nullish(left) || is_nullish(right),
            ExprKind::Binary { op: BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge, .. } => true,
            ExprKind::Unary { op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Void, .. } | ExprKind::Template { .. } => true,
            ExprKind::Assign { op: Some(BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor), value: operand, .. } => operand == value,
            ExprKind::Binary { op: BinOp::And, left, .. } if left == value => true,
            ExprKind::Cond { test, .. } if test == value => true,
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } | ExprKind::Cond { .. } => followed > 0 && is_only_tested_or_called(module, around, may_be_held, followed - 1),
            ExprKind::Call(call) => hir[call].callee == value && !is_member,
            _ => false,
        },
        Parent::Stmt(around) => matches!(hir[around].kind, StmtKind::If { test, .. } if test == value) || matches!(hir[around].kind, StmtKind::Expr(_)),
        Parent::VarInit(declaration) if may_be_held => {
            let declared = &hir[declaration];
            let Some(holder) = bound.pat_symbol[declared.pat.idx()].some() else { return false };
            let symbol = &bound.symbols[holder.idx()];
            let is_exported_by_name = hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == symbol.name));
            let is_seen_whole = declared.kind == VarKind::Const
                && !declared.flags.intersects(Flags::EXPORT | Flags::AMBIENT)
                && matches!(symbol.decls[..], [Decl::Var(pat)] if pat == declared.pat)
                && !symbol.flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED)
                && !is_exported_by_name;
            let identifiers = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))).map(|it| ExprId::from(it.0 as u32));
            let mut mentions = identifiers.filter(|mention| bound.expr_symbol[mention.idx()] == holder && bound.expr_parent[mention.idx()] != Parent::None && !bound.is_in_type_query(*mention));
            is_seen_whole && mentions.all(|mention| is_only_tested_or_called(module, mention, false, EXPRESSIONS_FOLLOWED))
        }
        _ => false,
    }
}

fn is_asked_for_a_key(module: &Module<'_>, mention: ExprId) -> bool {
    let receiver = with_assertions(module, mention);
    matches!(module.bound.expr_parent[receiver.idx()], Parent::Expr(around) if matches!(module.hir[around].kind, ExprKind::Binary { op: BinOp::In, right, .. } if right == receiver))
}

const ASK_ONLY_FOR_OWN_MEMBERS: [&[u8]; 5] = [b"entries", b"getOwnPropertyNames", b"hasOwn", b"keys", b"values"];

fn is_asked_for_its_own_members(module: &Module<'_>, atoms: &Interner<'_>, mention: ExprId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let receiver = with_assertions(module, mention);
    let is_asking = |callee: ExprId| matches!(hir[callee].kind, ExprKind::Dot { obj, name, .. } if matches!(hir[obj].kind, ExprKind::Ident(known::Object)) && bound.expr_symbol[obj.idx()].is_none() && ASK_ONLY_FOR_OWN_MEMBERS.contains(&atoms.bytes(name)));
    match bound.expr_parent[receiver.idx()] {
        Parent::Expr(around) => matches!(hir[around].kind, ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(receiver) && is_asking(hir[call].callee)),
        Parent::Stmt(around) => matches!(hir[around].kind, StmtKind::ForIn { expr, .. } if expr == receiver),
        _ => false,
    }
}

fn constants_that_hold_an_object_literal(module: &Module<'_>) -> FxHashMap<SymbolId, ExprId> {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_plain = |literal: ExprId| {
        matches!(hir[literal].kind, ExprKind::Object(members) if members.iter().all(|member| {
            matches!(hir[member].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method) && matches!(hir[member].key, PropKey::Name(name) if name != known::__proto__)
        }))
    };
    let is_exported_by_name = |holder: SymbolId| hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == bound.symbols[holder.idx()].name));
    let mut holders = FxHashMap::default();
    for declared in hir.var_decls.iter().filter(|declared| declared.kind == VarKind::Const && declared.init.is_some() && !declared.flags.intersects(Flags::EXPORT | Flags::AMBIENT)) {
        let Some(holder) = bound.pat_symbol[declared.pat.idx()].some() else { continue };
        let symbol = &bound.symbols[holder.idx()];
        let is_declared_once = matches!(symbol.decls[..], [Decl::Var(pat)] if pat == declared.pat && matches!(bound.pat_parent[pat.idx()], PatParent::Var(_)));
        if is_declared_once && !symbol.flags.intersects(SymFlags::ASSIGNED | SymFlags::MERGED) && is_plain(without_assertions(module, declared.init)) && !is_exported_by_name(holder) {
            holders.insert(holder, without_assertions(module, declared.init));
        }
    }
    holders
}

#[derive(Default)]
struct ReadsOfUnsharedLiterals {
    all: FxHashSet<u32>,
    whose_result_is_only_tested_or_called: FxHashSet<u32>,
}

fn reads_by_key_of_object_literals_that_nothing_else_holds(module: &Module<'_>, atoms: &Interner<'_>) -> ReadsOfUnsharedLiterals {
    let (hir, bound) = (&module.hir, &module.bound);
    let mut holders = constants_that_hold_an_object_literal(module);
    if holders.is_empty() {
        return ReadsOfUnsharedLiterals::default();
    }
    let mentions = || {
        let identifiers = hir.exprs.iter().enumerate().filter(|it| matches!(it.1.kind, ExprKind::Ident(_))).map(|it| ExprId::from(it.0 as u32));
        identifiers.filter(|mention| bound.expr_parent[mention.idx()] != Parent::None && !bound.is_in_type_query(*mention))
    };
    for mention in mentions() {
        if let Some(holder) = bound.expr_symbol[mention.idx()].some()
            && let Some(&literal) = holders.get(&holder)
            && member_read_from(module, mention, literal).is_none()
            && !is_asked_for_a_key(module, mention)
            && !is_asked_for_its_own_members(module, atoms, mention)
        {
            holders.remove(&holder);
        }
    }
    let of_holders = mentions().filter_map(|mention| Some((mention, *holders.get(&bound.expr_symbol[mention.idx()].some()?)?)));
    let mut reads = ReadsOfUnsharedLiterals::default();
    for (mention, literal) in of_holders {
        let Some(member) = member_read_from(module, mention, literal).filter(|&member| matches!(hir[member].kind, ExprKind::Index { .. })) else { continue };
        let is_called_in_place = call_of(module, member).is_some();
        let holds_another_read = |key: ExprId| hir.exprs.iter().any(|other| matches!(other.kind, ExprKind::Index { index, .. } if !matches!(hir[index].kind, ExprKind::Number(_) | ExprKind::String(_))) && (hir[key].pos..hir[key].end).contains(&other.pos));
        if is_called_in_place && matches!(hir[member].kind, ExprKind::Index { index, .. } if holds_another_read(index)) {
            continue;
        }
        let at = if is_called_in_place { crate::positions::last_pos(hir, member) } else { hir[mention].pos };
        reads.all.insert(at);
        if is_called_in_place || is_only_tested_or_called(module, member, true, EXPRESSIONS_FOLLOWED) {
            reads.whose_result_is_only_tested_or_called.insert(at);
        }
    }
    reads
}

pub(super) struct Reads {
    pub(super) of_any_property: Vec<(FileId, u32)>,
    pub(super) by_a_key_that_may_be_a_name: bool,
    pub(super) that_may_find_the_constructor_of_functions: Vec<(FileId, u32)>,
    pub(super) that_may_find_what_makes_or_loads_code: Vec<(FileId, u32)>,
    pub(super) of_modules_that_are_not_compiled: Vec<(FileId, Vec<u8>)>,
}

pub(super) fn reads_without_a_name(program: &Program, modules: &[FileId], files: &Files<'_>, files_of_prelude: &FxHashSet<FileId>, in_parallel: InParallel<'_>) -> Reads {
    let is_own = layouts_of_own_objects(program);
    let create_require = program.strs.find(b"createRequire");
    let reads_of_unshared_literals: Vec<OnceLock<ReadsOfUnsharedLiterals>> = modules.iter().map(|_| OnceLock::new()).collect();
    let reads_by_key = AtomicBool::new(false);
    let mut tasks: Vec<(&[Func], Vec<(FileId, u32)>, Vec<(FileId, u32)>, Vec<(FileId, u32)>, Vec<(FileId, Vec<u8>)>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new(), Vec::new(), Vec::new(), Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, found, finding_constructor, finding_loaders, loading)| {
        for func in funcs.iter().filter(|func| func.module.is_some()) {
            let file = modules[func.module.idx()];
            let is_of_runtime = func.has(func_flags::IS_BUILTIN) || func.has(func_flags::IS_IN_BUILTIN_MODULE);
            let of_unshared_literals = |op: &Op| {
                let is_of_program = !is_of_runtime && !files_of_prelude.contains(&file);
                (is_of_program && matches!(op, Op::ElemGet { .. })).then(|| reads_of_unshared_literals[func.module.idx()].get_or_init(|| reads_by_key_of_object_literals_that_nothing_else_holds(files.module(file), &files.atoms)))
            };
            if is_of_runtime || files_of_prelude.contains(&file) || finding_constructor.last().is_none_or(|last| last.0 != file) {
                let finds = func.values.iter().enumerate().find(|(index, value)| matches!(&value.def, Def::Op(op) if may_find_the_constructor_of_functions(program, func, V::new(*index), op) && !of_unshared_literals(op).is_some_and(|reads| reads.whose_result_is_only_tested_or_called.contains(&value.pos))));
                finding_constructor.extend(finds.map(|(_, value)| (file, value.pos)));
            }
            if !is_of_runtime && !files_of_prelude.contains(&file) && finding_loaders.last().is_none_or(|last| last.0 != file) {
                let finds = func.values.iter().enumerate().find(|(index, value)| matches!(&value.def, Def::Op(op) if may_find_what_makes_or_loads_code(program, func, V::new(*index), op, &is_own)));
                finding_loaders.extend(finds.map(|(_, value)| (file, value.pos)));
            }
            if !is_of_runtime && !files_of_prelude.contains(&file) {
                let mut names_create_require = false;
                for value in &func.values {
                    let Def::Op(op) = &value.def else { continue };
                    names_create_require |= matches!(op, Op::PropGet { name, .. } | Op::CallMethod { name, .. } if Some(*name) == create_require);
                    loading.extend(module_loaded_by_name(program, func, None, op).map(|name| (file, name.to_vec())));
                }
                if names_create_require {
                    let asked_of_what_is_made = func.values.iter().filter_map(|value| match &value.def {
                        Def::Op(op) => module_loaded_by_name(program, func, create_require, op),
                        _ => None,
                    });
                    loading.extend(asked_of_what_is_made.map(|name| (file, name.to_vec())));
                }
            }
            let mut is_counted_here = false;
            for value in &func.values {
                if let Def::Op(op) = &value.def
                    && let Some((obj, key)) = read_by_key(func, op)
                    && may_be_a_name(program, func, key, &mut Vec::new())
                {
                    reads_by_key.store(true, Ordering::Relaxed);
                    let is_let_off = is_own_object(program.tys.get(func.ty(obj)), &is_own) || if is_of_runtime { is_counted_here } else { found.last().is_some_and(|last| last.0 == file) };
                    if !is_let_off && !of_unshared_literals(op).is_some_and(|reads| reads.all.contains(&value.pos)) {
                        found.push((file, value.pos));
                        is_counted_here = true;
                    }
                }
            }
        }
    });
    let mut reads = Reads { of_any_property: Vec::new(), by_a_key_that_may_be_a_name: reads_by_key.into_inner(), that_may_find_the_constructor_of_functions: Vec::new(), that_may_find_what_makes_or_loads_code: Vec::new(), of_modules_that_are_not_compiled: Vec::new() };
    for (_, of_any_property, finding_constructor, finding_loaders, loading) in tasks {
        reads.of_any_property.extend(of_any_property);
        reads.that_may_find_the_constructor_of_functions.extend(finding_constructor);
        reads.that_may_find_what_makes_or_loads_code.extend(finding_loaders);
        reads.of_modules_that_are_not_compiled.extend(loading);
    }
    reads
}
