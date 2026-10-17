use crate::declared::prim;
use crate::id::{FuncId, V};
use crate::ir::{func_flags, Func, Op, Prediction, Program, Term};

const ROPE_BYTES_BEYOND_ARRAY_ELEMENT: usize = 24;
const MAX_CALL_DEPTH: u32 = 3;
const MAX_USE_DEPTH: u32 = 4;

pub(crate) struct JoinSite {
    pub func: FuncId,
    pub join: V,
    pub rejection: Option<String>,
}

fn skip_coercions(func: &Func, mut v: V) -> V {
    while let Some(&Op::Coerce { value, .. }) = func.op(v) {
        v = value;
    }
    v
}

fn minimum_length(program: &Program, func: &Func, v: V, depth: u32) -> usize {
    if v.is_none() {
        return 0;
    }
    match func.op(skip_coercions(func, v)) {
        Some(&Op::Str(text)) => program.strs.get(text).iter().filter(|&&byte| byte & 0xc0 != 0x80).count(),
        Some(Op::StrConcat(parts)) => parts.iter().map(|&part| minimum_length(program, func, part, depth)).sum(),
        Some(&Op::ToStr(value)) => minimum_length(program, func, value, depth),
        Some(&Op::CallDirect { func: callee, .. }) if depth > 0 => minimum_result_length(program, callee, depth - 1),
        _ => 0,
    }
}

fn minimum_result_length(program: &Program, id: FuncId, depth: u32) -> usize {
    let func = &program.funcs[id.idx()];
    let returned = func.blocks.iter().filter_map(|block| match block.term {
        Some(Term::Return(v)) => Some(minimum_length(program, func, v, depth)),
        _ => None,
    });
    returned.min().unwrap_or(0)
}

fn count_uses(func: &Func, used: V) -> usize {
    let mut uses = 0;
    for block in &func.blocks {
        for &v in &block.ops {
            if let Some(op) = func.op(v) {
                op.for_each_operand(|operand| uses += usize::from(operand == used));
            }
        }
        if let Some(term) = &block.term {
            term.for_each_operand(|operand| uses += usize::from(operand == used));
        }
    }
    uses
}

fn is_only_concatenated(program: &Program, func: &Func, string: V, depth: u32) -> bool {
    let is_empty_string = |v: V| matches!(func.op(skip_coercions(func, v)), Some(&Op::Str(text)) if program.strs.get(text).is_empty());
    for block in &func.blocks {
        for &user in &block.ops {
            let Some(op) = func.op(user) else { continue };
            let mut is_user = false;
            op.for_each_operand(|operand| is_user |= operand == string);
            if !is_user {
                continue;
            }
            let is_harmless = match *op {
                Op::StrConcat(_) => true,
                Op::ToStr(_) | Op::Coerce { .. } => depth > 0 && is_only_concatenated(program, func, user, depth - 1),
                Op::StrictEq { a, b } => is_empty_string(a) || is_empty_string(b),
                _ => false,
            };
            if !is_harmless {
                return false;
            }
        }
        let Some(term) = &block.term else { continue };
        if let Term::Branch { cond: value, .. } | Term::Switch { value, .. } | Term::Return(value) | Term::Throw { value, .. } = *term
            && value == string
        {
            return false;
        }
        let mut is_harmless = true;
        term.for_each_target(|target| {
            for (index, _) in target.args.iter().enumerate().filter(|argument| *argument.1 == string) {
                is_harmless &= depth > 0 && is_only_concatenated(program, func, func.blocks[target.block.idx()].params[index], depth - 1);
            }
        });
        if !is_harmless {
            return false;
        }
    }
    true
}

fn returns_only_strings(program: &Program, callback: FuncId) -> bool {
    let result = program.funcs[callback.idx()].result;
    if result.is_none() {
        return false;
    }
    let result = program.tys.get(result);
    result.prims & (prim::STRING | prim::LITERAL_STRING) != 0
        && result.prims & !(prim::STRING | prim::LITERAL_STRING | prim::NULLISH) == 0
        && result.parts.is_empty()
        && result.ints.is_none()
        && !result.any_object
        && !result.any_function
}

fn rejection_of(program: &Program, func: &Func, ops: &[V], index: usize, mapped: V, callbacks: &[V], separators: &[V]) -> Option<String> {
    let [separator] = separators else { return Some("join() is not passed exactly one argument".into()) };
    if !matches!(func.op(*separator), Some(Op::Str(_))) {
        return Some("the separator is not a string literal".into());
    }
    let [callback] = callbacks else { return Some("map() is not passed exactly one argument".into()) };
    let callback = skip_coercions(func, *callback);
    let callback = match (func.op(callback), func.prediction(callback)) {
        (Some(&Op::FuncRef(callback) | &Op::Closure { func: callback, .. } | &Op::ClosureOnce { func: callback, .. }), _) | (_, Prediction::Closure(callback)) => callback,
        _ => return Some("which function the callback is cannot be told at build time".into()),
    };
    if !returns_only_strings(program, callback) {
        return Some("the callback may return something other than a string".into());
    }
    if ops[..index].iter().rev().find(|&&v| !matches!(func.op(v), Some(Op::Str(_)))) != Some(&mapped) {
        return Some("other code runs between map() and join(), or they are inside try".into());
    }
    if count_uses(func, mapped) != 1 {
        return Some("the mapped array is used again".into());
    }
    if !is_only_concatenated(program, func, ops[index], MAX_USE_DEPTH) {
        return Some("the joined string is used for something other than concatenation".into());
    }
    let length = minimum_result_length(program, callback, MAX_CALL_DEPTH) + minimum_length(program, func, *separator, 0);
    if length < ROPE_BYTES_BEYOND_ARRAY_ELEMENT {
        return Some(format!("a piece and the separator are only known to be {length} characters long, and it takes {ROPE_BYTES_BEYOND_ARRAY_ELEMENT} for the fused form to allocate less"));
    }
    None
}

pub(crate) fn find_join_sites(program: &Program) -> Vec<JoinSite> {
    let (Some(map), Some(join)) = (program.strs.find(b"map"), program.strs.find(b"join")) else { return Vec::new() };
    let mut sites = Vec::new();
    for (id, func) in program.funcs.iter().enumerate() {
        if func.has(func_flags::IS_BUILTIN) {
            continue;
        }
        for block in &func.blocks {
            for (index, &v) in block.ops.iter().enumerate() {
                let Some(Op::CallMethod { obj: mapped, name, args: separators }) = func.op(v) else { continue };
                if *name != join {
                    continue;
                }
                let callbacks = match func.op(*mapped) {
                    Some(Op::CallMethod { name, args, .. }) if *name == map => args,
                    Some(Op::Call { callee, this, args }) if matches!(func.op(*callee), Some(Op::PropGet { obj, name }) if *name == map && obj == this) => args,
                    _ => continue,
                };
                sites.push(JoinSite { func: FuncId::new(id), join: v, rejection: rejection_of(program, func, &block.ops, index, *mapped, callbacks, separators) });
            }
        }
    }
    sites
}
