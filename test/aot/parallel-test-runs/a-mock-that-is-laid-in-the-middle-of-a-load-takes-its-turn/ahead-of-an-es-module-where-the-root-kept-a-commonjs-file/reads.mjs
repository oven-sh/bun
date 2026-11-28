import { v as a } from "./a.cjs";
import "./e.mjs";
import { v as b } from "./b.cjs";
console.log("reads", typeof a === "string" ? a : typeof a, b);
