import { createRequire } from "node:module";
import { describe } from "./pier.mjs";
const load = createRequire(import.meta.url);
console.log(load("./settings.json").port, load("./ferry.cjs").deck);
console.log(describe(import.meta), typeof import.meta.resolveSync("node:fs"));
