// Imports five modules, one after the other. The last has a class below RegExp with a getter `unicode` of its own, and RegExp.prototype[Symbol.replace] reads `flags` on an instance, which reads that getter.
await import("./a-member-of-node-events-is-found-through-get-builtin-module-by-reflect-get.js");
await import("./a-require-is-called-before-create-require-has-made-it.mjs");
await import("./missing-typed-fields-are-read-by-name.ts");
await import("./fields-are-added-by-later-passes.ts");
await import("./a-replacement-reads-the-unicode-getter-of-the-class.js");
export {};
