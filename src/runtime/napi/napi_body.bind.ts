import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::napi::napi_body" });

export const threadsafeFunctionLiveCount = b.fn({ returns: b.usize });
