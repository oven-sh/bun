import * as b from "../lib.ts";

/** Views passed as data are pinned while they are read (`PinnedArrayBuffer`), which moves the bytes of small ones. A view passed as a path is copied and not pinned. `readSync` and `readvSync` fill views. */
export const heapsOfViews = ["TypedArrayStorage", "TypedArrayElements"] as const;

/** How `node:fs` operations use their arguments (`args::*::from_js` in node_fs.rs). They neither keep nor return any. */
export const fsOperandUses = [
  ...b.optionBag([
    "bigint",
    "encoding",
    "flag",
    "flush",
    "force",
    "maxRetries",
    "mode",
    "recursive",
    "retryDelay",
    "signal",
    "throwIfNoEntry",
    "withFileTypes",
  ]),
  b.readsContents(),
  b.writesContents(),
  b.printedByFormatter("constructor"),
];
