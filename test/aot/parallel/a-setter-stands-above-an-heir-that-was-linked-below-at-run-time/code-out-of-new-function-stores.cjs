// A setter lies on Answer.prototype; `_Answer` is linked below it at run time through a parameter, so the build lists `status` as a field that an _Answer may gain; three fields of birth fill the cell.
// Objects of one layout bear four more names laid in all 24 orders, and parts of them; every fourth holds `status` itself, defined as undefined. COMPILED code stores first, under each object's order in turn; then code out of `new Function` stores by the name, by a computed key and in a loop.
const hide = value => [value][JSON.parse("0")];
function Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; }
const accessor = () => ({ get() { return "status of " + this.raw; }, set(value) { this.tag = value; }, configurable: true });
Object.defineProperty(Answer.prototype, "status", accessor());
function build(R) { function _Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; } Object.setPrototypeOf(_Answer.prototype, R.prototype); Object.setPrototypeOf(_Answer, R); return _Answer; }
const Built = build(Answer);
const put = { a: (one, v) => { one.a = v; }, b: (one, v) => { one.b = v; }, c: (one, v) => { one.c = v; }, d: (one, v) => { one.d = v; } };
const store = (one, value) => { one.status = value; };
const orders = []; const walk = (taken, rest) => { if (!rest.length) orders.push(taken); for (const name of rest) walk([...taken, name], rest.filter(other => other !== name)); }; walk([], ["a", "b", "c", "d"]);
const made = orders.map((order, i) => { const one = hide(new Built(i)); for (const name of order) put[name](one, [name + i, i * 1.5, i, { name, i }][name.charCodeAt(0) - 97]); return one; });
for (let i = 0; i < 24; i++) { const one = hide(new Built(100 + i)); for (const name of orders[i].slice(0, 1 + i % 3)) put[name](one, name + "-" + i); made.push(one); }
const owners = new Set();
made.forEach((one, i) => { if (i % 4 === 3) { Object.defineProperty(one, "status", { value: undefined, writable: true, enumerable: true, configurable: true }); owners.add(one); } });
let differ = 0, stores = 0;
const check = (who, one, value) => { stores++; const right = owners.has(one) ? Object.getOwnPropertyDescriptor(one, "status").value === value && one.tag !== value : one.tag === value && !Object.hasOwn(one, "status"); if (!right) { differ++; if (differ < 12) console.log(who, one.raw, owners.has(one), String(one.tag), Object.hasOwn(one, "status")); } };
const writers = [["by name", new Function("one", "value", "one.status = value")], ["by key", new Function("one", "value", "const name = ['sta', 'tus'].join(''); one[name] = value")], ["in a loop", new Function("one", "value", "for (let i = 0; i < 3; i++) one.status = value")], ["strict", new Function("one", "value", "'use strict'; one.status = value")]];
let turn = 0;
for (let first = made.length - 1; first >= 0; first--) {
  Object.defineProperty(Answer.prototype, "status", accessor());
  for (let again = 0; again < 4; again++) { store(made[first], ++turn); check("compiled", made[first], turn); }
  for (const one of made) { store(one, ++turn); check("compiled, all", one, turn); for (const [who, write] of writers) { write(one, ++turn); check(who, one, turn); } }
}
console.log(differ + " differ of " + stores, made.length, Object.keys(made[5]).join(), Object.keys(made[7]).join());
