// Beside ../frozen-later: under a name that no object above has or can get, an assignment is a definition whenever it is made. These are put off.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 2

import { read, readObject } from "./m.mjs";
Object.freeze(Function.prototype);
Object.freeze(Object.prototype);
try { const f = read(), o = readObject(); console.log(Object.keys(f).join(), JSON.stringify(f.extra), Object.keys(o).join(), JSON.stringify(o.beta)); } catch (e) { console.log(e.name + ": " + e.message); }
