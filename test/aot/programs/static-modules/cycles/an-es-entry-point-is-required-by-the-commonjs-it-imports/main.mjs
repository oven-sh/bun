// The entry point imports k.cjs, and k.cjs requires the entry point. Under `bun run` that require() runs the body of the entry point, once, while `exports` of k.cjs is still empty.
import k from "./k.cjs";
export const value = "main";
console.log("the entry point runs", k.seen, k.later?.());
