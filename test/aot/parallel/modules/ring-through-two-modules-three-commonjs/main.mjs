// Two modules and three CommonJS files, one of which requires the entry point back.
// Exit code: 1
import e, { second } from "./e.cjs";
import * as b from "./b.mjs";
export * from "./d.cjs";
console.log("a", typeof e, typeof second, typeof b);
