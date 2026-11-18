use bun_engine_macros::cell;

use crate::{CallFrame, Coroutine, Cx, Gc, JsResult};

#[cell(name = "Generator", cell_type = Generator)]
pub struct JsGenerator {
    base: Coroutine,
}

impl JsGenerator {
    #[inline(always)]
    pub fn for_frame(cx: &mut Cx, frame: &CallFrame) -> JsResult<Gc<JsGenerator>> {
        let shape = Coroutine::shape_for_frame::<Self>(cx, frame, Cx::generator_shape)?;
        let base = Coroutine::init::<Self>(shape, frame);
        Coroutine::allocate(cx, frame, JsGeneratorInit { base })
    }
}
