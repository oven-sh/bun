// node:path: every function, in the posix and the win32 form, whatever system the program runs on.
import path, { posix, win32 } from "node:path";
import posixModule from "node:path/posix";
import win32Module from "node:path/win32";

console.log(posix.join("/a", "../b", "./c", "", "d/"), win32.join("C:\\a", "..\\b", "c/d"));
console.log(posix.normalize("/a//b/./c/../d/"), win32.normalize("C:/a//b/../c\\"), posix.normalize(""), posix.normalize("../.."));
console.log(posix.resolve("/a/b", "../c", "d"), posix.resolve("/a", "/b", "c"), win32.resolve("C:\\a", "..\\b", "D:\\c", "d"));
console.log(posix.relative("/a/b/c", "/a/d"), posix.relative("/a", "/a"), win32.relative("C:\\a\\b", "C:\\a\\c\\d"), win32.relative("C:\\a", "D:\\b"));
console.log(posix.dirname("/a/b/c.txt"), posix.dirname("c.txt"), posix.dirname("/"), win32.dirname("C:\\a\\b"), win32.dirname("C:\\"));
console.log(posix.basename("/a/b/c.txt"), posix.basename("/a/b/c.txt", ".txt"), posix.basename("/a/b/"), win32.basename("C:\\a\\b.TXT", ".txt"), posix.basename("a\\b"));
console.log(posix.extname("a.b.c"), JSON.stringify(posix.extname(".hidden")), JSON.stringify(posix.extname("a.")), JSON.stringify(posix.extname("a")), posix.extname("/a.b/c.d"));
console.log(posix.isAbsolute("/a"), posix.isAbsolute("a"), win32.isAbsolute("C:\\"), win32.isAbsolute("C:a"), win32.isAbsolute("\\\\server\\share"), win32.isAbsolute("/a"));
console.log(JSON.stringify(posix.parse("/home/u/file.tar.gz")), JSON.stringify(win32.parse("C:\\dir\\file.txt")), JSON.stringify(posix.parse("")));
console.log(posix.format({ dir: "/a", name: "b", ext: ".c" }), posix.format({ root: "/", base: "x" }), win32.format({ dir: "C:\\a", base: "b.c" }), posix.format({ name: "n", ext: "e" }));
console.log(posix.sep, win32.sep, posix.delimiter, win32.delimiter, win32.toNamespacedPath("C:\\a"), posix.toNamespacedPath("/a"));
console.log(path.posix === posix, path.win32 === win32, posixModule === posix, win32Module === win32, posix.posix === posix, posix.win32 === win32, path === (process.platform === "win32" ? win32 : posix));
console.log(posix.matchesGlob?.("/a/b.js", "/a/*.js"), posix.matchesGlob?.("/a/b/c.js", "/a/*.js"));
for (const bad of [null, 1, {}]) {
  try {
    posix.join("a", bad);
  } catch (error) {
    console.log(error.code, error.name);
  }
}
