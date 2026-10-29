// A require function that createRequire() makes is no file's own. The program resolves names with it and hands it to text that it evaluates.
// The text finds no file of the program through it: not in its cache, not as its main module, and not by loading one under a path that it computes.
// So the compiler still knows every caller of what the files export. In plain Bun the text finds them all.
const { createRequire } = require("node:module");
const inner = require("./inner.cjs");
const made = createRequire(__filename);
const nameOf = path => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
console.log("the program resolves:", nameOf(made.resolve("./inner.cjs")), typeof made.resolve.paths, made("node:path").basename("/a/b.txt"));

globalThis.report = (road, found) => console.log("the text, " + road + ":", found);
globalThis.made = made;
globalThis.pathOfInner = made.resolve("./inner.cjs");
const text = Buffer.from(`
  const filesIn = cache => cache ? Object.keys(cache).filter(key => key.endsWith(".cjs")).length + " files of the program" : String(cache);
  const attempt = (road, look) => { try { report(road, look()); } catch (error) { report(road, "throws " + error.name); } };
  attempt("its cache", () => filesIn(made.cache));
  attempt("its main", () => String(made.main));
  attempt("an entry under the path of a file", () => String(made.cache[pathOfInner]));
  attempt("a file under a path that it computes", () => typeof made(pathOfInner.slice(0)).count);
  attempt("a file under a relative name that it computes", () => typeof made("./inn" + "er.cjs").count);
  attempt("a module of the library", () => made("node:" + "path").basename("/c/d.txt"));
`).toString();
new Function(text)();
console.log("the program goes on:", inner.count(1), inner.count(2), inner.count(3));
/* Output:
the program resolves: inner.cjs function b.txt
the text, its cache: 0 files of the program
the text, its main: undefined
the text, an entry under the path of a file: undefined
the text, a file under a path that it computes: throws Error
the text, a file under a relative name that it computes: throws Error
the text, a module of the library: d.txt
the program goes on: 1 3 6
*/
