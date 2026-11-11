// Every other row has another shape: the site misses in half of the turns.
// STATISTIC: SiteCachedReadsEmitted >= 1
"use strict";
const k = JSON.parse('"go"');
const V = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => (i & 1 ? '{"z":1,"a":' + i + ',"b":' + i / 2 + "}" : '{"a":' + i + ',"b":' + i / 2 + "}")).join() + "]");
const T = { go(r) { return r.a * 2 + r.b; } };
function f(t) { let c = 0; for (let i = 0; i < 64; i++) c += T[k](V[i]); return c + t % 2; }
const n = 40; let all = 0; for (let t = 0; t < n; t++) all = (all + f(t)) % 1000003; console.log(Math.floor(all));
