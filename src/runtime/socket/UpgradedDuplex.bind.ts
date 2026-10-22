import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::upgraded_duplex" });

// The listeners that `get_js_handlers` makes. Each carries its `UpgradedDuplex` as function data.
const listener = { passCallee: true, capability: "js" } as const;

export const onReceivedData = b.fn({
  ...listener,
  export: "Bun__UpgradedDuplex__onReceivedData",
  args: { data: b.any },
  length: 0,
});
export const onEnd = b.fn({ ...listener, export: "Bun__UpgradedDuplex__onEnd" });
export const onWritable = b.fn({ ...listener, export: "Bun__UpgradedDuplex__onWritable" });
export const onCloseJS = b.fn({ ...listener, export: "Bun__UpgradedDuplex__onCloseJS" });
