// As ../setter-above-functions, with a value that is read-only.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1

import { read, readBeside } from "./m.mjs";
Object.defineProperty(Function.prototype, "extra", { value: "from above", writable: false, configurable: true });
try { const f = read(); console.log(Object.keys(f).join(), JSON.stringify(f.extra), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
