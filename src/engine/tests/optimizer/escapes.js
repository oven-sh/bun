// Objects that are made late, or by an exit, are as they would have been.

const opaque = f => new Proxy(f, {});
var kept;
var keep = opaque(value => void (kept = value));
var change = opaque(() => void (kept && (kept.x = "changed")));
var nothing = opaque(value => value);
var raise = opaque(value => {
  if (value === 7) throw value;
});
function Point(x, y) {
  this.x = x;
  this.y = y;
}
class Base {
  constructor(x) {
    this.x = x;
  }
}
class Derived extends Base {
  field = 1;
  constructor(x, y) {
    super(x);
    this.y = y;
  }
}
const few = () => [[0, 1], [1, 2], [7, 3], [0.5, 1], ["s", 1], [1, "s"], [null, 7], [2, {}]];

// On some ways only
check((a, b) => { const o = { x: a, y: b }; if (a === 7) return o; return o.x + o.y; }, few);
check((a, b) => { const o = new Point(a, b); kept = null; if (a === 7) keep(o); change(); return o.x; }, few);
check((a, b) => { const o = new Derived(a, b); nothing(); o.x += 1; nothing(); o.y += 1; return a === 1 ? o : o.x; }, few);
check((a, b) => { const o = { x: a }; if (b === 1) o.y = b; else o.z = b; nothing(); const sum = a + 1; return [sum, o]; }, few);
check((a, b) => { const inner = { x: a }, outer = { p: inner, q: inner }; nothing(); const n = b * 2; return [outer.p === outer.q, outer.q === inner, n]; }, few);
check((a, b) => { const o = { x: a }; o.a = o.b = o.c = o.d = o.e = o.f = b; nothing(); const n = a - 1; o.g = n; nothing(); return b * 2 === 4 ? o : o.e; }, few);
check((a, b) => { const inner = { x: a }; nothing(); const outer = { p: inner, q: { y: b } }; keep(outer); return kept; }, few);
check((a, b) => { const inner = { x: a }, to = nothing({}); to.a = to.b = to.c = to.d = to.e = to.f = 1; to.g = inner; return to; }, few);

// One object, however many refer to it
check((a, b) => { const o = { x: a }, same = o; nothing(); const n = a * b; same.x = n; return [o === same, o.x]; }, few);
check((a, b) => { const o = { x: a, self: null }; o.self = o; nothing(); const n = b + 1; keep(o); return [kept.self === kept, n]; }, few);
check((a, b) => { const p = { x: a, to: null }, q = { x: b, to: p }; p.to = q; nothing(); const n = a * 2; keep(p); return [kept.to.to === kept, kept.to === q, n]; }, few);
check((a, b) => { const o = { x: a }; const set = (to, v) => { nothing(); to.x = v * 2; return to; }; "use strict"; return [set(o, b) === o, o.x]; }, few);
check((a, b) => { const p = { x: a }, q = { x: b }; const one = a === 1 ? p : q; one.x = 5; return [p.x, q.x, one === p]; }, few);
check((a, b) => { const o = {}; return [o == a, o === b, o == null, !o, typeof o, o === o, o == o]; }, few);

// Where ways meet
check((a, b) => { const o = a === 1 ? { x: a, y: b } : { x: b, y: a }; nothing(); return o.x * 2 + o.y; }, few);
check((a, b) => { const step = i => (i > a ? { value: undefined, done: true } : { value: i * b, done: false }); let sum = 0; for (let i = 0, r; !(r = step(i)).done && i < 9; i++) sum += r.value; return sum; }, few);
check((a, b) => { let options = { x: a }; options = options || { y: 1 }; return options.x + b; }, few);
check((a, b) => { const o = { flag: false, x: a }; if (o.flag) keep(o); return o.x + b; }, few);
check((a, b) => { const o = a === 1 ? { x: { y: a } } : { x: { y: b } }; nothing(); return [o.x.y * 2, o.x === o.x]; }, few);

