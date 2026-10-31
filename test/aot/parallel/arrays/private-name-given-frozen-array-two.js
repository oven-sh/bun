// A constructor that returns its argument gives a frozen array a private name between two reads of one function. The array is a constant of the module, made in the function, or reached through a field.
"use strict";
class Returned { constructor(o) { return o; } }
class Stamp extends Returned { #p = 1; static has(o) { return #p in o; } static read(o) { return o.#p; } static write(o, v) { o.#p = v; } }
class Two extends Returned { #q = 2; #r = 3; static sum(o) { return o.#q + o.#r; } }
class Method extends Returned { #m() { return 7; } static call(o) { return o.#m(); } }
const INTS = Object.freeze([100, 200, 300, 400]);
const FRACTIONS = Object.freeze([1.5, 2.5, 3.5, 4.5]);
const TEXTS = Object.freeze(["p", "q", "r", "s"]);
const OBJECTS = Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
const INTS2 = Object.freeze([10, 20, 30, 40]);
const TEXTS2 = Object.freeze(["w", "x", "y", "z"]);
const INTS3 = Object.freeze([11, 21, 31, 41]);
const holder = { list: Object.freeze([5, 6, 7, 8]) };
const cases = {
  "constant-ints": () => { const x = INTS[0]; new Stamp(INTS); return x + " " + INTS[1] + " " + INTS[3] + " " + INTS.length + " " + Stamp.has(INTS); },
  "constant-fractions": () => { const x = FRACTIONS[0]; new Stamp(FRACTIONS); return x + " " + FRACTIONS[1] + " " + FRACTIONS[3] + " " + FRACTIONS.length; },
  "constant-texts": () => { const x = TEXTS[0]; new Stamp(TEXTS); return x + " " + TEXTS[1] + " " + TEXTS[3] + " " + TEXTS.length; },
  "constant-objects": () => { const x = OBJECTS[0].n; new Stamp(OBJECTS); return x + " " + OBJECTS[1].n + " " + OBJECTS[3].n + " " + OBJECTS.length; },
  "constant-in-a-loop": () => { let t = 0; for (let turn = 0; turn < 50; turn++) { for (let i = 0; i < INTS2.length; i++) t += INTS2[i]; if (turn === 25) new Stamp(INTS2); } return t + " " + Stamp.read(INTS2); },
  "constant-iterated": () => { let t = ""; for (const x of TEXTS2) t += x; new Stamp(TEXTS2); for (const x of TEXTS2) t += x; return t; },
  "two-names": () => { const x = INTS3[0]; new Two(INTS3); return x + " " + INTS3[1] + " " + Two.sum(INTS3); },
  "made-here": () => { let t = 0; for (let k = 0; k < 20000; k++) { const a = Object.freeze([k & 7, 1, 2]); t += a[0] + a[1] + a[2]; new Stamp(a); t += a[0] + a[1] + a[2]; } return t; },
  "made-here-texts": () => { let t = 0; for (let k = 0; k < 20000; k++) { const a = Object.freeze(["ab", "c"]); t += a[0].length + a[1].length; new Stamp(a); t += a[0].length + a[1].length; } return t; },
  "through-a-field": () => { const x = holder.list[0]; new Stamp(holder.list); return x + " " + holder.list[1] + " " + holder.list[3]; },
  "a-private-method": () => { const a = Object.freeze([1, 2, 3]); const x = a[0]; new Method(a); return x + " " + a[1] + " " + a[2] + " " + Method.call(a); },
  "written-afterwards": () => { const a = Object.freeze([1, 2, 3]); new Stamp(a); const x = a[0]; Stamp.write(a, 9); return x + " " + a[1] + " " + a[2] + " " + Stamp.read(a); },
  "stamped-twice-throws": () => { const a = Object.freeze([1, 2, 3]); new Stamp(a); const x = a[0]; let said = "nothing"; try { new Stamp(a); } catch (error) { said = error.constructor.name; } return x + " " + a[1] + " " + said; },
  "still-frozen": () => { const a = Object.freeze([1, 2, 3]); new Stamp(a); let refused = 0; for (const f of [() => { a[0] = 9; }, () => { a.push(4); }, () => { a.x = 1; }, () => { delete a[1]; }, () => { a.length = 0; }]) { try { f(); } catch { refused++; } } return refused + " " + a.join() + " " + Object.isFrozen(a) + " " + Object.keys(a) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(a, 0)); },
  "prototype-and-stamp": () => { const a = Object.freeze([1, 2, 3]); const x = a[0]; const child = { __proto__: a }; new Stamp(a); let refused = "stored"; try { child[0] = 9; } catch { refused = "refused"; } child[7] = 1; return x + " " + a[1] + " " + child[1] + " " + refused + " " + Object.keys(child) + " " + Stamp.has(child); },
};
for (const which of Object.keys(cases)) console.log(which + " " + cases[which]());
