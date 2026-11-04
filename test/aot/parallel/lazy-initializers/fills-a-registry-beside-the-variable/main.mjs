// An object that the initializer stores into, or reads from, is frozen, sealed or closed between the declaration and the first read of the variable.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
import { reg } from "./reg.mjs";
Object.freeze(reg);
say(() => [reg.name, read().big.title.text].join(" "));
