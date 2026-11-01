// Function.prototype takes a name that the build has seen the program give it. An assignment under that name finds the setter from then on, so it is not put off.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1

import { read, readBeside } from "./m.mjs";
Object.defineProperty(Function.prototype, "extra", { set(v) { console.log("setter", JSON.stringify(v)); }, get() { return "from above"; }, configurable: true });
try { const f = read(); console.log(Object.keys(f).join(), JSON.stringify(f.extra), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
