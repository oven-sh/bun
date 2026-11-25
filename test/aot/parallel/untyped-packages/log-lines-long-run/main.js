// An untyped package and a program of it (long run): lines of logs read by patterns tried in turn over a window of a larger text; fields by position, rest kept
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
let text = ''; for (let i = 0; i < 400; i++) text += ['[WARN]{n=' + i + '} value ' + i * i, 'k' + i + '=' + i + ' z="q ' + i + '"', '<' + i % 190 + '>Nov 1 0:0:' + i + ' h a: t' + i, '10.0.0.' + i % 255 + ' - u' + i + ' [t] "PUT /p/' + i + ' H" ' + (200 + i % 300) + ' ' + i * 10][i % 4] + '\n';
const sums = {}; let n = 0; for (const r of new lib.Reader(text)) { const s = sums[r.kind] ??= { n: 0, t: 0, keys: new Set() }; s.n++; for (const k in r) { s.keys.add(k); if (typeof r[k] === 'number') s.t += r[k]; else if (typeof r[k] === 'string') s.t += r[k].length; } if (n++ % 57 === 0) say(JSON.stringify(r)); }
for (const k in sums) say(k, sums[k].n, sums[k].t, [...sums[k].keys].join()); say(lib.all(text.slice(100, 400)).map(r => r.kind + r.line).join());
