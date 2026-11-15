"use strict";
function hide(row, v) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  Object.defineProperty(row, "mark", { value: v });
  return row.mark + work;
}
class Row {
  constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.head = n + work; }
  seal(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const got = hide(this, v); return got + work; }
}
function attempt(row, v) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  try { return String(row.seal(v) - work); } catch (e) { return e.name; }
}
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const fresh = new Row(1), wide = new Row(5), plain = new Row(6), parent = new Row(7);
  console.log(attempt(fresh, 5), attempt(fresh, 5), attempt(fresh, 6), Object.keys(fresh).join(), Object.getOwnPropertyNames(fresh).join());
  console.log(attempt(Object.preventExtensions(new Row(2)), 5), attempt(Object.seal(new Row(3)), 5), attempt(Object.freeze(new Row(4)), 5));
  wide.extra = work;
  console.log(attempt(wide, 7), Object.keys(wide).join(), Object.getOwnPropertyNames(wide).join());
  plain.mark = work;
  console.log(attempt(plain, 9), Object.keys(plain).join(), (plain.mark = 2));
  const child = Object.create(parent);
  console.log(attempt(parent, 11), child.mark, Object.hasOwn(child, "mark"), Reflect.deleteProperty(fresh, "mark"), fresh.mark);
}
main();
