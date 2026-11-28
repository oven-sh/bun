import { v as a } from "./a.mjs";
import "./mocks.cjs";
import "./reads.mjs";
console.log("root", typeof a === "string" ? a : typeof a);
