use crate::id::V;
use crate::ir::Op;

impl Op {
    pub fn for_each_operand_mut(&mut self, mut f: impl FnMut(&mut V)) {
        match self {
            Op::Undefined
            | Op::Null
            | Op::Bool(_)
            | Op::Int(_)
            | Op::Double(_)
            | Op::Str(_)
            | Op::BigInt(_)
            | Op::Symbol(_)
            | Op::FuncRef(_)
            | Op::GlobalGet(_)
            | Op::FreeGet { .. }
            | Op::New(_)
            | Op::NewObject
            | Op::Caught
            | Op::CaughtException
            | Op::Poll
            | Op::ResumeMode
            | Op::ExternalModule(_) => {}
            Op::GlobalSet(_, a)
            | Op::FreeSet { value: a, .. }
            | Op::NewWith { value: a, .. }
            | Op::Coerce { value: a, .. }
            | Op::IsInstance { value: a, .. }
            | Op::FieldGet { obj: a, .. }
            | Op::PropGet { obj: a, .. }
            | Op::PropHas { obj: a, .. }
            | Op::PropDelete { obj: a, .. }
            | Op::Unary { a, .. }
            | Op::Not(a)
            | Op::Truthy(a)
            | Op::TypeOf(a)
            | Op::ToStr(a)
            | Op::ToKey(a)
            | Op::IsNullish(a)
            | Op::IterOpen(a)
            | Op::IterClose(a)
            | Op::IterCloseForThrow(a)
            | Op::Yield(a)
            | Op::Await(a) => f(a),
            Op::FieldSet {
                obj: a, value: b, ..
            }
            | Op::PropSet {
                obj: a, value: b, ..
            }
            | Op::ElemGet { obj: a, key: b }
            | Op::ElemHas { obj: a, key: b }
            | Op::ElemDelete { obj: a, key: b }
            | Op::Binary { a, b, .. }
            | Op::Relational { a, b, .. }
            | Op::StrictEq { a, b }
            | Op::LooseEq { a, b }
            | Op::InstanceOf { value: a, of: b }
            | Op::IterHas { iter: a, index: b }
            | Op::IterGet { iter: a, index: b } => {
                f(a);
                f(b);
            }
            Op::ElemSet { obj, key, value } => {
                f(obj);
                f(key);
                f(value);
            }
            Op::Closure { captures: args, .. }
            | Op::NewArray(args)
            | Op::StrConcat(args)
            | Op::Operation { args, .. }
            | Op::CallDirect { args, .. } => args.iter_mut().for_each(f),
            Op::ClosureOnce { captures, env, .. } => {
                captures.iter_mut().for_each(&mut f);
                f(env);
            }
            Op::Call { callee, this, args } => {
                f(callee);
                f(this);
                args.iter_mut().for_each(f);
            }
            Op::Construct { callee: a, args } | Op::CallMethod { obj: a, args, .. } => {
                f(a);
                args.iter_mut().for_each(f);
            }
        }
    }
}
