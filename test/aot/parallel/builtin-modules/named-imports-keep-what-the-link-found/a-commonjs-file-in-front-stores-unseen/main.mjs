// A CommonJS file in front of the import of node:path stores into the module by a text that the build cannot read: the named imports keep what the link found.
import "./store.cjs";
import { sep, join } from "node:path";
console.log(sep, join("a", "b"));
const path = process.getBuiltinModule("node:path");
console.log(path.sep, path.join("a", "b"));
