// Sixteen doubles live across stubs whose rare ways enter C++: new names, storage that grows, strings, conversions, iterations, collections, exceptions.
"use strict";
const out = [];
let seed = 12345;
const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
class Bag { constructor() { this.made = 0; } }
class Deep extends Bag { constructor() { super(); this.name = "deep"; } get late() { return this.made + 0.5; } set late(v) { this.made = v; } }
const actions = [
  (i, o) => { o["k" + (i % 97)] = i + 0.25; return o.made; },
  (i, o, list) => { list.push(i % 3 ? i + 0.5 : "s" + i); return list.length; },
  (i, o, list) => { list[i % 211] = i; return list.length; },
  (i, o, list, map) => { map.set("m" + (i % 61), i * 0.5); return map.size; },
  (i, o, list, map) => { map.set(i % 53, { i }); return map.size; },
  (i) => ("some long text number " + i).substring(3, 14 + (i % 5)).length,
  (i) => ("a" + i + "b" + (i * 0.5)).indexOf("b"),
  (i) => Number("1." + (i % 1000)) | 0,
  (i, o) => { o.late = i; return o.late ?? 0; },
  (i) => { try { if (i % 5 === 0) throw new RangeError("r" + i); return 1; } catch (error) { return error.message.length; } },
  (i) => String(i * 1.5 + 0.125).length,
  (i) => [i, i + 1, i + 2].map((x) => x * 0.5).length,
  (i, o) => Object.keys(o).length % 7,
  (i) => ({ ...{ a: i, b: i + 0.5 }, c: 1 }).b | 0,
  (i, o) => ("k" + (i % 131)) in o ? 1 : 0,
  (i, o) => delete o["k" + (i % 89)] ? 1 : 0,
  (i) => (i % 2 ? 5n : 7n) === 7n ? 1 : 0,
  (i) => ("t" + (i % 9) === "t4") ? 2 : 3,
  (i, o, list) => list.indexOf("s" + (i % 400)),
  (i) => /[0-9]+/.exec("x" + i + "y")[0].length,
  (i) => new Float64Array(3 + (i % 4)).length,
  (i) => Symbol("s" + i).toString().length,
];
for (const action of actions) globalThis["kept" + actions.indexOf(action)] = action;
function run(rounds, action, o, list, map) {
  let a = 0.1, b = 1.3, c = -2.7, d = 3.9, e = 4.01, f = -5.5, g = 6.25, h = 7.125, p = 8.5, q = -9.75, r = 10.0625, s = 11.2, t = 12.4, u = -13.6, v = 14.8, w = 15.16;
  for (let i = 0; i < rounds; i++) {
    const n = action(i, o, list, map);
    a += b * 0.5; b -= c * 0.25; c += d * 0.125; d -= e * 0.5; e += f * 0.25; f -= g * 0.125; g += h * 0.0625; h -= p * 0.5;
    const m = action(i + 7, o, list, map);
    p += q * 0.25; q -= r * 0.125; r += s * 0.0625; s -= t * 0.03125; t += u * 0.5; u -= v * 0.25; v += w * 0.125; w -= a * 0.0625 + (n + m) * 1e-6;
    if (Math.abs(a) > 1e6) { a *= 1e-6; b *= 1e-6; c *= 1e-6; d *= 1e-6; e *= 1e-6; f *= 1e-6; g *= 1e-6; h *= 1e-6; p *= 1e-6; q *= 1e-6; r *= 1e-6; s *= 1e-6; t *= 1e-6; u *= 1e-6; v *= 1e-6; w *= 1e-6; }
  }
  return [a, b, c, d, e, f, g, h, p, q, r, s, t, u, v, w];
}
function inPlace(rounds) {
  const o = new Deep(), list = [], map = new Map();
  let a = 0.5, b = 1.5, c = 2.5, d = 3.5, e = 4.5, f = 5.5, g = 6.5, h = 7.5, p = 8.5, q = 9.5, r = 10.5, s = 11.5, t = 12.5, u = 13.5, v = 14.5, w = 15.5;
  for (let i = 0; i < rounds; i++) {
    o["n" + (i % 301)] = a; list.push(b, "t" + i); map.set("x" + (i % 127), c);
    const text = ("text " + i + " and more of it").substring(i % 4, 9 + (i % 6));
    a += text.length * 0.01; b -= a * 0.5; c += b * 0.25; d -= c * 0.125; e += d * 0.0625; f -= e * 0.5; g += f * 0.25; h -= g * 0.125;
    if (!(i % 17)) list.length = i % 5;
    p += h * 0.5; q -= p * 0.25; r += q * 0.125; s -= r * 0.0625; t += s * 0.5; u -= t * 0.25; v += u * 0.125; w -= v * 0.0625;
    if (Math.abs(b) > 1e4) { a *= 1e-4; b *= 1e-4; c *= 1e-4; d *= 1e-4; e *= 1e-4; f *= 1e-4; g *= 1e-4; h *= 1e-4; p *= 1e-4; q *= 1e-4; r *= 1e-4; s *= 1e-4; t *= 1e-4; u *= 1e-4; v *= 1e-4; w *= 1e-4; }
  }
  return [a, b, c, d, e, f, g, h, p, q, r, s, t, u, v, w, Object.keys(o).length, list.length, map.size];
}
for (let k = 0; k < actions.length; k++) out.push(k + " " + run(400, actions[k], k % 2 ? new Deep() : new Bag(), [], new Map()).map((x) => x.toPrecision(12)).join(" "));
for (let k = 0; k < 6; k++) out.push("mixed " + run(500, (i, o, list, map) => { try { return actions[next() % actions.length](i, o, list, map); } catch { return 3; } }, new Deep(), [1.5], new Map()).map((x) => x.toPrecision(12)).join(" "));
out.push("in place " + inPlace(3000).map((x) => x.toPrecision(12)).join(" "));
for (const line of out) console.log(line);
