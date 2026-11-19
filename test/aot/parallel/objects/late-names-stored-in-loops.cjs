// Loops store a name, which their first pass adds, into the objects whose fields they compute with.
// STATISTIC: AddressesFoundInIterations >= 4
let calls = 0;
const list = Array.from({ length: 40 }, (_, i) => JSON.parse(`{"id":${i},"price":${i % 3 ? i / 3 + 0.5 : i},"count":${i % 7 + 1},"name":"p${i}"}`));
function totals(l) { for (const o of l) o.total = o.price * o.count; return l[3].total; }
function flags(l) { for (let i = 0; i < l.length; i++) { const o = l[i]; o.big = o.price > 5; } return l[3].big; }
function taxes(l) { l.forEach(o => { o.tax = o.price * 0.2 + o.count; }); return l[3].tax; }
function some(l) { for (const o of l) if (o.count > 3) o.rest = o.price - o.count; return l[4].rest; }
function over(l) { for (const o of l) o.count = o.price * 2; return l[3].count; }
const show = l => l.map(o => o && typeof o === "object" ? [o.price, o.count, o.total, o.big, o.tax, o.rest].map(v => Object.is(v, -0) ? "-0" : String(v)).join(" ") : String(o)).join("|");
let s = "";
for (let t = 0; t < 20; t++) s = [totals(list), flags(list), taxes(list), some(list)].join();
console.log(s, show(list.slice(0, 5)));
for (let t = 0; t < 3; t++) s = [over(list), totals(list)].join();
console.log(s, Object.keys(list[4]).join(), Object.keys(list[1]).join());
const fresh = i => JSON.parse(`{"id":${i},"price":${i},"count":2}`);
const odd = [fresh(1), Object.freeze(fresh(2)), Object.seal(fresh(3)), Object.preventExtensions(fresh(4)), new Proxy(fresh(5), { set(t, k, v) { calls++; t[k] = v; return true; }, get(t, k) { calls += 10; return t[k]; } }),
  Object.defineProperty(fresh(6), "total", { set(v) { calls += 100; }, get() { return "got"; }, configurable: true }), Object.create(Object.defineProperty(fresh(7), "total", { set(v) { calls += 1000; } })), JSON.parse('{"price":"8","count":null}'), JSON.parse('{"price":-1,"count":0}'), Object.defineProperty(fresh(9), "total", { value: 5 }), [], fresh(10)];
for (let t = 0; t < 12; t++) {
  totals(odd); flags(odd); taxes(odd); some(odd);
  if (t % 5 === 0) console.log(show(odd), calls);
  if (t === 3) { delete odd[0].total; odd[11].total = "text"; Object.freeze(odd[7]); }
  if (t === 6) { Object.defineProperty(odd[0], "total", { get() { calls += 7; return 1; }, configurable: true }); delete odd[11]; odd[11] = fresh(12); }
}
for (const f of [totals, flags, taxes]) { const l = [fresh(1), null, fresh(2)]; try { f(l); } catch (e) { console.log(e.name, show(l)); } }
console.log(calls);
