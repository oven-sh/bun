// A constructor function is constructed three times, is then given another prototype object, and is constructed 200,000 times more: behind the first construction below the new prototype the run time is not asked again, but where an allocator has run dry or a collection has come between.
// COUNT: operation:operationAOTSetConstructPrototype <= 4000
"use strict";
function Plain(n) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.a = n; this.b = n + 1; this.c = "c" + (n & 3); this.d = n / 2 + work;
}
Plain.prototype.kind = function () { return 1; };
function plain(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Plain(n + work); }
const other = { kind() { return 2; } };
const later = other;
let sum = 0, wrong = 0;
for (let turn = 0; turn < 3; turn++) sum += plain(turn).kind();
Plain.prototype = later;
for (let turn = 0; turn < 200000; turn++) {
  const made = plain(turn);
  if (Object.getPrototypeOf(made) !== other) wrong++;
  sum += made.kind() + made.a + made.b + made.c.length + made.d;
}
console.log(sum, wrong, Object.keys(plain(1)).join(""));
