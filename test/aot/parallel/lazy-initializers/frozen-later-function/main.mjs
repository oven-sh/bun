// As ../frozen-later, for functions and Function.prototype.
// STATISTIC: InitializersDeferred >= 1

import { read, readArrow, readBeside } from "./m.mjs";
Object.freeze(Function.prototype);
try { const f = read(), g = readArrow(); console.log(String(f), f.call(), Object.keys(f).join(), String(g), g.bind, readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
