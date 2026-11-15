let touched = 0;
function listed(source) {
  const rows = Object.entries(source);
  touched = (touched + rows.length) | 0;
  const parts = [];
  for (const [key, value] of rows) parts.push(key + "=" + String(value));
  return parts.join(";");
}
function tried(source) {
  try { return listed(source); } catch (error) { return "!" + error.name; }
}
const log = [];
const veiled = new Proxy({ p: 1, q: 2 }, {
  ownKeys(target) { log.push("keys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { log.push("desc " + key); return Reflect.getOwnPropertyDescriptor(target, key); },
  get(target, key) { log.push("get " + key); return target[key]; },
});
const shifty = { first: 1, get second() { delete this.third; this.fourth = 4; return 2; }, third: 3 };
const broken = { a: 1, get b() { throw new RangeError("no"); }, c: 3 };
class Crate { lid = 1; #seal = 2; get size() { return 9 + this.#seal; } }
const hidden = Object.defineProperty({ shown: 1, [Symbol("s")]: 2 }, "veil", { value: 3, enumerable: false });
const many = {};
for (let i = 0; i < 60000; i++) many["k" + i] = i;
console.log(tried(JSON.parse('{"b":1,"a":2,"2":3,"1":4}')));
console.log(tried(JSON.parse('{"__proto__":5,"z":6}')));
console.log(tried(veiled), log.join(","));
console.log(tried(shifty), tried(shifty));
console.log(tried(broken));
console.log(tried(new Crate()), tried(hidden));
console.log(tried(Object.assign(Object.create(null), { n: 1 })), tried(Object.assign(Object.create({ above: 1 }), { own: 2 })));
console.log(tried(Object.assign(function named() {}, { tag: 1 })), tried(Object.freeze({ f: 1 })));
console.log(tried(["x", , "z"]), tried("hi"), tried(new Uint8Array([7, 8])), "[" + tried(new Map([["m", 1]])) + "]");
console.log(tried(null), tried(undefined), "[" + tried(42) + "]", "[" + tried(true) + "]");
console.log(listed(many).length);
