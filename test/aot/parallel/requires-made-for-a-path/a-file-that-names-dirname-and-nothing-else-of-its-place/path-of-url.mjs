import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
export default createRequire(fileURLToPath(new URL("./plugins/", import.meta.url)))("./h.cjs");
