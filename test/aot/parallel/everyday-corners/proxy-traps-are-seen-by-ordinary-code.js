// Proxy traps are seen by ordinary code: compiled answers as plain.
const log = [];
const p = new Proxy(
  { a: 1 },
  {
    get(t, k, r) {
      log.push("get " + String(k));
      return Reflect.get(t, k, r);
    },
    has(t, k) {
      log.push("has " + String(k));
      return k in t;
    },
    ownKeys(t) {
      log.push("keys");
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      log.push("desc " + String(k));
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
    set(t, k, v, r) {
      log.push("set " + String(k));
      return Reflect.set(t, k, v, r);
    },
    deleteProperty(t, k) {
      log.push("delete " + String(k));
      return delete t[k];
    },
  },
);
function use(o) {
  o.b = o.a + 1;
  const c = { ...o };
  "a" in o;
  delete o.a;
  for (const k in o);
  return JSON.stringify([c, Object.keys(o)]);
}
console.log(use(p), log.join(";"));
console.log(use({ a: 1 }));
