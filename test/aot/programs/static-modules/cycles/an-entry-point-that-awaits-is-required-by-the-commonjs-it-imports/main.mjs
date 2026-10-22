// The entry point awaits at top level and imports k.cjs, and k.cjs requires the entry point. Under `bun run` that require() runs the entry point and waits for it: "the entry point runs undefined".
// An executable refuses the require() of a module that awaits and is being evaluated. The expected output is written down: it is that of an executable before and behind static modules.
import k from "./k.cjs";
export const value = await Promise.resolve("main");
console.log("the entry point runs", k.seen);
