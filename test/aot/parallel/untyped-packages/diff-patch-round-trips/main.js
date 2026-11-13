// An untyped package and a program of it (round trips): patches of text in unified form read by expressions, applied, reversed, merged; conflicts marked
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
let text = Array.from({ length: 14 }, (_, i) => 'line ' + i).join('\n'); let seed = 4; const r = n => (seed = seed * 48271 % 2147483647) % n; for (let i = 0; i < 16; i++) { const l = text.split('\n'); for (let k = 0; k < 1 + i % 4; k++) { const at = r(l.length); if (k % 3 === 0) l.splice(at, 1); else if (k % 3 === 1) l.splice(at, 0, 'new ' + i + '.' + k); else l[at] += '!'; } const next = l.join('\n'), hunks = lib.diff(text, next, i % 3), out = lib.print('f.txt', hunks), back = lib.parse(out), a = lib.apply(text, back[0] ? back[0].hunks : []), z = lib.apply(a.text, lib.reverse(back[0] ? back[0].hunks : [])); say(i, hunks.length, a.text === next, z.text === text, a.rejects.join(), z.rejects.join(), JSON.stringify(out)); const moved = lib.apply('top\n' + text, hunks); say(moved.rejects.join(), moved.text === 'top\n' + next); text = next; }
