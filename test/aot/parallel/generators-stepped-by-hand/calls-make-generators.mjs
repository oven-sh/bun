// The call of a generator runs no code of the program: what it is handed and what it sees may change until its first step, and behind it.
const lines = [];
const show = v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
const say = (...words) => lines.length < 2000 && lines.push(words.map(show).join(" "));
let file = 0;
const list = JSON.parse("[3,1,4,1,5]");
function* reads(o, l, f) { yield o.n; yield l.length; yield f(); file += 10; yield file; }
function* writes(o, l) { o.n++; yield o.n; l.push(o.n); yield l; o.extra = l.length; yield o; }
function* keeps(o) { const held = o; yield held; held.n = -1; yield held; }
function* closes(n) { let k = n; const more = () => ++k; yield more(); yield more(); yield k; }
class Counter { constructor(n) { this.n = n; } *each(by) { this.n += by; yield this.n; this.n += by; yield this.n; } }
const kept = [];
function changed(x) { const o = { n: x }, l = [x]; let v = x; const it = reads(o, l, () => v + o.n); o.n = 7; l.push(1, 2); v = 100; const a = it.next().value, b = it.next().value; o.n = 1; return say(a, b, it.next().value, it.next().value, o, l); }
function written(x) { const o = { n: x }, l = []; const it = writes(o, l); const before = o.n; say(before, it.next().value, o.n, l.length); it.next(); say(l, o.n); it.next(); return say(o, l.length); }
function keptOn(x) { const o = { n: x }; const it = keeps(o); kept.push(it); o.n += 5; say(o.n); if (kept.length > 2) { const first = kept.shift(); const a = first.next().value; a.n++; say(a, first.next().value); } return o.n; }
function never(x) { const o = { n: x }; let t = 0; for (const y of list) { const unused = writes(o, list); o.n = y; t += o.n; } return say(t, o, list.length); }
function closed(x) { let n = x; const it = closes(n); n += 50; say(n, it.next().value, it.next().value); return it.next().value; }
function ofClass(x) { const c = new Counter(x); const it = c.each(2); c.n = 10; const a = it.next().value; c.n *= 2; return say(a, it.next().value, c); }
function passed(x) { const total = it => { let t = 0; for (const v of it) t += typeof v === "number" ? v : 1; return t; }; const o = { n: x }; const it = writes(o, []); o.n = 3; return say(total(it), o); }
function pattern(x) { const pair = ([a, b]) => show(a) + show(b); const o = { n: x }; const it = keeps(o); o.n = 2; return say(pair(it), o); }
function handled(x) { const o = { n: x }; try { const it = writes(o, null); o.n = 4; it.next(); say(o.n); it.next(); } catch (error) { say(error.name, o); } return o; }
function* around(x) { const o = { n: x }; const it = writes(o, [1]); yield o.n; o.n = 20; yield it.next().value; yield* keeps(o); }
for (let turn = 0; turn < 3; turn++) {
  for (const x of list) {
    for (const f of [changed, written, keptOn, never, closed, ofClass, passed, pattern, handled]) f(x + turn);
    for (const v of around(x)) say(v);
    say([...reads({ n: x }, list, () => file)]);
  }
}
for (const line of lines) console.log(line);
console.log(lines.length, file);
