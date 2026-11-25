// Objects that are built under computed keys, read by name in loops: the first object of a place is a dictionary, the others share a structure.
"use strict";
const log = [];
const keyed = {
  reduced: i => ["x", "y"].reduce((o, k, j) => { o[k] = i + j; return o; }, {}),
  looped: i => { const o = {}; for (const [k, v] of [["x", i], ["y", 1], ["name", "n" + i]]) o[k] = v; return o; },
  entries: i => Object.fromEntries([["x", i], ["y", i * 0.5], ["name", "m" + i]]),
  parsed: i => JSON.parse(`{"x":${i},"y":${i % 3}.5,"name":"p${i}"}`),
  partly: i => { const o = {}; for (const k of i % 9 === 4 ? ["y"] : ["x", "y"]) o[k] = i; return o; },
  kinds: i => { const o = {}; for (const k of ["x", "y"]) o[k] = i === 37 ? "text" : i; return o; },
  getters: i => { const o = {}; for (const k of ["x", "y"]) if (i % 11 === 5) Object.defineProperty(o, k, { get: () => 0.25, configurable: true, enumerable: true }); else o[k] = i; return o; },
  linked: i => { const o = i % 13 === 6 ? Object.create({ x: 7, y: 8 }) : {}; if (i % 13 !== 6) for (const k of ["x", "y"]) o[k] = i; return o; },
  proxied: i => { const o = {}; for (const k of ["x", "y"]) o[k] = i; return i % 10 === 3 ? new Proxy(o, { get: (t, k) => k === "x" ? 0.5 : t[k] }) : o; },
  many: i => { const o = {}; for (let k = 0; k < 20; k++) o["f" + k] = k; o.x = i; o["y"] = 2; return o; },
  wide: i => { const o = {}; for (let k = 0; k < 4; k++) o["f" + (k + i % 3)] = k; o["x"] = i; o["y"] = 3; return o; },
  deleted: i => { const o = {}; for (const k of ["z", "x", "y"]) o[k] = i; delete o.z; return o; },
  arrays: i => { const o = []; for (const k of ["x", "y"]) o[k] = i; return o; },
  functions: i => { const o = () => 1; for (const k of ["x", "y"]) o[k] = i; return o; },
};
const loops = {
  sum(a, n) { let s = 0; for (let i = 0; i < n; i++) { const o = a[i % a.length]; s = s + o.x + o.y; } return s; },
  or(a, n) { let s = 0; for (let i = 0; i < n; i++) { const o = a[i % a.length]; s = (s + o.x + o.y) | 0; } return s; },
  one(a, n) { let s = 0; for (let i = 0; i < n; i++) { const o = a[i ? 1 + i % (a.length - 1) : 0]; s = s + o.x; } return s; },
  most(a, n) { let m = -1; for (let i = 0; i < n; i++) { const o = a[i % a.length]; if (o.x > m) m = o.x; if (o.y === 3) m += 0.125; } return m; },
  of(a, n) { let s = 0; for (let r = 0; r < n / a.length; r++) for (const o of a) { s += o.x; s -= o.y; } return s; },
  length(a, n) { let s = 0; for (let i = 0; i < n; i++) { const o = a[i % a.length]; if (o.name) s += o.name.length; s += o.x; } return s; },
};
for (const [maker, make] of Object.entries(keyed)) {
  for (const [name, loop] of Object.entries(loops)) {
    const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
    const run = n => { try { return String(loop(all, n)).slice(0, 60); } catch (e) { return e.constructor.name; } };
    const line = [maker, name, run(3), run(40), run(200)];
    for (let j = 0; j < 40; j += 7) { try { if (j % 2) all[j].x = "s" + j; else delete all[j].y; } catch (e) { line.push(e.constructor.name); } }
    line.push(run(200));
    all.unshift(make(41)); all.sort((p, q) => (q.x > p.x) - (q.x < p.x));
    line.push(run(120), run(400));
    log.push(line.join(" "));
  }
}
for (const line of log) console.log(line);
