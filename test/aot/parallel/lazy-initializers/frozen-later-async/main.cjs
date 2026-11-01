// As ../frozen-later-function-sloppy, for a function that is async and for a generator function: another object stands between each of them and Function.prototype.
// Alone: what is put off goes by all that the executable holds
const L = require("./m.cjs");
for (const f of [function () {}, async function () {}, function* () {}]) Object.freeze(Object.getPrototypeOf(f));
try { console.log(String(L.a) + L.a.apply(), String(L.g) + L.g.call, String(L.arrow), Object.keys(L.a).join(), Object.keys(L.g).join()); } catch (e) { console.log(e.name + ": " + e.message); }
