// Env of the executable: BUN_JSC_collectContinuously=1
"use strict";
const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
class Instance { constructor() { this.a = null; this.b = null; this.c = null; this.d = null; } }
const makers = [
  () => { const o = Object.create(null); for (const k of names) o[k] = null; return o; },
  () => ({ a: null, b: null, c: null, d: null, e: null, f: null, g: null, h: null }),
  () => JSON.parse('{"a":null,"b":null,"c":null,"d":null,"e":null,"f":null,"g":null,"h":null}'),
  () => new Instance(),
  () => ({}),
];
let seed = 12345;
const random = m => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % m;
const put = (o, k, v) => Reflect.set(o, k, v);
const handler = { set(t, k, v, r) { return Reflect.set(t, k, v); } };
for (const make of makers) {
  const old = [];
  for (let i = 0; i < 40000; i++) old.push(make());
  for (let i = old.length - 1; i > 0; i--) { const j = random(i + 1), t = old[i]; old[i] = old[j]; old[j] = t; }
  const proxies = old.map(o => new Proxy(o, handler));
  let refused = 0, lost = 0, thrown = 0;
  for (let i = 0; i < 60000; i++) {
    const at = random(old.length), k = names[i & 7], v = [i, i + 1];
    if (put(old[at], k, v) !== true) refused++;
    if (old[at][k] !== v) lost++;
    if (i & 3) continue;
    try { proxies[at][names[(i >> 2) & 7]] = v; } catch { thrown++; }
  }
  console.log(refused, lost, thrown);
}
