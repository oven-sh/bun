// Functions that update the record they are given, inlined into loops over records.
// STATISTIC: AddressesFoundInIterations >= 8
const turns = JSON.parse("40");
const record = i => JSON.parse(`{"x":${i},"y":${i / 4 + 0.5},"vx":${0.1 + i},"vy":0.25,"n":${i % 5}}`);
const list = Array.from({ length: 40 }, (_, i) => record(i));
let calls = 0;
function step(o, dt) { o.x += o.vx * dt; }
function all(l, dt) { for (const o of l) step(o, dt); return l[3].x; }
let s = 0;
for (let t = 0; t < turns; t++) s += all(list, 0.016);
console.log(s);
const accessor = record(6);
Object.defineProperty(accessor, "x", { get() { calls++; return 2; }, set(v) { calls += 10; }, configurable: true });
const odd = [record(1), Object.freeze(record(2)), record(3), accessor, new Proxy(record(4), { get(t, k) { calls++; return t[k]; }, set(t, k, v) { calls++; t[k] = v; return true; } }), Object.create(JSON.parse('{"x":1,"vx":3}')), JSON.parse('{"vx":2}'), record(5), JSON.parse('{"x":"t","vx":1}'), JSON.parse('{"vx":1,"x":null}')];
for (let t = 0; t < turns; t++) all(odd, 0.5);
console.log(calls, JSON.stringify(odd.map(o => typeof o.x === "number" ? o.x : String(o.x).length)));
function both(o, dt) { o.x += o.vx * dt; o.y += o.vy * dt; }
for (let t = 0; t < turns; t++) { for (const o of list) both(o, 0.5); if (t === 10) delete list[4].y; if (t === 20) list[5].vy = "1"; if (t === 30) Object.defineProperty(list[6], "y", { value: 2, writable: false }); }
console.log(JSON.stringify(list.slice(3, 8)));
function exchange(o, p) { const x = o.x; o.x = p.x; p.x = x; }
for (let t = 0; t < turns; t++) for (let i = 1; i < list.length; i++) exchange(list[i - 1], list[i]);
console.log(list.map(o => o.x).join().length, list[0].x, list[39].x);
function twice(o, p) { o.n += 1; p.n += o.n; }
for (let t = 0; t < 5; t++) for (const o of list) twice(o, o);
console.log(list.map(o => o.n).join());
