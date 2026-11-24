// What stands above the instances of classes that extend built-ins changes between two calls of compiled methods.
const out = [];
function one(v) { return Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + Array.from(v, one).join() + "]" : v && typeof v === "object" ? "{}" : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
const names = ["steps", "sum", "list", "parts", "folded", "each", "last", "lasts", "size2", "any", "scaled", "bytes"];
const ask = (o) => names.map((n) => n + attempt(() => (typeof o[n] === "function" ? o[n](1) : o[n]))).join(" ");
const changes = {
  iterator: (A) => { A.prototype[Symbol.iterator] = function* () { yield ["it", 1]; yield ["er", 2]; }; return () => delete A.prototype[Symbol.iterator]; },
  ownIterator: (A, o) => { Object.defineProperty(o, Symbol.iterator, { value: function* () { yield 7; }, configurable: true }); return () => delete o[Symbol.iterator]; },
  values: (A) => { A.prototype.values = function* () { yield 100; }; return () => delete A.prototype.values; },
  length: (A) => { try { Object.defineProperty(A.prototype, "length", { get() { return 2; }, configurable: true }); } catch { } return () => delete A.prototype.length; },
  size: (A) => { Object.defineProperty(A.prototype, "size", { get() { return "many"; }, configurable: true }); return () => delete A.prototype.size; },
  byteLength: (A) => { Object.defineProperty(A.prototype, "byteLength", { get() { return "few"; }, configurable: true }); return () => delete A.prototype.byteLength; },
  forEach: (A) => { A.prototype.forEach = function (f) { f(50); }; return () => delete A.prototype.forEach; },
  reduce: (A) => { A.prototype.reduce = function () { return "reduced"; }; return () => delete A.prototype.reduce; },
  some: (A) => { A.prototype.some = () => "some"; A.prototype.has = () => "has"; return () => { delete A.prototype.some; delete A.prototype.has; }; },
  get: (A) => { A.prototype.get = () => 11; return () => delete A.prototype.get; },
  last: (A) => { const was = Object.getOwnPropertyDescriptor(A.prototype, "last"); Object.defineProperty(A.prototype, "last", { get() { return 3; }, configurable: true }); return () => Object.defineProperty(A.prototype, "last", was); },
  lastValue: (A) => { const was = Object.getOwnPropertyDescriptor(A.prototype, "last"); Object.defineProperty(A.prototype, "last", { value: 4, configurable: true }); return () => Object.defineProperty(A.prototype, "last", was); },
  element: (A) => { Object.defineProperty(A.prototype, "2", { get() { return 40; }, configurable: true }); return () => delete A.prototype[2]; },
  elementValue: (A) => { try { A.prototype[0] = "zero"; } catch { } return () => delete A.prototype[0]; },
  above: (A) => { const was = Object.getPrototypeOf(A.prototype); Object.setPrototypeOf(A.prototype, { __proto__: was, 3: "three", get size() { return "above"; }, forEach(f) { f(60); } }); return () => Object.setPrototypeOf(A.prototype, was); },
  own: (A, o) => { Object.setPrototypeOf(o, { __proto__: A.prototype, get last() { return 8; }, sum() { return "own"; }, [Symbol.iterator]: function* () { yield 9; } }); return () => Object.setPrototypeOf(o, A.prototype); },
  method: (A) => { const was = A.prototype.sum; A.prototype.sum = function () { return "summed"; }; return () => { A.prototype.sum = was; }; },
};
function askAll(kind, A, m, h, direct) {
  for (const change in changes) {
    const line = [kind, change]; let undo;
    for (let round = 0; round < 2; round++) line.push(ask(m), ask(h), direct(m), direct(h));
    line.push(attempt(() => { undo = changes[change](A, m); return "done"; }));
    for (let round = 0; round < 2; round++) line.push(ask(m), ask(h), direct(m), direct(h));
    attempt(() => undo?.()); line.push(ask(m), ask(h), direct(m), direct(h));
    out.push(line.join("|"));
  }
}
{
  class A extends Array { steps() { let s = ""; for (const v of this) s += one(v) + ","; return s; } sum() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; } list() { return [...this]; } parts() { const [a, b] = this; return [a, b]; } folded() { return this.reduce((a, b) => a + b, 0); } each() { let s = 0; this.forEach((v) => { s += v; }); return s; } get last() { return this[this.length - 1]; } lasts() { let s = 0; for (let i = 0; i < 9; i++) s += this.last; return s; } size2() { return this.length; } any() { return this.some((v) => v === 2); } scaled(x) { for (let i = 0; i < this.length; i++) this[i] *= x; return this.sum(); } } const m = new A(); for (let i = 0; i < 6; i++) m.push(i); const h = new A(5); h[1] = 1;
  const direct = (o) => { let s = ""; for (let i = 0; i < 3; i++) s += attempt(() => o.steps()) + attempt(() => o.sum()) + attempt(() => o.each()) + attempt(() => o.lasts()) + attempt(() => o.size2()) + attempt(() => o.any()) + "/"; return s; };
  askAll("Array", A, m, h, direct);
}
{
  class A extends Map { steps() { let s = ""; for (const [k, v] of this) s += k + one(v) + ","; return s; } sum() { let s = 0; for (const v of this.values()) s += v; return s; } list() { return [...this].length; } parts() { const [a] = this; return a; } each() { let s = 0; this.forEach((v) => { s += v; }); return s; } get last() { return this.get(5); } lasts() { let s = 0; for (let i = 0; i < 9; i++) s += this.last; return s; } size2() { return this.size; } any() { return this.has(2); } } const m = new A(); for (let i = 0; i < 6; i++) m.set(i, i); const h = new A();
  const direct = (o) => { let s = ""; for (let i = 0; i < 3; i++) s += attempt(() => o.steps()) + attempt(() => o.sum()) + attempt(() => o.each()) + attempt(() => o.lasts()) + attempt(() => o.size2()) + attempt(() => o.any()) + "/"; return s; };
  askAll("Map", A, m, h, direct);
}
{
  class A extends Set { steps() { let s = ""; for (const v of this) s += v + ","; return s; } sum() { let s = 0; for (const v of this) s += v; return s; } list() { return [...this].length; } parts() { const [a, b] = this; return [a, b]; } each() { let s = 0; this.forEach((v) => { s += v; }); return s; } get last() { return this.has(5); } lasts() { let s = 0; for (let i = 0; i < 9; i++) s += this.last; return s; } size2() { return this.size; } any() { return this.has(2); } } const m = new A(); for (let i = 0; i < 6; i++) m.add(i); const h = new A();
  const direct = (o) => { let s = ""; for (let i = 0; i < 3; i++) s += attempt(() => o.steps()) + attempt(() => o.sum()) + attempt(() => o.each()) + attempt(() => o.lasts()) + attempt(() => o.size2()) + attempt(() => o.any()) + "/"; return s; };
  askAll("Set", A, m, h, direct);
}
{
  class A extends Float64Array { steps() { let s = ""; for (const v of this) s += v + ","; return s; } sum() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; } list() { return [...this]; } parts() { const [a, b] = this; return [a, b]; } folded() { return this.reduce((a, b) => a + b, 0); } each() { let s = 0; this.forEach((v) => { s += v; }); return s; } get last() { return this[this.length - 1]; } lasts() { let s = 0; for (let i = 0; i < 9; i++) s += this.last; return s; } size2() { return this.length; } any() { return this.some((v) => v === 2); } scaled(x) { for (let i = 0; i < this.length; i++) this[i] *= x; return this.sum(); } bytes() { return this.byteLength; } } const m = new A(6); for (let i = 0; i < 6; i++) m[i] = i; const h = new A(3);
  const direct = (o) => { let s = ""; for (let i = 0; i < 3; i++) s += attempt(() => o.steps()) + attempt(() => o.sum()) + attempt(() => o.each()) + attempt(() => o.lasts()) + attempt(() => o.size2()) + attempt(() => o.any()) + "/"; return s; };
  askAll("Float64Array", A, m, h, direct);
}
for (const l of out) console.log(l);
