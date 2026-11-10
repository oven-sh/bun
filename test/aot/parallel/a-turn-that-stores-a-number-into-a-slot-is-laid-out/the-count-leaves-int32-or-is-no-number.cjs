"use strict";
// The count passes the greatest int32 in the middle of the turns laid out and goes on as a double; it begins as a double, a text, a big integer, undefined; the field is an accessor; the object is frozen.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
class Reader { constructor(list, n) { this.list = list; this.n = n; } go() { let s = 0; for (let i = 0; i < 40; i++) { this.n++; s = (s * 31 + this.list[i]) | 0; } return s; } }
globalThis.kept = new Reader([1, 2], 0);
const whole = []; for (let i = 0; i < 48; i++) whole.push((i * 7) & 255);
function run(n) { const reader = new Reader(whole, n); let s; try { s = reader.go(); } catch (error) { s = error.constructor.name; } said.push(s, typeof reader.n, String(reader.n)); }
for (let round = 0; round < 3; round++) {
    run(0); run(2147483647 - 20); run(2147483647); run(-2147483648); run(veil(0.5)); run(veil(-0)); run(veil(NaN)); run(veil("5")); run(veil(7n)); run(veil(undefined)); run(veil(null)); run(veil(true)); run(veil(9007199254740991));
    const frozen = Object.freeze(new Reader(whole, 3)); let answer; try { answer = frozen.go(); } catch (error) { answer = error.constructor.name; } said.push(answer, frozen.n);
    let sets = 0; const watched = new Reader(whole, 0); Object.defineProperty(watched, "n", { get() { return sets; }, set(value) { sets = value + 1; } }); said.push(watched.go(), sets);
}
console.log(said.join(" "));
