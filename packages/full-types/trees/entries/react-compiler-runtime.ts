// trees/entries/react-compiler-runtime.ts: WHAT IS "react/compiler-runtime" TO ITS IMPORTERS: by require() out of a CommonJS file, by `import d`, by `import * as ns`, and by name: every name that any of the package's entries for this door has, AND ONE THAT NOBODY HAS: a CommonJS entry gives undefined for a name it lacks and never stops a build. The typed set must say what plain Bun says on the untouched package.
// @ts-nocheck: the names are asked for whether or not this version declares them
import d from "react/compiler-runtime";
import * as ns from "react/compiler-runtime";
import { c as n0, nobodyHasThisName as n1 } from "react/compiler-runtime";
import { required } from "./react-compiler-runtime.required.cjs";
import { tell } from "./tell.cjs";
console.log("== react/compiler-runtime");
console.log("   require: " + tell(required));
console.log("   default: " + tell(d) + (d === required ? " (what require gives)" : d === required.default ? " (require's .default)" : " (another value)"));
console.log("   namespace: keys[" + Object.keys(ns).sort().join() + "] default " + (ns.default === d ? "is the default import" : "IS ANOTHER VALUE"));
console.log("   by name: " + [["c", n0], ["nobodyHasThisName", n1]].map(([k, v]) => k + ":" + typeof v + (v !== undefined && v === required[k as string] ? "=" : v === undefined ? "" : "!")).join(" "));
