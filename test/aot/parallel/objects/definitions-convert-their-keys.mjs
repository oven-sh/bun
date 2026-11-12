// Definitions by Object.defineProperty whose receiver is Object.defineProperties, under symbols, indexes, numbers and objects.
const printed = [];
const print = (...values) => printed.push(values.map(String).join(" "));
const log = [];
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
const make = () => new Proxy({}, { defineProperty(t, k, d) { log.push("define " + String(k)); return Reflect.defineProperty(t, k, d); }, getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); } });
const s = Symbol("s");
function show(o) { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join(); }
{
  const d = Object.defineProperty.bind(Object.defineProperties);
  const p = make();
  attempt(() => d(p, s, { value: 11, configurable: true, enumerable: true }));
  print(show(p), p[s]);
}
{
  const p = Object.freeze({});
  print(attempt(() => Object.defineProperty.call(Object.defineProperties, p, s, { value: 1 })), show(p));
}
{
  const p = make();
  attempt(() => Object.defineProperty.call(Object.defineProperties, p, "7", { value: 4, enumerable: true, configurable: true }));
  print(show(p), p[7]);
}
{
  print(attempt(() => Object.defineProperty.call(Object.defineProperties, 3, s, { value: 1 })), attempt(() => Object.defineProperty.call(Object.defineProperties, undefined, "7", { value: 1 })));
}
{
  const p = make();
  attempt(() => Object.defineProperty.call(Object.defineProperties, p, 7, { value: 5, enumerable: true, configurable: true }));
  print(show(p), p[7]);
}
{
  let n = 0;
  const key = { toString() { n++;
  return "k";
  } };
  const p = make();
  attempt(() => Object.defineProperty.call(Object.defineProperties, p, key, { value: 6, configurable: true, enumerable: true }));
  print(show(p), n);
}
{
  const p = make();
  attempt(() => Object.defineProperty.call(Object.defineProperties, p, s, { value: 1, enumerable: true, configurable: true }));
  print(show(p), p[s]);
}
{
  const p = make();
  attempt(() => Object.defineProperties(p, { 7: { value: 7, enumerable: true, configurable: true }, "08": { value: 8, configurable: true } }));
  print(show(p), p[7], p["08"]);
}
{
  const p = make();
  attempt(() => Object.defineProperties(p, { [s]: { value: 9, enumerable: true, configurable: true }, a: { value: 1, configurable: true } }));
  print(show(p), p[s]);
}
{
  const f = Object.defineProperties;
  attempt(() => { f.own = Object.defineProperty;
  });
  const p = make();
  log.push(String(attempt(() => f.own(p, s, { value: 2, configurable: true, enumerable: true }) === p)));
  print(show(p));
}
{
  const p = make();
  attempt(() => Reflect.apply(Object.defineProperty, Object.defineProperties, [p, s, { value: 3, configurable: true }]));
  print(show(p), String(p[s]));
}
print(log.join("|"));
console.log(printed.join("\n"));
