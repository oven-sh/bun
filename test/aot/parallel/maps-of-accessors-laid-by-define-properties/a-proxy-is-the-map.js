const seed = Number(process.argv[2] ?? 3);
const seen = [];
const inner = { first: { get() { return seed; } } };
const map = new Proxy(inner, { ownKeys(o) { seen.push("keys"); return Reflect.ownKeys(o); }, getOwnPropertyDescriptor(o, k) { seen.push("own " + String(k)); return Reflect.getOwnPropertyDescriptor(o, k); }, get(o, k) { seen.push("get " + String(k)); o[k].get = function () { return "swapped"; }; return o[k]; } });
function T() {}
Object.defineProperties(T.prototype, map);
console.log(new T().first, inner.first.get(), seen.join());
