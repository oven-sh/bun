import { createRequire } from "node:module";
console.log("SAID", createRequire(new URL("../../lib/", import.meta.url))("./part.js").value);
console.log("SAID", createRequire(new URL("../", import.meta.url))("./part.js").value);
