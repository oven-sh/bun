// closed-world/load-by-name with import() in place of require(): a module of the library that the program names is the same module under a computed name, also when the program names it only further down, a native module answers though nothing names it, and a file that does not exist is reported missing.
// The executable leaves out a module of the library that nothing in the program names, and it hides the helpers that the bundler imports ("bun:wrap"). An import of one of those answers as in plain Bun or is rejected with the error of a module that is not installed, which names the module. Both print the same line here.
// Text that is decoded at run time is unknown to the compiler.
import { join } from "node:path";
const decoded = text => Buffer.from(text).toString();
console.log(join("a", "b"));

const summary = loaded => typeof loaded + " " + (Object.keys(loaded).length > 0);
async function load(name) {
  try {
    return summary(await import(decoded(name)));
  } catch (error) {
    return "throws " + error.code;
  }
}
async function loadWhatMayBeLeftOut(name) {
  try {
    const answer = summary(await import(decoded(name)));
    return answer === "object true" ? "answers or is reported missing" : answer;
  } catch (error) {
    const isReportedMissing = /^(ERR_)?MODULE_NOT_FOUND$/.test(error.code) && String(error.message).includes(name);
    return isReportedMissing ? "answers or is reported missing" : "throws " + error.code + ": " + error.message;
  }
}

console.log("node:path", await load("node:path"), (await import(decoded("node:path"))).join === join);
console.log("node:url", await load("node:url"), (await import(decoded("node:url"))).parse === (await import("node:url")).parse);
for (const name of ["node:buffer", "bun:jsc", "./no-such-file.mjs"]) console.log(name, await load(name));
for (const name of ["bun:wrap", "node:net", "node:os"]) console.log(name, await loadWhatMayBeLeftOut(name));
