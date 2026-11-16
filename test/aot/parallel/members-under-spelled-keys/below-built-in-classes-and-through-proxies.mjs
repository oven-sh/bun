// Members under spelled keys on classes below built-in classes, read through proxies, Reflect and super.
const sum = Symbol("sum"), kind = "kind", reg = Symbol.for("below.reg");
class Row extends Array {
  [sum]() { let t = 0; for (let i = 0; i < this.length; i++) t += this[i]; return t; }
  get [kind]() { return "row" + this.length; }
  static [reg]() { return this.name; }
}
class Wide extends Row {
  [sum]() { return super[sum]() * 2; }
  get [kind]() { return "wide " + super[kind]; }
  static [reg]() { return "wide " + super[reg](); }
}
class Fail extends Error { [sum]() { return this.message.length; } }
function ask(list) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let t = work, last = "";
  for (let i = 0; i < list.length; i++) { t += list[i][sum](); last = String(list[i][kind]); }
  return t + last;
}
const list = [];
for (let i = 0; i < 300; i++) list.push(i % 3 === 0 ? Row.of(1, 2) : i % 3 === 1 ? Wide.of(3) : new Fail("four"));
console.log(ask(list), Row[reg](), Wide[reg]());
const seen = [];
const proxy = new Proxy(Wide.of(5), { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } });
console.log(ask([proxy]), seen.filter(k => k.startsWith("Symbol") || k === "kind").join());
console.log(Reflect.get(Wide.prototype, kind, [1, 2, 3]), Reflect.apply(Row.prototype[sum], [4, 5], []), Reflect.has(list[0], sum));
console.log(list[1].map(x => x)[sum](), list[0].concat([9])[kind]);
