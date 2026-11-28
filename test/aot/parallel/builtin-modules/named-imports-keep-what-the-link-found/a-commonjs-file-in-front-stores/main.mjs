// A CommonJS file that the entry imports in front of node:path stores into the module before the body of the entry runs: the named imports keep what the link found.
import "./store.cjs";
import path, { sep, join } from "node:path";
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"));
