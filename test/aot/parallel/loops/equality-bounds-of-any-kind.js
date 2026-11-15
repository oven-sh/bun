// Loops that test an equality, and do .. while, over arguments of which nothing is known: bounds that are integers, fractions, strings, objects with valueOf, undefined; lists, views, strings, records, proxies.
class Sub extends Array { }
const records = () => Array.from({ length: 20 }, (_, v) => ({ v, w: v * 2 }));
const holders = [() => [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8], () => [0.5, 1.5, 4, 2.25], () => [1, , 3, undefined, 5], () => ["a", "b", "c"], () => records(), () => [], () => "some text", () => new Uint8Array([7, 8, 9, 1, 2, 3]), () => new Float64Array([0.5, NaN, -0]), () => ({ length: 3, 0: 1, 1: 2, 2: 3 }), () => Sub.from([1, 2, 3]), () => new Proxy([1, 2, 3, 4], {}), () => null, () => 7];
const bounds = [0, 1, 4, 12, 20, 2.5, NaN, "3", { valueOf() { return 4; } }, undefined, null, -2, 2 ** 31, true];
const f = [
  function up(a, n) { let r = 0, t = 0; for (let k = 0; k !== n; k++) { if (++t > 25) break; r = r * 0.5 + (a[k] | 0); } return r + " " + t; },
  function upField(a, n) { let r = 0, t = 0; for (let k = 0; k !== n; k++) { if (++t > 25) break; r += a[k].v; } return r + " " + t; },
  function own(a) { let r = "", t = 0; for (let k = 0, l = a.length; k !== l; k++) { if (++t > 25) break; r += a[k]; } return r; },
  function ownField(a) { let r = 0; for (let k = 0, l = a.length; k != l; ++k) { r += a[k].w; if (r > 900) break; } return r; },
  function down(a, n) { let r = 0, t = 0; for (let k = n; k; k--) { if (++t > 25) break; r = r * 0.5 + (a[k - 1] | 0); } return r + " " + t; },
  function downTo(a, n) { let r = 0, t = 0, k = n; while (k !== 0) { if (++t > 25) break; k--; r += a[k] ? 1 : 2; } return r + " " + t + " " + k; },
  function store(a, n) { let t = 0; for (let k = 0; k !== n; k++) { if (++t > 25) break; a[k] = k & 3; } return t + " " + (a.join ? a.join() : a); },
  function chars(a, n) { let r = 0, t = 0; for (let k = 0; k !== n; k++) { if (++t > 25) break; r = (r * 3 + a.charCodeAt(k)) | 0; } return r + " " + t; },
  function doUp(a, n) { let r = 0, t = 0, k = 0; do { if (++t > 25) break; r = r * 0.5 + (a[k] | 0); } while (++k < n); return r + " " + k; },
  function doUpField(a, n) { let r = 0, t = 0, k = 0; do { if (++t > 25) break; r += a[k].v; } while (++k < n); return r + " " + k; },
  function doDown(a, n) { let r = 0, t = 0, k = n; do { if (++t > 25) break; r = r * 0.5 + (a[k] | 0); } while (--k); return r + " " + k; },
  function doStore(a, n) { let t = 0, k = 0; do { if (++t > 25) break; a[k] = k & 3; } while (++k !== n); return t + " " + (a.join ? a.join() : a); },
  function doSwitch(a, n) { let r = 0, t = 0, k = 0; do { if (++t > 25) break; switch (a[k]) { case 1: r += 10; break; case 5: r += 100; break; default: r += 1; } if (k % 3 === 2) continue; r += a[k] === 9 ? 3 : 0; } while (++k < n); return r + " " + k; },
];
for (let turn = 0; turn < 12; turn++) {
  const lines = [];
  for (const g of f) for (const make of holders) for (const n of bounds) {
    let got; try { got = g(make(), n); } catch (e) { got = e.name; }
    lines.push(g.name + " " + String(got));
  }
  if (turn === 0 || turn === 11) console.log(lines.join("\n"));
}
