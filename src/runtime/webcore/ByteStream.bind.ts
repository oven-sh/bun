import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::byte_stream" });

export const ReadableStream = b.cell("WebCore::JSReadableStream", "streams/JSReadableStream.h", {
  rustPath: "crate::webcore::ReadableStream",
  tsType: "ReadableStream",
});

/** `stream` is a `ReadableStream`, a class written in C++. */
export const cancelOnDrain = b.fn({ args: { stream: b.opaque }, capability: "js", throws: true });
