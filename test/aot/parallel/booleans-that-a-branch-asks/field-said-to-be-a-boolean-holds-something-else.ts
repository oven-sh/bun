// a field is declared a boolean and holds something else: what is tested is handed on as it lies
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
class Box { done: boolean; constructor(done: boolean) { this.done = done; } }
function subject(box: Box): unknown { const done = box.done; if (done) return done; return done; }
function either(box: Box): unknown { return box.done || "other"; }
console.log(values.map(v => show(subject(new Box(v as any)))).join(" "));
console.log(values.map(v => show(either(new Box(v as any)))).join(" "));
