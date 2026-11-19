// iterators and generators by hand: lazy chains, closing, delegation, coroutines, walkers, asynchronous streams
'use strict';
class Seq {
  constructor(make) { this.make = make; }
  static of(...a) { return new Seq(() => a[Symbol.iterator]()); }
  static from(x) { return x instanceof Seq ? x : new Seq(() => x[Symbol.iterator]()); }
  static range(a, b = Infinity, step = 1) { return new Seq(function* () { for (let i = a; step > 0 ? i < b : i > b; i += step) yield i; }); }
  static iterate(x, f) { return new Seq(function* () { for (;;) { yield x; x = f(x); } }); }
  [Symbol.iterator]() { return this.make(); }
  map(f) { const s = this; return new Seq(function* () { let i = 0; for (const x of s) yield f(x, i++); }); }
  filter(f) { const s = this; return new Seq(function* () { for (const x of s) if (f(x)) yield x; }); }
  take(n) { const s = this; return new Seq(function* () { if (n <= 0) return; let k = n; for (const x of s) { yield x; if (--k === 0) return; } }); }
  skip(n) { const s = this; return new Seq(function* () { let k = n; for (const x of s) if (k-- <= 0) yield x; }); }
  while(f) { const s = this; return new Seq(function* () { for (const x of s) { if (!f(x)) break; yield x; } }); }
  flat(f = x => x) { const s = this; return new Seq(function* () { for (const x of s) yield* f(x); }); }
  zip(...os) { const all = [this, ...os]; return new Seq(function* () { const its = all.map(o => o[Symbol.iterator]()); try { for (;;) { const row = []; for (const it of its) { const r = it.next(); if (r.done) return; row.push(r.value); } yield row; } } finally { for (const it of its) if (it.return) it.return(); } }); }
  chunk(n) { const s = this; return new Seq(function* () { let c = []; for (const x of s) { c.push(x); if (c.length === n) { yield c; c = []; } } if (c.length) yield c; }); }
  window(n) { const s = this; return new Seq(function* () { const w = []; for (const x of s) { w.push(x); if (w.length > n) w.shift(); if (w.length === n) yield w.slice(); } }); }
  scan(f, a) { const s = this; return new Seq(function* () { for (const x of s) yield a = f(a, x); }); }
  share() { const it = this[Symbol.iterator](); return new Seq(() => ({ next: v => it.next(v), [Symbol.iterator]() { return this; } })); }
  reduce(f, a) { for (const x of this) a = f(a, x); return a; }
  array() { return [...this]; }
  first(d) { for (const x of this) return x; return d; }
}
function* permute(list, n = list.length) { if (n <= 1) yield list.slice(); else for (let i = 0; i < n; i++) { yield* permute(list, n - 1); const j = n % 2 ? 0 : i; [list[n - 1], list[j]] = [list[j], list[n - 1]]; } }
function* subsets(list, i = 0) { if (i === list.length) { yield []; return 1; } let n = 0; for (const s of subsets(list, i + 1)) { yield s; yield [list[i], ...s]; n += 2; } return n; }
function* walk(node, depth = 0) { const skip = yield { node, depth }; if (skip) return 1; let n = 1; for (const c of node.children || []) n += yield* walk(c, depth + 1); return n; }
class Scheduler { constructor() { this.tasks = []; this.log = []; this.now = 0; } spawn(name, gen, ...args) { this.tasks.push({ name, it: gen.apply(this, args), at: this.now, send: undefined }); return this; } run(limit = 200) { while (this.tasks.length && limit-- > 0) { this.tasks.sort((a, b) => a.at - b.at); const t = this.tasks.shift(); this.now = Math.max(this.now, t.at); let r; try { r = t.error ? t.it.throw(t.error) : t.it.next(t.send); } catch (e) { this.log.push(t.name + ' died ' + e.message); continue; } t.error = t.send = undefined; if (r.done) { this.log.push(t.name + ' done ' + r.value + ' @' + this.now); continue; } const v = r.value; if (typeof v === 'number') t.at = this.now + v; else if (v instanceof Error) { t.error = v; t.at = this.now; } else if (v && v.ask) { t.send = this.tasks.map(x => x.name).join(''); t.at = this.now; } else { this.log.push(t.name + ':' + v); t.at = this.now; } this.tasks.push(t); } return this.log; } }
async function* merge(...sources) { const its = sources.map(s => s[Symbol.asyncIterator] ? s[Symbol.asyncIterator]() : s[Symbol.iterator]()), pending = new Map(); const pull = i => pending.set(i, Promise.resolve(its[i].next()).then(r => ({ i, r }))); its.forEach((_, i) => pull(i)); try { while (pending.size) { const { i, r } = await Promise.race(pending.values()); if (r.done) pending.delete(i); else { pull(i); yield r.value; } } } finally { for (const it of its) if (it.return) await it.return(); } }
module.exports = { Seq, permute, subsets, walk, Scheduler, merge };
