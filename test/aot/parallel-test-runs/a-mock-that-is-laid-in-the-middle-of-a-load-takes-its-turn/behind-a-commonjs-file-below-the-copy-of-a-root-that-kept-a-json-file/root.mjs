import a from "./a.json";
import "./mocks.cjs";
import "./second.cjs";
import "./reads.mjs";
console.log("root", typeof a === "string" ? a : typeof a);
