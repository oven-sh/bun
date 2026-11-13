// Objects that hold toString and valueOf themselves become keys, strings and numbers. Some hold an accessor, no function, or another one later.
let calls = 0;
const symbol = Symbol("s");
const makers = [
  () => ({ toString: () => "name" }),
  () => ({ toString() { calls++; return this.part; }, part: "other" }),
  () => ({ get toString() { calls++; return () => "name"; } }),
  () => ({ valueOf: () => 7, toString: () => "other" }),
  () => ({ valueOf() { calls++; return 2; } }),
  () => ({ toString: () => ({}), valueOf: () => "name" }),
  () => ({ toString: () => ({}), valueOf: () => ({}) }),
  () => ({ toString: null, valueOf: () => "name" }),
  () => ({ toString: 5 }),
  () => ({ toString() { calls++; throw new RangeError("no"); } }),
  () => ({ toString: () => symbol, valueOf: () => 3 }),
  () => ({ toString: (() => "name").bind(null) }),
  () => ({ toString: class {} }),
  () => ({ [Symbol.toPrimitive]: hint => (hint === "string" ? "name" : 4), toString: () => "other" }),
  () => Object.freeze({ toString: () => "name", valueOf: () => 1 }),
];
const show = x => (typeof x === "symbol" ? "sym" : typeof x === "object" && x ? "object" : String(x));
const uses = [
  (target, key) => target[key], (target, key) => Reflect.get(target, key), (target, key) => key in target, (target, key) => Reflect.has(target, key),
  (target, key) => Reflect.set(target, key, 5), (target, key) => (target[key] = 6), (target, key) => delete target[key], (target, key) => Reflect.deleteProperty(target, key),
  (target, key) => `${key}`, (target, key) => key + "!", (target, key) => key + 1, (target, key) => key * 2, (target, key) => key < 5, (target, key) => key == "name", (target, key) => +key,
];
for (const make of makers) {
  const log = [];
  for (const use of uses) {
    const key = make();
    for (let k = 0; k < 3; k++) {
      const target = { name: 1, other: 2, 7: 8, [symbol]: 9 };
      try { log.push(show(use(target, key))); } catch (error) { log.push(error.constructor.name); }
      if (k === 1) try { key.toString = () => "other"; key.valueOf = () => 11; } catch { }
    }
  }
  console.log(log.join(), calls);
}
