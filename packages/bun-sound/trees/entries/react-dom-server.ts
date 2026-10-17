// trees/entries/react-dom-server.ts: WHAT IS "react-dom/server" TO ITS IMPORTERS: by require() out of a CommonJS file, by `import d`, by `import * as ns`, and by name: every name that any of the package's entries for this door has, AND ONE THAT NOBODY HAS: a CommonJS entry gives undefined for a name it lacks and never stops a build. The typed set must say what plain Bun says on the untouched package.
// @ts-nocheck: the names are asked for whether or not this version declares them
import d from "react-dom/server";
import * as ns from "react-dom/server";
import { version as n0, renderToReadableStream as n1, renderToPipeableStream as n2, resumeToPipeableStream as n3, resume as n4, renderToString as n5, renderToStaticMarkup as n6, renderToNodeStream as n7, renderToStaticNodeStream as n8, prerender as n9, prerenderToNodeStream as n10, resumeAndPrerender as n11, resumeAndPrerenderToNodeStream as n12, nobodyHasThisName as n13 } from "react-dom/server";
import { required } from "./react-dom-server.required.cjs";
import { tell } from "./tell.cjs";
console.log("== react-dom/server");
console.log("   require: " + tell(required));
console.log("   default: " + tell(d) + (d === required ? " (what require gives)" : d === required.default ? " (require's .default)" : " (another value)"));
console.log("   namespace: keys[" + Object.keys(ns).sort().join() + "] default " + (ns.default === d ? "is the default import" : "IS ANOTHER VALUE"));
console.log("   by name: " + [["version", n0], ["renderToReadableStream", n1], ["renderToPipeableStream", n2], ["resumeToPipeableStream", n3], ["resume", n4], ["renderToString", n5], ["renderToStaticMarkup", n6], ["renderToNodeStream", n7], ["renderToStaticNodeStream", n8], ["prerender", n9], ["prerenderToNodeStream", n10], ["resumeAndPrerender", n11], ["resumeAndPrerenderToNodeStream", n12], ["nobodyHasThisName", n13]].map(([k, v]) => k + ":" + typeof v + (v !== undefined && v === required[k as string] ? "=" : v === undefined ? "" : "!")).join(" "));
