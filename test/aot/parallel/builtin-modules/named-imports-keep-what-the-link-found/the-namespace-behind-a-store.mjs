// The namespace of node:path keeps what the module held when the entry was linked, and its default is the object that was stored into.
import path, * as names from "node:path";
path.sep = "!";
path.join = () => "patched";
path.madeUp = 5;
delete path.extname;
console.log(names.sep, names.join("a", "b"), names.default === path, names.default.sep);
console.log("madeUp" in names, typeof names.extname, Object.keys(names).length - Object.keys(path).length);
