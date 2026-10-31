export * from "./m.mjs";
import * as self from "./n.mjs";
export const own = 1;
console.log("n:", (ns => { const seen = []; for (const key of ["f", "s", "C"]) { try { seen.push(key + ":" + typeof ns[key]); } catch (error) { seen.push(key + ":" + error.constructor.name); } } return seen.join(" "); })(self));
