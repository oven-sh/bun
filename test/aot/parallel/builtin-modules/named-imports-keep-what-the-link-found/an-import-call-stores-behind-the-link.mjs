// An import() loads node:path behind the link of the entry and its default is stored into: named imports that nothing has read yet keep what the link found.
import { sep, join } from "node:path";
const names = await import("node:path");
const path = names.default;
path.sep = "!";
path.join = () => "patched";
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"), names.sep, names.join("a", "b"));
