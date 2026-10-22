// `Symbol()` in a loop or in a function makes another key each time, and all of them are written at one place in the program. What holds under one of these keys (a field that every object has, a plain value) does not hold under the next (nothing, an accessor that keeps `this`).
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag).join("+") || "nobody";
const makeKey = i => Symbol("key" + i);
const keys = [];
for (let i = 0; i < 4; i++) keys.push(makeKey(i));
const readUnder = (thing, key) => thing[key];
const storeUnder = (thing, key, value) => {
  thing[key] = value;
  return thing[key];
};
const above = {
  get [keys[2]]() {
    kept.push(this);
    return "getter above";
  },
  set [keys[2]](value) {
    kept.push(this);
  },
};
function make(tag) {
  const thing = { __proto__: tag.startsWith("below") ? above : Object.prototype, tag, [keys[0]]: "plain" };
  if (tag.endsWith("own"))
    Object.defineProperty(thing, keys[1], {
      get() {
        kept.push(this);
        return "own getter";
      },
      set(value) {
        kept.push(this);
      },
    });
  return thing;
}
const lines = [];
for (const tag of ["flat", "flat own", "below", "below own"]) {
  for (let i = 0; i < keys.length; i++) {
    lines.push(tag + " read " + i + " " + String(readUnder(make(tag), keys[i])));
    churn(20);
    lines.push(report());
    lines.push(tag + " store " + i + " " + String(storeUnder(make(tag), keys[i], "stored")));
    churn(20);
    lines.push(report());
  }
}
class Keyed {
  static key = makeKey(9);
  constructor(tag) {
    this.tag = tag;
    this[Keyed.key] = "field";
  }
}
lines.push(readUnder(new Keyed("keyed"), Keyed.key), String(readUnder(new Keyed("keyed"), keys[2])));
Object.defineProperty(Keyed.prototype, keys[3], Object.getOwnPropertyDescriptor(above, keys[2]));
lines.push(readUnder(new Keyed("keyed below"), keys[3]), readUnder(new Keyed("keyed"), Keyed.key));
churn(20);
lines.push(report());
console.log(lines.join("\n"));
