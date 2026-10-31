// Objects below read a name that is absent, then the object above them gets it by a definition.
"use strict";
class Base { constructor() { this.own = 1; } method() { return "method of Base"; } get accessor() { return "accessor of Base"; } }
function readAll(o) { return [o.late, o.method(), o.accessor, o.own].join(","); }
const shared = { a: 1 };
const children = [];
for (let i = 0; i < 8; i++) children.push(Object.create(shared));
function readLate(o) { return o.late; }
let seen = "";
for (let turn = 0; turn < 40; turn++) {
  for (const child of children) seen += readLate(child) === undefined ? "." : readLate(child);
  if (turn === 20) Object.defineProperty(shared, "late", { value: "L", configurable: true });
  if (turn === 25) Object.defineProperty(shared, "late", { get() { return "G"; }, configurable: true });
  if (turn === 30) Object.defineProperty(children[3], "late", { value: "C" });
  if (turn === 35) delete shared.late;
}
console.log(seen);

const instances = [];
for (let i = 0; i < 6; i++) instances.push(new Base());
for (let turn = 0; turn < 12; turn++) {
  console.log(turn, instances.map(readAll).join(" "));
  if (turn === 3) Object.defineProperty(instances[1], "method", { value() { return "own method"; } });
  if (turn === 4) Object.defineProperty(instances[2], "accessor", { get() { return "own accessor"; } });
  if (turn === 5) Object.defineProperty(Base.prototype, "late", { value: "late of Base", configurable: true });
  if (turn === 6) Object.defineProperty(instances[3], "late", { value: "own late", enumerable: true });
  if (turn === 7) Object.defineProperty(Base.prototype, "method", { value() { return "new method of Base"; } });
  if (turn === 8) Object.defineProperty(Base.prototype, "accessor", { value: "now a value" });
  if (turn === 9) Object.defineProperty(instances[4], "own", { get() { return "own by getter"; } });
  if (turn === 10) Object.defineProperty(instances[5], "late", { get() { return "late by getter"; }, configurable: true });
}
console.log(instances.map(o => Reflect.ownKeys(o).join("+")).join(" "));
