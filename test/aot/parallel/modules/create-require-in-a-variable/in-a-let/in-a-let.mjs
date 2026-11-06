import { createRequire } from "node:module";
let made = createRequire(import.meta.url);
console.log(made("optional-peer").name, made("./lib/local.cjs").name);
