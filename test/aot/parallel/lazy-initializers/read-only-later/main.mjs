// As ../frozen-later. One member of Object.prototype is made read-only.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1

import { read, readBeside } from "./m.mjs";
Object.defineProperty(Object.prototype, "toString", { writable: false });
try { const o = read(); console.log(String(o), Object.keys(o).join(), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
