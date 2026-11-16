const out = [];
const log = (...values) => out.push(values.map(v => (v instanceof Error ? v.name + ":" + v.message : typeof v === "object" && v !== null ? "{" + Object.keys(v) + "}" : String(v))).join(" "));
let closed = 0;
const answers = { object: () => ({}), self: it => it, list: () => [], fn: () => () => 1, nothing: () => undefined, none: () => null, number: () => 1, text: () => "t", throws: () => { throw new RangeError("close"); } };
const made = kind => ({ [Symbol.iterator]() { let at = 0; return { next() { return { value: at++, done: false }; }, return() { closed++; return kind(this); } }; } });
const object = { [Symbol.iterator]() { let at = 0; return { next() { return { value: at++, done: false }; }, return() { closed++; return {}; } }; } };
const captured = { [Symbol.iterator]() { let at = 0; return { next: () => ({ value: at++, done: at > 9 }), return: () => { closed += at; return { at }; } }; } };
const undefinedReturn = { [Symbol.iterator]() { let at = 0; return { next() { return { value: at++, done: false }; }, return: undefined }; } };
const bad = { [Symbol.iterator]() { let at = 0; return { next() { return { value: at++, done: false }; }, return() { closed++; return 5; } }; } };
const throwing = { [Symbol.iterator]() { let at = 0; return { next() { return { value: at++, done: false }; }, return() { closed++; throw new RangeError("close"); } }; } };
class Own { at = 0; next() { return { value: this.at++, done: false }; } return(value) { closed++; log("return", value === undefined, arguments.length, this.at); return this; } [Symbol.iterator]() { return this; } }
class Getter { at = 0; next() { return { value: this.at++, done: false }; } get return() { log("get"); return () => { closed++; return {}; }; } [Symbol.iterator]() { return this; } }
class Later { at = 0; next() { return { value: this.at++, done: this.at > 30 }; } [Symbol.iterator]() { return this; } }
function sum(limit) { let total = 0; for (let k = 0; k < 3; k++) for (const v of object) { if (v > limit) break; total += v; } return total; }
function sumCaptured(limit) { let total = 0; for (let k = 0; k < 3; k++) for (const v of captured) { if (v > limit) break; total += v; } return total; }
function outer() { let total = 0; next: for (let k = 0; k < 4; k++) { for (const v of object) { for (const w of captured) { if (w === 2) continue next; if (v + w > 5) break next; total += w; } } } return total; }
function returns() { for (const v of object) { if (v === 2) return v; } }
function throwsInside(over) { for (let k = 0; k < 2; k++) { try { for (const v of over) { if (v >= 1) throw new Error("body"); } } catch (error) { log("caught", error); } } }
function breaks(over) { for (let k = 0; k < 2; k++) { try { for (const v of over) { if (v >= 1) break; } log("left"); } catch (error) { log("caught", error); } } }
function finallyBreaks(over) { let total = 0; for (let k = 0; k < 2; k++) { for (const v of over) { try { total += v; if (v >= 2) return total; } finally { if (k === 0 && v >= 2) break; } } } return total; }
function destructures(over) { const [a, b] = over; return a + b; }
function changes() { let total = 0; for (let k = 0; k < 3; k++) { const it = new Own(); for (const v of it) { if (v === 1) it.return = () => { closed += 100; return {}; }; if (v === 2) break; total += v; } } return total; }
for (let round = 0; round < 2; round++) {
  log("sum", sum(4), sumCaptured(3), outer(), returns(), closed);
  for (const over of [object, captured, undefinedReturn, bad, throwing]) { throwsInside(over); breaks(over); try { log("finally", finallyBreaks(over)); } catch (error) { log("top", error); } try { log("pair", destructures(over)); } catch (error) { log("top", error); } log(closed); }
  for (const [name, kind] of Object.entries(answers)) { const over = made(kind); log(name); breaks(over); throwsInside(over); }
  log(changes(), closed);
  breaks(new Own()); throwsInside(new Own()); breaks(new Getter()); throwsInside(new Getter()); breaks(new Later());
  Later.prototype.return = function () { log("later"); closed++; return {}; };
  breaks(new Later()); throwsInside(new Later());
  delete Later.prototype.return;
}
console.log(out.join("\n"));
