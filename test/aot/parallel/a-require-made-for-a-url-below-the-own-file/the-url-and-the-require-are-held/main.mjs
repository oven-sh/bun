import { createRequire } from "node:module";
const base = new URL("./lib/", import.meta.url);
const made = createRequire(base);
console.log("SAID", made("./part.js").value, made.resolve("./part.js").endsWith("/lib/part.js"));
