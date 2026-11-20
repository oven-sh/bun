import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::byte_stream" });

/** `stream` is a `ReadableStream`, a class written in C++. */
export const cancelOnDrain = b.fn({ args: { stream: b.any }, capability: "js", throws: true });
