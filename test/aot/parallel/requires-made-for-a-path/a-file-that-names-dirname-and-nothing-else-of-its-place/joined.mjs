import { createRequire } from "node:module";
import { join } from "node:path";
export default createRequire(join(__dirname, "plugins", "index.js"))("./c.cjs");
