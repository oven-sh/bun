'use strict';
const rows = JSON.parse('[{"a":null},{"a":3},{"a":-0.5},{"a":0}]'), k = JSON.parse('"go"'), half = JSON.parse('"half"'), back = JSON.parse('"back"');
const T = { go(x, y) { return x * y; }, half(t, x) { const s = t * 0.5 + 1; return s * x; }, back(t, x) { const s = t * 0.5 + 1; return x * s; } };
const n = Number(process.argv[2] ?? 3);
const text = value => Object.is(value, -0) ? '-0' : typeof value + ' ' + String(value);
const out = [];
for (let t = 0; t < n; t++) for (const row of rows) { const x = row.a; out.push(text(T[k](x, t)), text(T[k](t, x)), text(T[k](x, x)), text(T[half](t, x)), text(T[back](t, x))); }
console.log(out.join('\n'));
