// node:path is a module of Bun that is compiled from source: what `import path from` gives is the object that its body makes, with that object's layout.
// So `path.isAbsolute` is a read of a slot, the function found there is known, and the native function behind it is called with no test of the callee.
// STATISTIC: NativeFunctionsCalledDirectly >= 3
// STATISTIC: NativeFunctionTestsEmitted = 0
import path from "node:path";

function countCharacters(names: string[]) {
  let count = 0;
  for (const name of names) if (path.isAbsolute(name)) count += path.basename(name).length + path.extname(name).length;
  return count;
}
console.log(countCharacters([process.argv[2] ?? "/a/b.txt", "c/d.js", "/"]), typeof path.join, path.sep, path.posix === path);
