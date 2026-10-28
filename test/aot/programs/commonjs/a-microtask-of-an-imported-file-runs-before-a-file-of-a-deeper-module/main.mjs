import { first } from "./first.cjs";
import { deeper } from "./module.mjs";
console.log(first, deeper, globalThis.seen);
