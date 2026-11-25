import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
const text = load("./part.cjs", { type: "text" });
delete load.cache[load.resolve("./part.cjs")];
const code = load("./part.cjs");
console.log(Object.keys(text).join(), Object.keys(code).join(), globalThis.ran);
