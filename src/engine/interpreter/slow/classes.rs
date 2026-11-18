use bun_engine_vm::{JsObject, new_class};

use super::execute;

execute! {
    NewClass(op, cx, f) {
        let executable = f.code_block.function(cx, op.function);
        let (heritage, name) = (f.get_or_empty(op.heritage), f.get_or_empty(op.name));
        // SAFETY: what the generator has arranged.
        let (constructor, prototype) =
            unsafe { new_class(cx, executable, f.cell(op.scope), heritage, name) }?;
        f.set(op.constructor, constructor);
        f.set(op.prototype, prototype);
    }
    DefineMethod(op, cx, f) {
        let object = f.cell::<JsObject>(op.object);
        object.define_method(cx, f.get(op.key), f.cell(op.function), op.flags)?;
    }
    DefineAccessor(op, cx, f) {
        let (getter, setter) = (f.get(op.getter), f.get(op.setter));
        let object = f.cell::<JsObject>(op.object);
        object.define_accessor(cx, f.get(op.key), getter, setter, op.flags)?;
    }
}
