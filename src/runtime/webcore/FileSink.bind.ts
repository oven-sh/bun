import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::file_sink" });

export const liveCount = b.fn({ returns: b.i32 });

// For the node streams over a sink: `child.stdin`, `process.stdout`, a `tty.WriteStream`. `sink` is a `FileSink`, a class the sink generator writes.
const request = {
  args: { sink: b.any, callback: b.callable },
  returns: b.bool,
  capability: "js",
  throws: true,
} as const;
/** `_final`. True: `callback(error?)` comes from the event loop once everything is written. False: the sink is flushed, and nothing calls back. */
export const shutdown = b.fn(request);
/** `_destroy`. True: `callback()` comes from the event loop once the descriptor is closed. False: `sink` holds no sink. */
export const close = b.fn(request);

const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::webcore::FileSink") },
  capability: "js",
} as const;
export const onResolveStream = b.fn({ ...reaction, export: "Bun__FileSink__onResolveStream" });
export const onRejectStream = b.fn({ ...reaction, export: "Bun__FileSink__onRejectStream", throws: true });
