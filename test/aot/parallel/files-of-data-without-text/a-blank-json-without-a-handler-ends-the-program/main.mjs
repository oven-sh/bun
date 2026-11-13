// Exit code: 1
import { createRequire } from "node:module";
console.log("SAID before");
console.log("SAID", createRequire(import.meta.url)("./nothing.json"));
