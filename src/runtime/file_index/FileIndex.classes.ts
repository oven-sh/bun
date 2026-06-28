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
    // `readyPromise` is the eagerly-created Promise behind `index.ready`,
    // resolved/rejected by the crawl-completion task.
    values: ["readyPromise"],
    klass: {},
    proto: {
      root: { getter: "getRoot", cache: true },
      ready: { getter: "getReady", this: true },
      size: { getter: "getSize" },
      memoryUsage: { getter: "getMemoryUsage" },
      truncated: { getter: "getTruncated" },
      watching: { getter: "getWatching" },
      complete: { fn: "complete", length: 1 },
      glob: { fn: "glob", length: 1 },
      has: { fn: "has", length: 1 },
      stat: { fn: "stat", length: 1 },
      touch: { fn: "touch", length: 1 },
      recent: { fn: "recent", length: 0 },
      refresh: { fn: "refresh", length: 0 },
      // `grep()` is an async iterable: a JS `async function*` shim
      // (src/js/builtins/FileIndex.ts) over the private-symbol native method
      // below, mirroring `Glob.prototype.scan`.
      grep: {
        builtin: "fileIndexGrepCodeGenerator",
        length: 1,
      },
      __grep: {
        fn: "__grep",
        length: 2,
        // Reuse an existing BunBuiltinNames entry (see Glob.classes.ts: new
        // private-symbol names do not always resolve).
        privateSymbol: "pull",
      },
      close: { fn: "close", length: 0 },
      "@@dispose": { fn: "close", length: 0 },
    },
  }),
];
