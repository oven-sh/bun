const hide = value => [value][JSON.parse("0")];
function Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; }
const accessor = () => ({ get() { return "status of " + this.raw; }, set(value) { this.tag = value; }, configurable: true });
Object.defineProperty(Answer.prototype, "status", accessor());
function build(R) { function _Answer(raw) { this.raw = raw; this.code = 200; this.tag = null; } Object.setPrototypeOf(_Answer.prototype, R.prototype); Object.setPrototypeOf(_Answer, R); return _Answer; }
const Built = build(Answer);
const put = { a: (one, v) => { one.a = v; }, b: (one, v) => { one.b = v; }, c: (one, v) => { one.c = v; }, d: (one, v) => { one.d = v; } };
const store = (one, value) => { one.status = value; };
const read = one => one.status;
const orders = []; const walk = (taken, rest) => { if (!rest.length) orders.push(taken); for (const name of rest) walk([...taken, name], rest.filter(other => other !== name)); }; walk([], ["a", "b", "c", "d"]);
const made = orders.map((order, i) => { const one = hide(new Built(i)); for (const name of order) put[name](one, [name + i, i * 1.5, i, { name, i }][name.charCodeAt(0) - 97]); return one; });
for (let i = 0; i < 24; i++) { const one = hide(new Built(100 + i)); const order = orders[i].slice(0, 1 + i % 3); for (const name of order) put[name](one, name + "-" + i); made.push(one); }
const asks = [new Function("one", "return one.status"), new Function("one", "const name = ['sta', 'tus'].join(''); return one[name]"), new Function("one", "let last; for (let i = 0; i < 3; i++) last = one.status; return last")];
let differ = 0;
for (let first = made.length - 1; first >= 0; first--) {
  Object.defineProperty(Answer.prototype, "status", accessor());
  const filed = read(made[first]); store(made[first], first);
  if (filed !== "status of " + made[first].raw) { differ++; console.log("compiled", first, String(filed)); }
  for (const one of made) { for (const ask of asks) { const got = ask(one); if (got !== "status of " + one.raw) { differ++; if (differ < 20) console.log("asked", first, one.raw, typeof got, String(got)); } } }
  if (made[first].tag !== first) { differ++; console.log("stored", first, made[first].tag); }
}
console.log(differ + " differ", made.length, Object.keys(made[5]).join());
