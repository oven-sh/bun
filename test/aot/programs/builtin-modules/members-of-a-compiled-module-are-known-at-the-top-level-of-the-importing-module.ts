// The body of node:path has run before the first statement of a module that imports it, so a read of `path.isAbsolute` at the top level finds the function as surely as a read inside a function does.
// The native function behind it is called with no test of the callee, here in a loop that stands at the top level.
// STATISTIC: NativeFunctionsCalledDirectly >= 3
// STATISTIC: NativeFunctionTestsEmitted = 0
import path from "node:path";

const names = [process.argv[2] ?? "/a/b.txt", "c/d.js", "/"];
let count = 0;
for (const name of names) if (path.isAbsolute(name)) count += path.basename(name).length + path.extname(name).length;
console.log(count, typeof path.join, path.sep, path.posix === path);
