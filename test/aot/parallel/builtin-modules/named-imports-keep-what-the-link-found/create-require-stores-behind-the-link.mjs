// A require made by createRequire() loads node:path behind the link of the entry and stores into it: named imports that nothing has read yet keep what the link found.
import { createRequire } from "node:module";
import { sep, join } from "node:path";
const path = createRequire(import.meta.url)("node:path");
path.sep = "!";
path.join = () => "patched";
console.log(sep, join("a", "b"), path.sep, path.join("a", "b"));
