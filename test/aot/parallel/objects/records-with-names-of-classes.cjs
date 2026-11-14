// Records have a name that classes of the library have too, beside names that none of those has.
// STATISTIC: SiteCachedReadsEmitted >= 8
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"name":"p${i}","x":${i / 3 + 0.5},"y":${0.1 + i},"code":${i}}`);
const list = Array.from({ length: 60 }, (_, i) => record(i));
function sums(l) { let a = 0; for (let i = 0; i < l.length; i++) { const o = l[i]; a += o.x * o.y + o.name.length; } return a; }
function taken(l) { let a = 0; for (const { x, y, name } of l) a += x * y + name.length; return a; }
let s = 0;
for (let t = 0; t < turns; t++) s += sums(list) + taken(list);
console.log(s);
const odd = [record(1), Object.assign(new RangeError("m"), JSON.parse('{"x":2,"y":2,"name":"Failure"}')), Object.assign(new TypeError("t"), JSON.parse('{"x":1,"y":2}')), Object.assign(new Error("e"), JSON.parse('{"x":4}')), Object.assign(() => 1, JSON.parse('{"x":2,"y":3}')), JSON.parse('{"name":[1,2,3],"x":1,"y":2}'),
  JSON.parse('{"name":{"length":7},"x":1,"y":2}'), new Proxy(record(3), { get(t, k) { calls++; return t[k]; } }), Object.defineProperty(record(4), "name", { get() { calls += 10; return "abc"; } }), record(5)];
for (let t = 0; t < turns; t++) {
  const line = odd.map(o => [sums([o, record(2)]), taken([record(2), o])].join(":")).join(" ");
  if (t % 13 === 0) console.log(line, calls, sums(odd), taken(odd));
}
for (const f of [sums, taken]) { try { console.log(f([record(1), JSON.parse('{"x":1,"y":2}')])); } catch (e) { console.log(e.name); } }
