import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::upgraded_duplex" });

// The listeners that `get_js_handlers` makes. Each carries its `UpgradedDuplex` as function data.
const listener = { passCallee: true, capability: "js" } as const;

/** What is not a buffer is reported to the socket's `error` handler, not thrown. */
export const DuplexChunk = b.union({ none: b.null, bytes: b.bufferSource.allowShared, other: b.any });
export const onReceivedData = b.fn({
  ...listener,
  export: "Bun__UpgradedDuplex__onReceivedData",
  args: { data: DuplexChunk },
});
export const onEnd = b.fn({ ...listener, export: "Bun__UpgradedDuplex__onEnd" });
export const onWritable = b.fn({ ...listener, export: "Bun__UpgradedDuplex__onWritable" });
export const onCloseJS = b.fn({ ...listener, export: "Bun__UpgradedDuplex__onCloseJS" });
