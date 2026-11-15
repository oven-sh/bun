// Several names read off one unknown object in a loop: objects of one structure, of several, of more than the cache has rows, with properties out of the cell, deleted, behind getters and prototypes, changed in the loop, and behind collections.
const log = [];
function sums(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const o = list[i]; sum += o.x * 2 + o.y - o.z; } return sum; }
function pairs(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const o = list[i]; sum += o.a.x * o.b.y - o.a.y * o.b.x; } return sum; }
function lone(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].z; return sum; }
function six(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const o = list[i]; sum += o.x + o.y + o.z + o.p + o.q + o.r; } return sum; }
function texts(list) { let text = ""; for (let i = 0; i < list.length; i++) { const o = list[i]; text += o.name + ":" + o.z + ";"; } return text; }
const numbers = [0, 1, 2, 3, 4, 5, 6, 7];
const makers = {
  plain: i => JSON.parse(`{"x":${i},"y":${i + 0.5},"z":${i * 2}}`),
  wide: i => { const o = JSON.parse('{"x":0}'); for (let k = 0; k < 20; k++) o["w" + k] = k; o.y = i; o.z = i * 3; o.x = i + 1; return o; },
  mixed: i => i % 2 ? makers.plain(i) : makers.wide(i),
  five: i => { const o = {}; for (let k = 0; k <= i % 5; k++) o["k" + k] = k; o.x = i; o.y = 2; o.z = i + 0.25; return JSON.parse(JSON.stringify(o)); },
  ten: i => { const o = {}; for (let k = 0; k <= i % 10; k++) o["m" + k] = k; o.z = i; o.y = 2; o.x = i; return JSON.parse(JSON.stringify(o)); },
  getter: i => { const o = makers.plain(i); if (i === 5) Object.defineProperty(o, "y", { get() { log.push("got"); return 9; } }); return o; },
  inherited: i => { const o = Object.create({ z: 100 + i }); o.x = i; o.y = 1; return o; },
  deleted: i => { const o = makers.wide(i); if (i > 3) { delete o.w3; delete o.w5; } return o; },
  missing: i => { const o = makers.plain(i); if (i === 6) delete o.y; return o; },
  frozen: i => Object.freeze(makers.plain(i)),
  kept: i => ({ x: i, y: 1, z: i }),
  instance: i => new (class { x = i; y = i; z = 4; })(),
};
for (const name in makers) {
  const list = JSON.parse("[0,1,2,3,4,5,6,7]").map(makers[name]);
  for (let turn = 0; turn < 60; turn++) { const s = sums(list), l = lone(list); if (turn % 20 === 0) log.push(name + " " + s + " " + l); if (turn === 30) Bun.gc(true); }
  const two = list.map((o, i) => JSON.parse('{"a":0,"b":0}')); two.forEach((t, i) => { t.a = list[i]; t.b = list[7 - i]; });
  for (let turn = 0; turn < 30; turn++) { const s = pairs(two); if (turn % 15 === 0) log.push(name + " pairs " + s); }
  list[3] = makers.ten(3); if (Object.isExtensible(list[4])) list[4].extra = 1; if (!Object.isFrozen(list[2])) list[2].z = 50;
  log.push(name + " changed " + sums(list) + " " + lone(list) + " " + pairs(two));
}
const all = numbers.flatMap(i => Object.values(makers).map(make => make(i)));
for (let turn = 0; turn < 40; turn++) { const s = sums(all); if (turn % 13 === 0) log.push("all " + s); }
const wide = numbers.map(i => JSON.parse(`{"x":${i},"y":1,"z":2,"p":3,"q":4,"r":${i}}`));
for (let turn = 0; turn < 30; turn++) { if (turn === 12) wide[4].s = 1; if (turn === 20) delete wide[5].q; const s = six(wide); if (turn % 6 === 0) log.push("six " + s); }
const named = numbers.map(i => JSON.parse(`{"name":"n${i}","z":${i}}`));
for (let turn = 0; turn < 20; turn++) { if (turn === 9) named[2].name = { toString() { named[3].z = 77; return "late"; } }; const s = texts(named); if (turn % 6 === 0) log.push(s); }
for (const odd of [null, undefined, 5, "text", Symbol("s"), [1, 2], () => 1, new Proxy({ x: 1, y: 2, z: 3 }, {})]) { const list = numbers.map(makers.plain); list[4] = odd; let said; try { said = sums(list); } catch (error) { said = error?.constructor?.name; } log.push(typeof odd + " " + String(said)); }
console.log(log.join("\n"));
