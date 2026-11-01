// An object that the initializer stores into, or reads from, is frozen, sealed or closed between the declaration and the first read of the variable.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, base } from "./m.mjs";
Object.freeze(base);
say(() => [read().label, Object.keys(read()).join()].join(" "));
