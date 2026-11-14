// An untyped package and a program of it (words): a binary heap with updates by key
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const h = new lib((a, b) => a.priority.length < b.priority.length || a.priority.length === b.priority.length && a.priority < b.priority); const words = 'the quick brown fox jumps over the lazy dog and then some more words that are long enough to matter'.split(' ');
for (let round = 0; round < 9; round++) { words.forEach((w, i) => h.push(round ? w + round : w, round === 2 ? w.toUpperCase() : w, i * round)); const out = []; for (let i = 0; i < 12; i++) { const t = h.pop(); out.push(t.key + '/' + t.value); } say(round, out.join(' '), h.size, h.moves, h.check()); }
