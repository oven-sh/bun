// What is made late is one object, with the name, the length, the state and the properties of one that was made where it stands.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { a1, a2, f1, f2, r1, r2 } from "./m.mjs";
say(() => [a1() === a2(), f1() === f2(), r1() === r2()].join());
