import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::file_sink" });

export const liveCount = b.fn({ returns: b.i32 });
export const cancel = b.fn({ args: { value: b.any }, returns: b.bool, capability: "js", throws: true });

const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::webcore::FileSink") },
  capability: "js",
} as const;
export const onResolveStream = b.fn({ ...reaction, export: "Bun__FileSink__onResolveStream" });
export const onRejectStream = b.fn({ ...reaction, export: "Bun__FileSink__onRejectStream", throws: true });
