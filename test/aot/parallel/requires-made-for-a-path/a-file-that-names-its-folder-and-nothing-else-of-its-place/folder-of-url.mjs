import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
console.log("folder of url", createRequire(join(fileURLToPath(new URL(".", import.meta.url)), "plugins", "index.js"))("./fifth.cjs"));
