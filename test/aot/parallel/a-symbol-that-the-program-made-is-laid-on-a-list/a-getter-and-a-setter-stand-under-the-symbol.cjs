"use strict";
const mark = Symbol("mark"); let calls = 0;
function read(list, n) { let out = ""; for (let i = 0; i < n; i++) out += String(list[mark]) + list[i % list.length] + " "; return out; }
for (const make of [() => [1, 2, 3], () => JSON.parse("[1,2,3]")]) {
  const a = make(); Object.defineProperty(a, mark, { get() { calls++; return "got" + this.length; }, set(v) { this.push(v); }, configurable: true });
  console.log(read(a, 5), calls); a[mark] = 4; console.log(read(a, 5), calls, a.length, [...a].join(), a.map((x) => x * 2).join());
  const b = make(); b[mark] = 1; Object.defineProperty(b, mark, { get() { b.length = 1; return "cut"; }, configurable: true });
  console.log(read(b, 4), b.length, b.concat([5]).join(), Object.getOwnPropertySymbols(b).length, Reflect.ownKeys(b).length);
  const c = make(); c[mark] = 1; delete c[mark]; console.log(mark in c, read(c, 2), Reflect.ownKeys(c).length); c[mark] = 2; console.log(read(c, 2));
}
