// trees/entries/seroval.ts: WHAT IS "seroval" TO ITS IMPORTERS: an ES module: by require() out of a CommonJS file, by `import * as ns`, by name.
import * as ns from "seroval";
import { serialize, deserialize, crossSerializeStream, toJSON, fromJSON, Feature } from "seroval";
import { required } from "./seroval.required.cjs";
import { tell } from "./tell.cjs";
console.log("== seroval");
console.log("   require: " + tell(required));
console.log("   namespace: keys[" + Object.keys(ns).sort().join() + "]");
console.log("   by name: " + ([["serialize", serialize], ["deserialize", deserialize], ["crossSerializeStream", crossSerializeStream], ["toJSON", toJSON], ["fromJSON", fromJSON], ["Feature", Feature]] as [string, unknown][]).map(([k, v]) => k + ":" + typeof v + (v === (required as Record<string, unknown>)[k] ? "=" : "!") + (v === (ns as Record<string, unknown>)[k] ? "=" : "!")).join(" "));
