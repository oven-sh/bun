use boa_engine::{Context, JsValue, NativeFunction, JsString};
use boa_engine::object::ObjectInitializer;
use boa_engine::property::Attribute;

#[no_mangle]
pub unsafe extern "C" fn init_module(ctx: *mut Context) {
    let context = &mut *ctx;

    let hello_fn = NativeFunction::from_fn_ptr(|_this, _args, _ctx| {
        Ok(JsValue::from(JsString::from("Hello from the N-API Native Module!")))
    });

    let hello_obj = ObjectInitializer::new(context)
        .function(hello_fn, JsString::from("helloNative"), 0)
        .build();

    let hello_val = hello_obj.get(JsString::from("helloNative"), context).unwrap();

    let _ = context.register_global_property(
        JsString::from("helloNative"),
        hello_val,
        Attribute::all()
    );
}
