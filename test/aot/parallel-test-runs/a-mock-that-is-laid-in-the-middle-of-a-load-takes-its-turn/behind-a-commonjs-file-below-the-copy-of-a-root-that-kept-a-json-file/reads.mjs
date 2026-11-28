import { v as b } from "./b.cjs";
import a from "./a.json";
console.log("reads", typeof a === "string" ? a : typeof a, b);
