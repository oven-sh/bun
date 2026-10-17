// trees/entries/fuse.ts: WHAT IS "fuse.js" TO ITS IMPORTERS: `import d`, `import * as ns` take dist/fuse.mjs (the typed door); require() takes dist/fuse.cjs, which is not touched.
import d from "fuse.js";
import * as ns from "fuse.js";
import { required } from "./fuse.required.cjs";
import { tell } from "./tell.cjs";
console.log("== fuse.js");
console.log("   require: " + tell(required));
console.log("   default: " + tell(d));
console.log("   namespace: keys[" + Object.keys(ns).sort().join() + "] default " + (ns.default === d ? "is the default import" : "IS ANOTHER VALUE"));
console.log("   prototype: " + Object.getOwnPropertyNames(d.prototype).sort().join() + " | an instance: " + Object.keys(new d(["a"])).join());
