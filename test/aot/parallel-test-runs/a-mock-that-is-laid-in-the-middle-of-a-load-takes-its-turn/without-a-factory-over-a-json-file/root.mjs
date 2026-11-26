import a from "./a.json";
import "./mocks.cjs";
import "./reads.mjs";
console.log("root", typeof a === "string" ? a : typeof a);
