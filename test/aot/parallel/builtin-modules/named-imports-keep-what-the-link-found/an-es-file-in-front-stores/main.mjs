// An ES file that the entry imports in front stores through its default import of node:path: the named imports of the entry keep what the link found.
import "./store.mjs";
import path, { sep, join } from "node:path";
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"));