// Loops
check((a, b) => { const o = { x: 0, y: 0.5 }; for (let i = 0; i < 9; i++) { o.x += i === 5 ? a : 1; o.y *= 2; } return b === 3 ? o : o.x; }, few);
check((a, b) => { let v = new Point(0, 0); for (let i = 0; i < 9; i++) v = new Point(v.y + (i === 5 ? a : 1), v.x); return b === 3 ? v : v.x; }, few);
check((a, b) => { let p = { x: a }, q = { x: b }; for (let i = 0; i < 3; i++) { const t = p; p = q; q = t; p.x += 1; } return [p.x, q.x]; }, few);
check((a, b) => { const first = { x: a }; let last = first; for (let i = 0; i < 3; i++) { last.x += 1; last = { x: b }; } return [first.x, last.x]; }, few);
check((a, b) => { let p = { x: a }, q = { x: b }, seen = ""; for (let i = 0; i < 3; i++) { p.x += 1; seen += q.x; p = q = { x: i }; } return seen; }, few);
check((a, b) => { let list = null; for (let i = 0; i < 3; i++) list = { x: i * a, next: list }; return [list.next.x, b]; }, few);
check((a, b) => { const o = { x: 0 }; kept = null; for (let i = 0; i < 9; i++) { if (i === a) keep(o); change(); o.x += 1; } return o.x; }, few);
check((a, b) => { const o = { x: 0, to: { y: a } }; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { o.to.y += 1; if (j === b) o.to = { y: j }; } return o; }, few);
check((a, b) => { const o = { x: 0 }; for (let i = 0; i < 3; i++) { if (i === a) o.y = 1; o.x += b; } return o; }, few);
check((a, b) => { const o = { x: a }; for (let i = 0; i < 9; i++) { if (i === b) { keep(o); break; } o.x += 1; } return o.x; }, few);

// Closures and scopes
check((a, b) => { let n = a; const add = v => (n += v); add(1); nothing(); add(b); return n; }, few);
check((a, b) => { let n = a; const get = () => n; if (a === 7) return get; n += b; return get(); }, few);
check((a, b) => { const again = n => (n > 0 ? again(n - 1) : b); nothing(); const n = a * 2; return [again(1), n, typeof again]; }, few);
check((a, b) => { let sum = 0; [1, 2, 3].forEach(v => { sum += v === 2 ? a : b; }); return sum; }, few);
check((a, b) => { const make = v => () => v * 2; const f = a === 1 ? make(a) : make(b); nothing(); return f(); }, few);
check((a, b) => { const all = []; for (let i = 0; i < 3; i++) { const f = () => i * a; if (i === b) all.push(f); i += 0; } return all.map(f => f()); }, few);
check((a, b) => { const early = () => late; if (a === 7) return early(); let late = b; return early(); }, few);

// Exceptions
check((a, b) => { const o = { x: 0 }, same = o; try { o.x = 1; raise(a); o.x = 2; raise(b); o.x = 3; } catch { same.x += 10; } return o; }, few);
check((a, b) => { let n = 0; const up = v => { "use strict"; n++; raise(v); n++; }; try { up(a); up(b); } catch { return ["caught", n, typeof up]; } return n; }, few);
check((a, b) => { const o = { x: a, to: { y: b } }; try { return a.toFixed(0) + o.to.y; } catch { return o; } }, few);
check((a, b) => { const o = { x: 0 }; try { o.x = 1; if (a + "x" < b + "y") o.x = 2; raise(a); return o.x; } catch { return o; } }, few);

// Suspensions
check((a, b) => { function* g(p) { const list = [p, p], o = { x: p }; if (p < 0) nothing(); yield 1; yield list[0] + o.x; } return [...g(a), b]; }, few);
check((a, b) => { function* g(p, q = p ? 1 : 2) { yield () => p + q; } return [g(a).next().value(), b]; }, few);

{
  const result = class {}, callees = [async function () { return result; }, function () {}, opaque(function () {})];
  const run = (f, keeps) => { const o = { x: 1 }, r = f.call(o); return keeps ? nothing(o) : r; };
  for (let turn = 0; turn < 300; turn++) if (run(callees[turn % 3], true).x !== 1 || run(callees[1], false)) throw new Error("after a call with several ways");
}

// What can be found on the stack
var peek = function () {
  const caller = peek.caller;
  kept = [caller, caller && caller.arguments, new Error().stack.split("\n").slice(0, 4).map(it => it.split("@")[0])];
  for (const unused of []);
  return eval("0");
};
function sloppy(o) {
  peek();
  return o;
}
check((a, b) => { const o = { x: a }; sloppy(o); kept[1][0].x = b; return [o.x, kept[2]]; }, few);
check((a, b) => { const f = function named() { peek(); return a; }; f(); return [kept[0] === f, kept[2], b + 1]; }, few);
check((a, b) => { const f = function named() { "use strict"; peek(); return a; }; f(); return [kept[0], kept[2], b + 1]; }, few);
check((a, b) => { const o = { named: () => { "use strict"; peek(); } }; o.named(); return [kept[0], kept[2], a + b]; }, few);
check((a, b) => { [1].forEach(function each() { "use strict"; peek(); }); return [kept[0], kept[2], a + b]; }, few);
check(function outer(a, b) { a = { x: b }; peek(); kept[1][0].x = 5; return a.x; }, few);
