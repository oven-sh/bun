// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
function collectKeys(o) {
  const keys = [];
  for (const k in o) keys.push(k);
  return keys;
}
function testOwnKeys(o) {
  const seen = [];
  for (const k in o) seen.push(o.hasOwnProperty(k));
  return seen;
}
function walk(o, change) {
  const seen = [];
  for (const k in o) {
    change(o, k);
    seen.push([k, o[k], k in o, Object.hasOwn(o, k), Object.prototype.hasOwnProperty.call(o, k)]);
  }
  return seen;
}
function findNextKey(o, k) {
  const keys = [...new Set([...Object.keys(o), ...Object.keys(Object.getPrototypeOf(o))])];
  return keys[keys.indexOf(k) + 1];
}
function redefineNextKey(o, k, descriptor) {
  const next = findNextKey(o, k);
  if (next !== undefined) Object.defineProperty(o, next, { ...descriptor, configurable: true });
}
class Letters {
  constructor() {
    this.a = 1;
    this.b = 2;
    this.c = 3;
    this.d = 4;
  }
}
const subjects = {
  "literal": () => ({ a: 1, b: 2, c: 3, d: 4 }),
  "instance": () => new Letters(),
  "inherited keys": () => Object.assign(Object.create({ p: 5, q: 6 }), { a: 1, b: 2 }),
  "array": () => ["w", "x", "y", "z"],
  "proxy": () => new Proxy({ a: 1, b: 2, c: 3, d: 4 }, {}),
};
const changes = {
  "no change": () => {},
  "next key deleted": (o, k) => {
    delete o[findNextKey(o, k)];
  },
  "z added": o => {
    o.z = 26;
  },
  "next key becomes a getter": (o, k) => redefineNextKey(o, k, { get: () => "getter", enumerable: true }),
  "next key becomes non-enumerable": (o, k) => redefineNextKey(o, k, { enumerable: false }),
};
for (const [subject, create] of Object.entries(subjects))
  for (const [how, change] of Object.entries(changes)) report(subject + ", " + how, () => walk(create(), change));
for (const value of ["ab", 5, null, undefined]) {
  report("keys of " + show(value), () => collectKeys(value));
  report("walk over " + show(value), () => walk(value, changes["no change"]));
}
report("no hasOwnProperty", () => testOwnKeys(Object.create(null, { a: { value: 1, enumerable: true } })));
report("inherited hasOwnProperty", () => testOwnKeys({ a: 1, b: 2 }));
report("own hasOwnProperty", () => testOwnKeys({ a: 1, hasOwnProperty: () => "own" }));
