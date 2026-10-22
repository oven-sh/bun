// e.mjs imports k.cjs, k.cjs requires e.mjs, and an import of e.mjs starts it. Under `bun run` that require() runs the body of e.mjs, once, while `exports` of k.cjs is still empty.
import { seen, later, value } from "./e.mjs";
console.log(seen, later?.(), value);
