import a from "./a.json";
import { v as b } from "./b.cjs";
console.log("reads", typeof a === "string" ? a : typeof a, b);
