import { createRequire } from "node:module";
var made = createRequire(import.meta.url);
made("./lib/statement.cjs");
const held = made("./lib/held.cjs");
const { taken } = made("./lib/pattern.cjs");
console.log(made("./lib/tested.cjs") ? "yes" : "no", held.name, taken, made("./lib/local.cjs").name);
