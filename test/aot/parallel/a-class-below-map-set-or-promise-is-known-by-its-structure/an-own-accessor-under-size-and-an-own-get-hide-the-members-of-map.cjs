// One object gets an own accessor under size, another an own get: each hides the member of Map from then on, and until it is deleted.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class H extends Map { count() { return this.size; } look(k) { return this.get(k); } }
const one = new H(), two = new H(); one.set(1, 5); two.set(1, 6);
let sum = 0;
for (let t = 0; t < 400; t++) { for (const m of [one, two]) for (let i = 0; i < 6; i++) sum += m.count() + m.look(1); if (t === 150) Object.defineProperty(one, "size", { get() { return 50; }, configurable: true }); if (t === 250) Object.defineProperty(two, "get", { value() { return 70; }, configurable: true }); if (t === 350) { delete one.size; delete two.get; } }
console.log(sum);
