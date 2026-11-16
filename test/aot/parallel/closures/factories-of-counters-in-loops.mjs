// Factories of several closures over one scope, called in loops of the file, of functions and of factories' callers: two instances, two names of one, branches, resets, breaks and throws, nested loops.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const out = [];
function counter(start) { let n = start, last = 0; const inc = x => { n += x; last = x; return n; }; const tick = () => { n++; }; const get = () => show(n) + "/" + show(last); const set = v => { n = v; }; return { inc, tick, get, set }; }
const a = counter(0), b = counter(0), c = a;
for (let k = 0; k < 100; k++) { a.tick(); if (k & 1) b.tick(); }
out.push(a.get(), b.get());
for (let k = 0; k < 50; k++) { a.inc(k & 3); c.tick(); if (k === 20) b.set(-0); }
out.push(a.get(), b.get());
function run(counter, turns) { for (let k = 0; k < turns; k++) counter.tick(); return counter.get(); }
out.push(run(a, 0), run(a, 1), run(b, 1000), run(counter(0.5), 9), run(counter(2 ** 53 - 3), 9));
function both(turns, stop) { for (let k = 0; k < turns; k++) { a.inc(k); b.inc(1); if (k === stop) a.set(7); if (k === stop + 2) break; } return a.get() + " " + b.get(); }
out.push(both(5, -1), both(30, 3));
function thrown(turns, stop) { const u = counter(1), w = counter(2); try { for (let k = 0; k < turns; k++) { u.tick(); if (k === stop) throw 0; w.inc(u.inc(1)); } } catch { } return u.get() + " " + w.get(); }
out.push(thrown(4, 9), thrown(9, 4));
function nested(turns) { const u = counter(0); for (let k = 0; k < turns; k++) { for (let i = 0; i < 3; i++) u.inc(i); u.tick(); } return u.get(); }
out.push(nested(0), nested(5));
const list = [a, b, counter(1)];
for (let k = 0; k < 30; k++) list[k % 3].tick();
out.push(list.map(each => each.get()).join(" "));
for (const each of list) for (let k = 0; k < 9; k++) each.inc(k);
out.push(list.map(each => each.get()).join(" "));
console.log(out.join());
