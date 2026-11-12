// `bun <file>` runs x.mjs ahead of y.mjs in most runs and behind it in some: k.cjs runs while the graph of this file loads, and its require() enters the cycle at y.mjs. Either way the method is there once the statement that lays it has run.
import { told } from "./x.mjs";
import done from "./k.cjs";
console.log(told, typeof done);
