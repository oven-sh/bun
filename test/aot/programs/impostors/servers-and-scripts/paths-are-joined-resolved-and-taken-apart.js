import path from "node:path";
import { basename, extname, posix, win32 } from "node:path";

console.log(path.join("/srv", "app", "..", "static", "./index.html"), path.join("a", "", "b"), path.join(""));
console.log(path.resolve("/srv/app", "../logs", "today.log"), path.resolve("/a", "/b", "c"), path.isAbsolute("a/b"), path.isAbsolute("/a"));
console.log(path.normalize("/a//b/./c/../d/"), path.normalize("../x/../../y"), path.normalize(""));
console.log(path.relative("/srv/app/src", "/srv/app/test/unit"), path.relative("/a", "/a"), JSON.stringify(path.relative("/a/b", "/a")));
console.log(basename("/srv/report.final.pdf"), basename("/srv/report.final.pdf", ".pdf"), basename("/srv/folder/"), extname("archive.tar.gz"), JSON.stringify(extname(".bashrc")), extname("a."));
console.log(path.dirname("/srv/app/index.js"), path.dirname("index.js"), path.dirname("/"), path.sep, path.delimiter);
console.log(path.parse("/home/ada/notes.txt"), path.format({ dir: "/tmp", name: "file", ext: ".md" }), path.format({ root: "/", base: "x.y" }));
console.log(win32.join("C:\\Users", "ada", "..", "bob"), win32.basename("C:\\a\\b.txt"), win32.parse("C:\\a\\b.txt").root, win32.isAbsolute("C:/x"), win32.sep);
console.log(posix.join("a", "b") === path.join("a", "b"), posix === path.posix, path.posix.basename("a\\b"), path.matchesGlob?.("/a/b.js", "/a/*.js"));
for (const bad of [undefined, null, 5, {}]) {
  try {
    path.join("a", bad);
  } catch (error) {
    console.log(error.name, error.code);
  }
}
