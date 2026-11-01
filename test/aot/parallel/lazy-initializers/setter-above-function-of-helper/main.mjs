// As ../setter-above-functions. A function that the initializer calls makes the function and fills it.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1

import { read, readBeside } from "./m.mjs";
Object.defineProperty(Function.prototype, "tag", { set(v) { console.log("setter", JSON.stringify(v)); }, configurable: true });
try { const f = read(); console.log(Object.keys(f).join(), JSON.stringify(f.tag), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
