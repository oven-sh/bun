"use strict";
const names = [];
for (const [name] of [["a"], ["b"]]) names.push(name);
for (const { name } of [{ name: "c" }]) names.push(name);
for (const name of ["d"]) names.push(name);
const kBrand = Symbol("brand"), kOther = Symbol("other");
class Shape { area() { return 1; } }
Object.defineProperty(Shape.prototype, kBrand, { value: true });
Reflect.defineProperty(Shape.prototype, kOther, { get() { return "other"; } });
console.log(names.join(), new Shape().area());
class Square extends Shape { area() { return 2; } }
const describe = value => ({ get() { return value; }, configurable: true });
const kKind = Symbol("kind");
Object.defineProperty(Square.prototype, kKind, describe("square"));
console.log(new Square().area(), Object.getOwnPropertySymbols(Shape.prototype).length, Object.getOwnPropertySymbols(Square.prototype).length);
const areas = [];
for (let i = 0; i < 3; i++) {
  const symbol = Symbol("turn");
  class Turn { area() { return i; } }
  Object.defineProperty(Turn.prototype, symbol, { value: i });
  areas.push(new Turn().area());
}
console.log(areas.join());
class Read { area() { return 5; } }
const kRead = Symbol("read");
Object.defineProperty(Read.prototype, kRead, { get() { return this.area() + 1; } });
function read(object) { return object[kRead]; }
console.log(read(new Read()), read({}), new Read()[kRead]);
class Row { constructor(x) { this.x = x; } }
let last;
for (let i = 0; i < 3; i++) {
  const symbol = Symbol("row"), row = new Row(i);
  Object.defineProperty(row, symbol, { value: i + 10 });
  console.log(row[symbol], last === undefined ? "none" : last[symbol], row.x);
  last = row;
}
if (names.length > 3) {
  const kLate = Symbol("late");
  class Late { area() { return 7; } }
  Object.defineProperty(Late.prototype, kLate, { value: 8 });
  console.log(new Late().area(), new Late()[kLate]);
}
