use bun_engine_vm::RegExpObject;

use super::execute;

execute! {
    NewRegExp(op, cx, f) {
        let regexp = f.code_block.constant(op.regexp.0).expect("a pattern").cast();
        f.set(op.dst, RegExpObject::for_literal(cx, regexp)?);
    }
    NewSharedRegExp(op, cx, f) {
        let regexp = f.code_block.constant(op.regexp.0).expect("a pattern").cast();
        let shared = f.entry(op.metadata);
        // SAFETY: the entry of this instruction.
        f.set(op.dst, unsafe { RegExpObject::literal_as_receiver(cx, f.code_block, regexp, op.for_test, shared) }?);
    }
}
