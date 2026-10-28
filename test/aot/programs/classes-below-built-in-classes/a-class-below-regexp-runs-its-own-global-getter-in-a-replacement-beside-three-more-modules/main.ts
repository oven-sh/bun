// Imports four modules, one after the other. The last has a class below RegExp with a getter `global` of its own, and RegExp.prototype[Symbol.replace] reads `flags` on an instance, which reads that getter.
await import("./async-local-stores-are-entered-in-every-kind-of-job.mjs");
await import("./a-member-of-node-events-is-found-through-get-builtin-module-by-reflect-get.js");
await import("./fields-are-added-by-later-passes.ts");
await import("./a-replacement-reads-the-global-getter-of-the-class.js");
export {};
