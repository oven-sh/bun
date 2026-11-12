import { createRequire } from "node:module";
import { join } from "node:path";
console.log("joined", createRequire(join(__dirname, "plugins", "index.js"))("./fourth.cjs"));
