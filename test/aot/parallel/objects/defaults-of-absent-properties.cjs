// Numbers that stand in for absent properties of records in loops: `x.a || 0`, `x.a ?? 0`, defaults of patterns. Records lack the name, hold null, change, and get it from a prototype.
// STATISTIC: SiteCachedReadsWithWrittenDefaults >= 5
const turns = JSON.parse("36");
const texts = {
  present: i => `{"id":${i},"x":${i / 4 + 0.5},"y":${i % 7},"n":${i}}`,
  lacking: i => `{"id":${i},"x":${i / 4}}`,
  some: i => i % 3 ? `{"id":${i},"x":${i}}` : `{"id":${i},"x":${i},"y":${i / 8}}`,
  nulls: i => `{"id":${i},"x":${i},"y":${i % 2 ? null : i}}`,
  wide: i => `{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"id":${i},"x":${i}${i % 2 ? `,"y":${i}` : ""}}`,
  zeros: i => `{"x":${i},"y":${i % 2 ? "0" : "-0"}}`,
  strings: i => `{"x":${i},"y":"${i % 5 ? i : ""}"}`,
  flags: i => `{"x":${i},"y":${i % 2 === 0}}`,
  orders: i => i % 2 ? `{"y":${i},"x":1.5}` : `{"x":2.5,"z":${i}}`,
};
const lists = {};
for (const name in texts) lists[name] = JSON.parse("[" + Array.from({ length: 20 }, (_, i) => texts[name](i)).join() + "]");
let gets = 0;
lists.getters = Array.from({ length: 20 }, (_, i) => i % 4 ? JSON.parse(`{"x":${i}}`) : { x: i, get y() { return gets++; } });
lists.above = Array.from({ length: 20 }, (_, i) => Object.assign(Object.create(i % 2 ? { y: 3 } : Object.prototype), { x: i }));
const shared = JSON.parse(`{"w":1}`);
lists.shared = Array.from({ length: 20 }, (_, i) => Object.assign(Object.create(shared), JSON.parse(`{"x":${i}${i % 4 ? "" : `,"y":${i}`}}`)));
lists.none = Array.from({ length: 20 }, (_, i) => Object.assign(Object.create(null), { x: i, ...(i % 2 ? { z: i } : {}) }));
lists.proxies = Array.from({ length: 20 }, (_, i) => i % 5 === 4 ? new Proxy({ x: i }, { get(t, k) { gets++; return k === "y" ? 2 : t[k]; } }) : JSON.parse(`{"x":${i}}`));
lists.dictionaries = Array.from({ length: 20 }, (_, i) => { const o = JSON.parse('{"w":1,"x":2,"v":3}'); delete o.w; o.x = i; if (i % 3 === 0) o.y = i; return o; });
lists.others = Array.from({ length: 20 }, (_, i) => i % 4 === 0 ? [i] : i % 4 === 1 ? "text" : i % 4 === 2 ? i : JSON.parse(`{"x":${i}}`));
const reads = {
  or(l) { let s = 0; for (const o of l) s += o.x * (1 + (o.y || 0)); return s; },
  coalesce(l) { let s = 0; for (const o of l) s += o.x * (o.y ?? 2); return s; },
  absent(l) { let s = 0; for (const o of l) s += (o.z || 0.5) + (o.missing ?? 3); return s; },
  indexed(l) { let s = 0; for (let i = 0; i < l.length; i++) s += (l[i].y || 5) * 2; return s; },
  each(l) { let s = 0; l.forEach(o => { s += (o.y ?? 1) - 0.25; }); return s; },
  patterns(l) { let s = 0; for (const { x = 1, y = 4 } of l) s += x * y; return s; },
  conditional(l) { let s = 0; for (const o of l) s += o.y === undefined ? 1 : o.y; return s; },
  presence(l) { let s = 0; for (const o of l) { if (o.y) s += 2; if (!o.z) s += 3; if (o.missing === undefined) s += 5; } return s; },
  both(l) { let s = 0; for (const o of l) s += (o.y || 1) + (o.y ?? 2) - (o.y || 3); return s; },
  negative(l) { let s = 0; for (const o of l) s += 1 / (o.y || -2) + (o.y ?? -1); return s; },
  nested(l) { let s = 0; for (let j = 0; j < 2; j++) for (const o of l) s += (o.y || j) + (o.z || 7); return s; },
  chain(l) { let s = 0; for (const o of l) s += (o.z || o.y || 9) * 1; return s; },
};
const said = [];
function show(value) { return Object.is(value, -0) ? "-0" : typeof value === "string" ? value.length + value.slice(-12) : String(value); }
for (let turn = 0; turn < turns; turn++) {
  for (const name in lists) for (const read in reads) { let answer; try { answer = show(reads[read](lists[name])); } catch (e) { answer = e.name; } said.push(name + " " + read + " " + answer); }
  if (turn === 12) { lists.lacking[3].y = 6; delete lists.present[4].y; lists.some[5].y = "7"; lists.nulls[6].z = 1; Object.setPrototypeOf(lists.wide[2], { y: 50, z: 1 }); Object.freeze(lists.present[9]); }
  if (turn === 18) shared.missing = 4;
  if (turn === 21) delete shared.missing;
  if (turn === 24) Object.defineProperty(shared, "z", { get() { gets++; return this.x; }, configurable: true });
  if (turn === 27) delete shared.z;
  if (turn === 30) shared.y = 1.25;
  if (turn === 33) Object.setPrototypeOf(shared, { z: 2, missing: 1 });
}
// One shape, whose prototype gets the name late.
const above = JSON.parse('{"w":1}');
const below = Array.from({ length: 40 }, (_, i) => Object.setPrototypeOf(JSON.parse(`{"x":${i}}`), above));
const alone = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => `{"x":${i}}`).join() + "]");
function coalesceBelow(l) { let s = 0; for (const o of l) s += o.x * (1 + (o.late ?? 0)); return s; }
function presenceBelow(l) { let s = 0; for (const o of l) if (o.late) s += o.x; else s += 100; return s; }
function orAlone(l) { let s = 0; for (const o of l) s += o.x * (1 + (o.late || 0)); return s; }
function presenceAlone(l) { let s = 0; for (const o of l) if (!o.late) s += o.x; return s; }
function repeat(n) { for (let i = 0; i < n; i++) said.push([coalesceBelow(below), presenceBelow(below), orAlone(alone), presenceAlone(alone)].join(" ")); }
repeat(40);
above.late = 5; repeat(3);
delete above.late; repeat(40);
Object.defineProperty(above, "late", { get() { gets++; return 7; }, configurable: true }); repeat(3);
Object.defineProperty(above, "late", { value: undefined, configurable: true }); repeat(40);
Object.setPrototypeOf(above, { late: 2 }); delete above.late; repeat(3);
alone[7].late = 3; repeat(3);
said.push(...said.slice(-12));
let hash = 0; for (const c of said.join()) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(said.length, hash, gets);
console.log(said.slice(-9).join(", "));
for (const read in reads) console.log(said.filter(s => s.includes(" " + read + " ")).filter((_, i) => i % 97 === 3).join(", "));
