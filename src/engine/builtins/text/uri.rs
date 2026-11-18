//! The functions of the global object that escape text.

use bun_engine_vm::{JsFunction, RealmSlot, direct};

use crate::prelude::*;

macro_rules! functions {
    ($($slot:ident, $init:ident = $name:ident, $function:ident, $intrinsic:ident;)*) => {
        pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
            match slot {
                $(RealmSlot::$slot => {
                    let (name, intrinsic) = (names::$name.to_identifier(), Intrinsic::$intrinsic);
                    let function =
                        JsFunction::native_with_intrinsic(cx, 1, name.string(), $function, intrinsic);
                    cx.global().$init(function);
                })*
                _ => return false,
            }
            true
        }

        $(
            #[native_abi]
            fn $function(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                let string = frame.argument(0).to_string(cx)?;
                direct::uri::$function(cx, string).map(Into::into)
            }
        )*
    };
}

functions! {
    escape_function, init_escape_function = escape, escape, Escape;
    unescape_function, init_unescape_function = unescape, unescape, Unescape;
    decode_uri_function, init_decode_uri_function = decodeURI, decode_uri, DecodeUri;
    decode_uri_component_function, init_decode_uri_component_function =
        decodeURIComponent, decode_uri_component, DecodeUriComponent;
    encode_uri_function, init_encode_uri_function = encodeURI, encode_uri, EncodeUri;
    encode_uri_component_function, init_encode_uri_component_function =
        encodeURIComponent, encode_uri_component, EncodeUriComponent;
}
