// require() of names that are computed at run time, in a program that names two modules of the library. Such a load runs no module of the library by itself, and it still answers as in plain Bun: a module that the program names is the same object, also when the program names it only further down, a native module answers though nothing names it, and a file that does not exist is reported missing.
// The executable leaves out a module of the library that nothing in the program names, and it hides the helpers that the bundler imports ("bun:wrap"). A load of one of those answers as in plain Bun or throws the error of a module that is not installed, which names the module. Both print the same line here.
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
const crypto = require("crypto");
console.log(crypto.createHash("sha1").update("a").digest("hex").length);

const summary = loaded => typeof loaded + " " + (Object.keys(loaded).length > 0);
function load(name) {
  try {
    return summary(require(decoded(name)));
  } catch (error) {
    return "throws " + error.code;
  }
}
function loadWhatMayBeLeftOut(name) {
  try {
    const answer = summary(require(decoded(name)));
    return answer === "object true" ? "answers or is reported missing" : answer;
  } catch (error) {
    const isReportedMissing = /^(ERR_)?MODULE_NOT_FOUND$/.test(error.code) && String(error.message).includes(name);
    return isReportedMissing ? "answers or is reported missing" : "throws " + error.code + ": " + error.message;
  }
}

for (const name of ["crypto", "node:crypto"]) console.log(name, load(name), require(decoded(name)) === crypto);
console.log("node:path", load("node:path"), require(decoded("node:path")) === require("node:path"));
for (const name of ["node:buffer", "bun:jsc", "node:module", "node:util/types", "./no-such-file.json"]) console.log(name, load(name));
for (const name of ["bun:wrap", "node:net", "node:os", "fs"]) console.log(name, loadWhatMayBeLeftOut(name));
