import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::byte_stream" });

const ReadableStream = b.cell("WebCore::JSReadableStream", "streams/JSReadableStream.h", {
  rustPath: "crate::webcore::ReadableStream",
  tsType: "ReadableStream",
});

export const cancelOnDrain = b.fn({ args: { stream: ReadableStream.otherAsNull }, capability: "js", throws: true });
