// What is copied name by name into a record is not expected to be such a record.
// STATISTIC: SiteCachedReadsEmittedInline >= 27
let calls = 0;
const record = i => JSON.parse(`{"id":${i},"title":"t${i}","price":${i / 3 + 0.5},"tag":"g${i % 4}","size":{"wide":${i},"high":2}}`);
const list = Array.from({ length: 40 }, (_, i) => record(i));
function replies(l) { return l.map(o => ({ id: o.id, title: o.title })); }
function taken(l) { return l.map(({ price, tag }) => ({ price, tag })); }
function pushed(l) { const r = []; for (const o of l) if (o.price > 2) r.push({ id: o.id, price: o.price, tag: o.tag }); return r; }
function sizes(l) { return l.map(o => o.size).map(s => ({ wide: s.wide, high: s.high })); }
class Entry { constructor(o) { this.id = o.id; this.title = o.title; } get line() { return this.id + this.title; } }
function entries(l) { return l.map(o => new Entry(o)); }
let s = 0;
for (let t = 0; t < 30; t++) s += replies(list).length + taken(list)[3].price + pushed(list).length + sizes(list)[5].wide + entries(list)[2].line.length;
console.log(s, JSON.stringify(replies(list).slice(0, 2)), JSON.stringify(taken(list)[7]), JSON.stringify(pushed(list)[1]), JSON.stringify(sizes(list)[9]), entries(list)[4].line);
for (let t = 0; t < 10; t++) {
  const again = replies(replies(list)), both = taken(taken(list).concat(list.slice(0, 3)));
  if (t === 9) console.log(JSON.stringify(again.slice(1, 3)), JSON.stringify(both.slice(39, 42)), entries(entries(list))[3].line, JSON.stringify(sizes([{ size: sizes(list)[2] }, ...list])[0]));
}
const odd = [record(1), replies([record(2)])[0], new Entry(record(3)), Object.freeze(record(4)), new Proxy(record(5), { get(t, k) { calls++; return t[k]; } }), Object.defineProperty(record(6), "id", { get() { calls += 10; return 60; } }),
  Object.create(record(7)), { title: "late", get id() { calls += 100; return -0; } }, JSON.parse('{"title":null}'), [], "text", 5, true];
for (let t = 0; t < 20; t++) { const line = JSON.stringify(replies(odd)) + JSON.stringify(taken(odd)) + JSON.stringify(pushed(odd)); if (t % 9 === 0) console.log(line, calls); if (t === 5) { odd[0] = new Entry(record(8)); list[3] = replies([list[3]])[0]; odd[8].id = NaN; } }
for (const f of [replies, taken, entries, sizes]) { try { console.log(JSON.stringify(f([record(1), null]))); } catch (e) { console.log(e.name); } try { f([undefined]); } catch (e) { console.log(e.name); } }
console.log(calls);
