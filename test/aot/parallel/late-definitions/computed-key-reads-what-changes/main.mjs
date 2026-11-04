// What the definition of a class runs, runs where the definition stands: a computed key, a static field, a static block.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, rename } from "./m.mjs";
rename();
say(() => Object.getOwnPropertyNames(read().prototype).join());
