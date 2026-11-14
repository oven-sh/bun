import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::file_sink" });

export const liveCount = b.fn({ returns: b.i32 });

/** `sink` is a `FileSink`, a class the sink generator writes. The result is a promise, an `Error` or `undefined`. */
export const destroy = b.fn({ args: { sink: b.any }, returns: b.any, capability: "js", throws: true });

const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::webcore::FileSink") },
  capability: "js",
} as const;
export const onResolveStream = b.fn({ ...reaction, export: "Bun__FileSink__onResolveStream" });
export const onRejectStream = b.fn({ ...reaction, export: "Bun__FileSink__onRejectStream", throws: true });
