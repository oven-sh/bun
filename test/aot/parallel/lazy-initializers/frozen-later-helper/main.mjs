// As ../frozen-later. The assignment stands in a function that the initializer calls.
// Alone: what is put off goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1

import { read, readArrow, readBeside } from "./m.mjs";
Object.freeze(Object.prototype);
try { console.log(String(read()), Object.keys(read()).join(), String(readArrow()), readBeside().title.text); } catch (e) { console.log(e.name + ": " + e.message); }
