// What the definition of a class runs, runs where the definition stands: a computed key, a static field, a static block.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
console.log("main runs");
say(() => new (read())().m());
