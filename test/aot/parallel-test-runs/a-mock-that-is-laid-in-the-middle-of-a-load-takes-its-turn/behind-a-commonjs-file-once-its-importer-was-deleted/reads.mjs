import { v as b } from "./b.cjs";
import { v as a } from "./a.mjs";
console.log("reads", typeof a === "string" ? a : typeof a, b);
