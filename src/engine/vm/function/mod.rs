//! Function objects.

mod bound_function;
#[cfg_attr(target_arch = "aarch64", path = "bound_function_stubs_aarch64.rs")]
#[cfg_attr(target_arch = "x86_64", path = "bound_function_stubs_x86_64.rs")]
mod bound_function_stubs;
mod class;
mod custom_accessor_function;
mod internal_function;
mod js_function;
mod native_closure;
mod rare_data;
mod remote_function;

pub use bound_function::JsBoundFunction;
pub use class::new_class;
pub(crate) use custom_accessor_function::CustomAccessorKey;
pub use custom_accessor_function::{JsCustomGetterFunction, JsCustomSetterFunction};
pub use internal_function::{
    InternalFunction, InternalFunctionInit, function_realm, try_function_realm,
};
pub(crate) use js_function::name_for_instances;
pub use js_function::{JsCallee, JsFunction, JsFunctionInit, display_name};
pub use native_closure::{JsNativeClosure, NativeClosure};
pub use rare_data::FunctionRareData;
pub use remote_function::JsRemoteFunction;
