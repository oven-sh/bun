// Beside ../frozen-later: a prototype that is sealed, or takes no new names, refuses no assignment to the objects below it.
// STATISTIC: InitializersDeferred >= 1

import { read, readBeside } from "./m.mjs";
Object.seal(Object.prototype);
Object.preventExtensions(Function.prototype);
try { const o = read(); console.log(String(o), Object.keys(o).join(), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
