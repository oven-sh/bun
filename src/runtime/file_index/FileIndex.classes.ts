import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "FileIndex",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    // The path arena + per-entry metadata live entirely off the JS heap;
    // report them so an idle index participates in GC pacing.
    estimatedSize: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {},
    proto: {
      root: { getter: "getRoot", cache: true },
      size: { getter: "getSize" },
      memoryUsage: { getter: "getMemoryUsage" },
      truncated: { getter: "getTruncated" },
      watching: { getter: "getWatching" },
      close: { fn: "close", length: 0 },
    },
  }),
];
