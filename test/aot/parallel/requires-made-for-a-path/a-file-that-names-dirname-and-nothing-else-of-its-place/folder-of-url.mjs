import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
export default createRequire(path.join(fileURLToPath(new URL(".", import.meta.url)), "x.js"))("./plugins/g.cjs");
