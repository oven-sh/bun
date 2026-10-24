// `export const m = require("./x.cjs")` and `export { other }`: another file reads what the variable holds, so it holds the object.
import { m, viaClause, read } from "./holder.mjs";
console.log(m.n, Object.keys(m).join(), viaClause.n);
m.n = 2;
console.log(read(), require("./x.cjs").n);
