"use strict";
// COUNT: operation:operationAOTFillSiteAnswers <= 40
function add(a, b) { return (a + b) | 0; }
function low(a) { return a & 15; }
const created = Object.create({});
Object.defineProperty(created, "add", { enumerable: true, get: function () { return add; } });
Object.defineProperty(created, "low", { enumerable: true, get: function () { return low; } });
const written = {};
Object.defineProperty(written, "add", { enumerable: true, get: () => add });
class Box { constructor(by) { this.by = by; Object.defineProperty(this, "add", { configurable: true, get() { return (a, b) => (a + b + this.by) | 0; } }); } }
const boxes = [new Box(1), new Box(2), new Box(3)];
function drive(turns) {
  let s = 0;
  for (let i = 0; i < turns; i++) s = (s + created.add(i, 1) + created.low(i) + written.add(i, 2) + boxes[i % 3].add(i, 3)) | 0;
  return s;
}
console.log(drive(+(process.argv[2] ?? 3000)));
