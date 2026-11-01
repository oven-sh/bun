// The file of the object runs first, as imports do. Then Object.prototype is frozen, as code that hardens a program does. An assignment under a name that Object.prototype has
// is refused from then on, so it is not put off until the first read of the variable.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1

import { read, readBeside } from "./m.mjs";
Object.freeze(Object.prototype);
try { const o = read(); console.log(String(o), o + 1, o.constructor, Object.keys(o).join(), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
