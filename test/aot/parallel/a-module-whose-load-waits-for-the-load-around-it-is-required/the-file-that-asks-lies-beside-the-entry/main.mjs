// second.cjs is imported by back.mjs and not by the entry: it lies beside the entry, not below it. The load of the entry for second.cjs goes through the requests of the entry alone,
// so it does not settle second.cjs, for which the load of back.mjs waits: neither load ends inside that require, and `bun <file>` throws. Both modules run behind second.cjs.
import "./first.cjs";
console.log("main runs");
export const answer = [1].length;
