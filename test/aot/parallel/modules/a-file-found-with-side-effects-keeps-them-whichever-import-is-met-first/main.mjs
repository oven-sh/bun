import { early } from "./early.mjs";
import { late } from "./late.mjs";
console.log(early, late);
console.log("SAID", (globalThis.marks ?? []).join(","));
