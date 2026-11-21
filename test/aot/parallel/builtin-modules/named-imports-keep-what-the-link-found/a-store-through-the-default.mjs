// The named imports of node:path keep what the module held when the entry was linked: a store through the default import does not reach them.
import path, { sep, join } from "node:path";
path.sep = "!";
path.join = () => "patched";
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"));
