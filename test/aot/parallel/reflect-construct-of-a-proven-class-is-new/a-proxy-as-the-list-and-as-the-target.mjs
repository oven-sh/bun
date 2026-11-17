class P { constructor(x) { this.x = x; } }
const log = [];
const list = new Proxy([7], { get(t, k, r) { log.push(String(k)); return Reflect.get(t, k, r); } });
const target = new Proxy(P, { construct(t, a, n) { log.push("construct " + a.length); return Reflect.construct(t, a, n); } });
console.log(Reflect.construct(P, list).x, Reflect.construct(target, [8]).x, log.join());
