// What a minifier writes: names that clash where the source has none, below one function around the file.
const say = (...all) => console.log(...all);
(() => {
  const t = new Map(); t.set("a", 1);
  function e(e) { return class extends e { count() { return t.size; } add(e) { return t.set(e, t.size), t.size; } }; }
  const n = e => class extends e { last() { return [...t.keys()].pop(); } };
  const r = class t extends (e(Object)) { static create() { return new t(); } };
  const o = e(Array), a = class t extends (n(Object)) { static own() { return t.name; } }, c = n(Set), i = (t => e(t))(Map), s = ((t, e) => n(e))(0, WeakMap);
  say(r.create().count(), new o().count(), new i().count(), r.create().add("b"), new o().add("c"), new i().add("d"));
  say(new a().last(), new c().last(), new s().last(), a.own(), r.name, Object.getPrototypeOf(i).name, t.size);
})();
(function () {
  let t = { n: 1 };
  const e = { e(e) { return class extends e { next() { return t.n++; } }; } };
  class r extends e.e(Object) { static r = t => new r().next() + t.n; }
  const o = (t => e.e(t))(Array), n = (({ t }) => e.e(t))({ t: Map }), i = (([t]) => e.e(t))([Set]), a = ((...t) => e.e(t[0]))(Date);
  say(new r().next(), new o().next(), new n().next(), new i().next(), new a().next(), r.r({ n: 100 }), t.n);
  t = { n: 50 };
  say(new r().next(), new o().next(), new n().next(), new i().next(), new a().next(), t.n);
})();
export {};
