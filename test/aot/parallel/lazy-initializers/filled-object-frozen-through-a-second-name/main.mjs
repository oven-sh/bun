// An object that the initializer stores into, or reads from, is frozen, sealed or closed between the declaration and the first read of the variable.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { readOuter, readInner } from "./m.mjs";
Object.freeze(readInner());
say(() => [Object.keys(readOuter().inner).join(), readOuter().inner === readInner()].join(" "));
