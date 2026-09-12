//! This namespace is used to test binding generator

use crate::js_object::PojoFields;
use crate::{JSGlobalObject, JSObject, JSValue, JsResult};

use crate::r#gen::bindgen_test as generated;

pub fn get_bindgen_test_functions(global: &JSGlobalObject) -> JsResult<JSValue> {
    // Rust has no field reflection, so a local `PojoFields` impl enumerates
    // the fields.
    struct Fns {
        add: JSValue,
        required_and_optional_arg: JSValue,
    }
    impl PojoFields for Fns {
        const FIELD_COUNT: usize = 2;
        fn put_fields(
            &self,
            _global: &JSGlobalObject,
            mut put: impl FnMut(&'static [u8], JSValue) -> JsResult<()>,
        ) -> JsResult<()> {
            put(b"add", self.add)?;
            put(b"requiredAndOptionalArg", self.required_and_optional_arg)?;
            Ok(())
        }
    }
    let pojo = Fns {
        add: generated::create_add_callback(global),
        required_and_optional_arg: generated::create_required_and_optional_arg_callback(global),
    };
    Ok(JSObject::create(&pojo, global)?.to_js())
}

// This example should be kept in sync with bindgen's documentation
pub fn add(global: &JSGlobalObject, a: i32, b: i32) -> JsResult<i32> {
    match a.checked_add(b) {
        Some(v) => Ok(v),
        None => {
            // Binding functions can propagate out-of-memory and JS exceptions
            // directly; other failures (like this integer overflow) must be
            // converted into a thrown error. Remember to be descriptive.
            Err(global.throw(format_args!("Integer overflow while adding")))
        }
    }
}

pub fn required_and_optional_arg(a: bool, b: Option<usize>, c: i32, d: Option<u8>) -> i32 {
    let Some(b_nonnull) = b else {
        return 123456i32
            .wrapping_add(c)
            .wrapping_add(i32::from(d.unwrap_or(0)));
    };
    let inner: usize = b_nonnull
        .wrapping_add(c.unsigned_abs() as usize)
        .wrapping_mul(usize::from(d.unwrap_or(1)));
    // @truncate usize -> u53 (low 53 bits), widen to isize, then @truncate -> i32.
    let as_u53: u64 = (inner as u64) & ((1u64 << 53) - 1);
    let mut math_result: i32 = (as_u53 as isize) as i32;
    if a {
        math_result = -math_result;
    }
    math_result
}
