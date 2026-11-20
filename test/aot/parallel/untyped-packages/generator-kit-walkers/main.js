// An untyped package and a program of it (walkers): iterators and generators by hand: lazy chains, closing, delegation, coroutines, walkers, asynchronous streams
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const tree = (d, w) => ({ id: d + '.' + w, children: d ? Array.from({ length: w }, (_, i) => tree(d - 1, i)) : undefined }); const seen = []; const it = lib.walk(tree(3, 3)); let r = it.next(), steps = 0; while (!r.done && steps++ < 60) { seen.push(r.value.depth + ':' + r.value.node.id); r = it.next(r.value.node.id.endsWith('.1') && r.value.depth === 1); } say(seen.join(' '), r.value); say([...lib.permute([1, 2, 3, 4])].map(p => p.join('')).join(' ')); say([...lib.subsets('abcd'.split(''))].map(s => s.join('') || '-').join(' ')); const g = lib.subsets([1, 2]); let last; do { last = g.next(); say(JSON.stringify(last)); } while (!last.done); const early = lib.permute([1, 2, 3]); say(early.next().value.join(), JSON.stringify(early.return(9)), early.next().done);
for (let i = 0; i < 5; i++) { const s = new Set(); let n = 0; for (const p of lib.permute([...'abcde'.slice(0, i)])) { s.add(p.join('')); n++; if (n > 130) break; } say(i, n, s.size, [...s].pop()); }
