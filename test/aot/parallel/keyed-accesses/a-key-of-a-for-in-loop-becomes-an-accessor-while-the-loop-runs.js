// Each read o[k] stands between two reads of shared.n. A getter that runs at o[k] writes shared.n, so the second read must see it.
const shared = { n: 0 };
function walk(o, change) {
  const seen = [];
  for (const k in o) {
    change(o, k);
    const before = shared.n;
    const v = o[k];
    const after = shared.n;
    seen.push(k + "=" + v + ":" + (after - before));
  }
  return seen.join(" ");
}
const getter = name => ({ get() { shared.n += 1; return "got-" + name; }, enumerable: true, configurable: true });
class Point { constructor() { this.a = 1; this.b = 2; this.c = 3; } }
const makers = {
  literal: () => ({ a: 1, b: 2, c: 3 }),
  instance: () => new Point(),
  withExtra: () => { const o = new Point(); o.d = 4; o.e = 5; return o; },
  literalWithExtra: () => { const o = { a: 1, b: 2, c: 3 }; o["d" + ""] = 4; o.e = 5; return o; },
  parsed: () => JSON.parse('{"a":1,"b":2,"c":3}'),
  nullProto: () => Object.assign(Object.create(null), { a: 1, b: 2, c: 3 }),
  hadAccessor: () => ({ a: 1, get b() { shared.n += 1; return "got-b"; }, c: 3 }),
  inherited: () => Object.create({ get z() { shared.n += 1; return "got-z"; }, y: 9 }, { a: { value: 1, enumerable: true, writable: true, configurable: true } }),
};
const changes = {
  nothing: () => {},
  thisKey: (o, k) => { if (k === "b") Object.defineProperty(o, "b", getter("b")); },
  laterKey: (o, k) => { if (k === "a") Object.defineProperty(o, "c", getter("c")); },
  extraKey: (o, k) => { if (k === "a" && "e" in o) Object.defineProperty(o, "e", getter("e")); },
  everyKey: (o, k) => { Object.defineProperty(o, k, getter(k)); },
  deleted: (o, k) => { if (k === "a") { delete o.b; Object.getPrototypeOf(o) && 0; } },
  deletedThenInherited: (o, k) => { if (k === "a" && Object.getPrototypeOf(o) === Point.prototype) { delete o.b; Object.defineProperty(Point.prototype, "b", getter("proto-b")); } },
  frozen: (o, k) => { if (k === "a") Object.freeze(o); },
  protoSwapped: (o, k) => { if (k === "a") Object.setPrototypeOf(o, { get q() { shared.n += 1; return "q"; } }); },
};
for (let round = 0; round < 3; round++) {
  for (const m in makers) {
    for (const c in changes) {
      shared.n = 0;
      const line = walk(makers[m](), changes[c]);
      if (round === 2) console.log(m, c, "|", line, "| total", shared.n);
      delete Point.prototype.b;
    }
  }
}
