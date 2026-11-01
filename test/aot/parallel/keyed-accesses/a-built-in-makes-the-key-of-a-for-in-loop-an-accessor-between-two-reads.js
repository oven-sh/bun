// Two reads of o[k] in one turn, and between them a built-in, called by its own name, that makes the key an accessor. The second read runs the getter, which writes shared.n.
const shared = { n: 0 };
const getterOf = name => function () { shared.n += 1; return "got-" + name; };
function byDefineProperty(o) {
  const seen = [];
  for (const k in o) {
    const first = o[k];
    Object.defineProperty(o, k, { get: getterOf(k), enumerable: true, configurable: true });
    const before = shared.n; const second = o[k]; const after = shared.n;
    seen.push(k + "=" + first + ">" + second + ":" + (after - before));
  }
  return seen.join(" ");
}
function byReflect(o) {
  const seen = [];
  for (const k in o) {
    const first = o[k];
    Reflect.defineProperty(o, k, { get: getterOf(k), enumerable: true, configurable: true });
    const before = shared.n; const second = o[k]; const after = shared.n;
    seen.push(k + "=" + first + ">" + second + ":" + (after - before));
  }
  return seen.join(" ");
}
function byDefineGetter(o) {
  const seen = [];
  for (const k in o) {
    const first = o[k];
    Object.prototype.__defineGetter__.call(o, k, getterOf(k));
    const before = shared.n; const second = o[k]; const after = shared.n;
    seen.push(k + "=" + first + ">" + second + ":" + (after - before));
  }
  return seen.join(" ");
}
function byDefineProperties(o) {
  const seen = [];
  for (const k in o) {
    const first = o[k];
    Object.defineProperties(o, { [k]: { get: getterOf(k), enumerable: true, configurable: true } });
    const before = shared.n; const second = o[k]; const after = shared.n;
    seen.push(k + "=" + first + ">" + second + ":" + (after - before));
  }
  return seen.join(" ");
}
function byDeleteOverInherited(o) {
  const seen = [];
  for (const k in o) {
    const first = o[k];
    delete o[k];
    const before = shared.n; const second = o[k]; const after = shared.n;
    seen.push(k + "=" + first + ">" + second + ":" + (after - before));
  }
  return seen.join(" ");
}
function byStoreAlone(o) {
  const seen = [];
  for (const k in o) {
    const first = o[k];
    o[k] = first + 10;
    const before = shared.n; const second = o[k]; const after = shared.n;
    seen.push(k + "=" + first + ">" + second + ":" + (after - before));
  }
  return seen.join(" ");
}
class Point { constructor() { this.a = 1; this.b = 2; this.c = 3; } }
class Heir extends Point { get a() { shared.n += 1; return "heir-a"; } set a(v) { Object.defineProperty(this, "a", { value: v, writable: true, enumerable: true, configurable: true }); } }
const makers = {
  literal: () => ({ a: 1, b: 2, c: 3 }),
  instance: () => new Point(),
  heir: () => new Heir(),
  withExtra: () => { const o = new Point(); o.d = 4; o.e = 5; return o; },
  parsed: () => JSON.parse('{"a":1,"b":2,"c":3}'),
  nullProto: () => Object.assign(Object.create(null), { a: 1, b: 2, c: 3 }),
  overGetters: () => { const own = value => ({ value, writable: true, enumerable: true, configurable: true }); return Object.create({ get a() { shared.n += 1; return "under-a"; }, get b() { shared.n += 1; return "under-b"; } }, { a: own(1), b: own(2), c: own(3) }); },
};
const walks = { byDefineProperty, byReflect, byDefineGetter, byDefineProperties, byDeleteOverInherited, byStoreAlone };
for (let round = 0; round < 3; round++)
  for (const m in makers)
    for (const w in walks) {
      shared.n = 0;
      const line = walks[w](makers[m]());
      if (round === 2) console.log(m, w, "|", line, "| total", shared.n);
    }
