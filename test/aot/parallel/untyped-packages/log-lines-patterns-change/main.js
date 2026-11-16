// An untyped package and a program of it (patterns change): lines of logs read by patterns tried in turn over a window of a larger text; fields by position, rest kept
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const seen = []; for (let i = 0; i < 20; i++) { if (i === 4) lib.patterns.unshift({ kind: 'num', re: /^(\d+)(?:\.(\d+))?$/, fields: ['int', 'frac'] }); if (i === 9) lib.patterns[0].fields = ['whole', 'part']; if (i === 14) lib.patterns.shift(); const r = lib.all(['12.5', '7', '[INFO] 12', 'x=12 y=13', '1.2.3'].map(t => t.replace('2', i)).join('\n')); seen.push(r.map(x => x.kind[0]).join('')); say(i, JSON.stringify(r)); } say(seen.join());
