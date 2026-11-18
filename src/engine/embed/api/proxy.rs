use bun_engine_macros::export;
use bun_engine_vm::{Cx, Gc, JsResult, ProxyObject, Value};

#[export]
fn proxy_create(cx: &Cx, target: Value, handler: Value) -> JsResult<Gc<ProxyObject>> {
    ProxyObject::create(cx, target, handler)
}
