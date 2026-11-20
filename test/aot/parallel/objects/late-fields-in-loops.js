// Fields that another function fills, in loops that calculate with them: some objects are not filled, emptied, filled amid the loop, or hold something else.
"use strict";
const log = [];
class Node { constructor(i) { this.i = i; } init(i) { this.x = i; this.y = i * 0.5; return this; } }
class Above { get x() { return 0.5; } set x(v) { this.up = v; } }
class Below extends Above { init(i) { this.x = i; this.y = i; return this; } }
class Named { init(i) { if (i % 11) this.x = i; this.y = i; return this; } }
Named.prototype.x = 100;
function fill(o, i) { o.x = i; o.y = i + 1; o.seen = false; return o; }
function late(o, i) { if (i > 40) return late(o, i - 40); if (i !== 33) { o.x = i; o.y = 2.5; } return o; }
const makers = {
  filled: i => fill({}, i), methods: i => new Node(i).init(i), several: i => late(i & 1 ? {} : new Node(i), i), some: i => i % 7 === 3 ? {} : fill({ id: i }, i), below: i => new Below().init(i), named: i => new Named().init(i),
  kinds: i => fill({}, i === 41 ? "forty" : i), undefineds: i => { const o = fill({}, i); if (i === 22) o.y = undefined; return o; }, frozen: i => i % 6 ? fill({}, i) : Object.freeze({ z: 1 }),
  defined: i => { const o = fill({}, i); if (i % 12 === 4) Object.defineProperty(o, "x", { get: () => 0.25, configurable: true }); return o; }, linked: i => i % 12 === 4 ? Object.setPrototypeOf({ y: 1 }, { x: 7.5 }) : fill({}, i),
  proxied: i => i % 16 === 9 ? new Proxy(fill({}, i), { get: (t, k) => k === "x" ? 0.75 : t[k] }) : fill({}, i), numbers: i => fill({}, i % 6 ? i * 1e9 : NaN), zeros: i => fill({}, -0),
};
const loops = {
  sum(a) { let s = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; s = s + o.x + o.y; } return s; },
  or(a) { let s = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; s = (s + o.x + o.y) | 0; } return s; },
  products(a) { let s = 1; for (let i = 0; i < a.length; i++) s = s + a[i].x * a[i].y - a[i].x / 3 + a[i].y % 2; return s; },
  most(a) { let m = -1, c = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; if (o.x > m) { m = o.x; c++; } if (o.y <= 1) c += 100; } return m + " " + c; },
  stores(a) { let s = 0; const b = []; for (let i = 0; i < a.length; i++) { const o = a[i]; b.push(i); s += o.x + o.y; b.last = s; } return s + b.length + b.last; },
  fills(a) { let s = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; s = s + o.x; if (o.y === undefined) { try { o.y = 3; } catch { s += 1000; } } s = s + o.y; } return s; },
  empties(a) { let s = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; s = s + o.x + o.y; if (i % 10 === 3) { try { delete o.x; } catch { s += 1000; } } } return s; },
  nested(a) { let s = 0; for (let i = 0; i < 8; i++) for (let j = 0; j < a.length; j += 3) s = (s + a[j].x * i + a[(j + i) % a.length].y) % 100000; return s; },
  of(a) { let s = 0; for (const o of a) { s += o.x; s -= o.y; } return s; },
  caught(a) { let s = 0; for (let i = 0; i < a.length; i++) { try { const o = a[i]; s = s + o.x + o.y; if (s > 500 && i === 20) throw new Error("e"); } catch { s = s + 0.5; } } return s; },
};
const say = v => Object.is(v, -0) ? "-0" : String(v);
for (const [maker, make] of Object.entries(makers)) {
  for (const [name, loop] of Object.entries(loops)) {
    const all = []; for (let i = 0; i < 64; i++) all.push(make(i));
    const run = list => { try { return say(loop(list)); } catch (e) { return e.constructor.name; } };
    const line = [maker, name, run(all), run(all), run(all.slice(0, 5)), run([])];
    for (let j = 0; j < all.length; j += 9) { try { if (j % 2) delete all[j].x; else all[j].y = "text"; } catch (e) { line.push(e.constructor.name); } }
    line.push(run(all));
    for (let j = 0; j < all.length; j++) { try { all[j].x = j + 0.5; all[j].y = 1; } catch { } }
    line.push(run(all));
    log.push(line.join(" ").slice(0, 400));
  }
}
for (const line of log) console.log(line);
