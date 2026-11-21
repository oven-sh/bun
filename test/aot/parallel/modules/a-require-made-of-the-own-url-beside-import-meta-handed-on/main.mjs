// A require() made of the own URL finds its files in a file that hands import.meta on or stores into it.
import { createRequire } from "node:module";
import { describe } from "./pier.mjs";
const load = createRequire(import.meta.url);
console.log(load("./settings.json").port, load("./ferry.cjs").deck);
console.log(describe(import.meta));
