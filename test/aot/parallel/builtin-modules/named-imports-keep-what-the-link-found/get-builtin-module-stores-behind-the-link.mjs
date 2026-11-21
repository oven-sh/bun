// process.getBuiltinModule() loads node:path behind the link of the entry and stores into it: named imports that nothing has read yet keep what the link found.
import { sep, join } from "node:path";
const path = process.getBuiltinModule("node:path");
path.sep = "!";
path.join = () => "patched";
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"));
