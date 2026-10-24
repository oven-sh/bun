const lines = [];
function once(label) {
  let count = 0;
  const state = { label, hits: [] };
  function bump(by) {
    count += by;
    state.hits.push(count);
    return state;
  }
  return bump;
}
const first = once("first");
first(1);
const trigger = { get again() { return once("by a getter")(10); }, valueOf() { return once("by valueOf")(20).hits[0]; }, toString() { return once("by toString")(30).label; }, toJSON() { return once("by toJSON")(40).hits; }, [Symbol.iterator]() { return once("by an iterator")(50).hits[Symbol.iterator](); }, then(resolve) { resolve(once("by then")(60).label); } };
lines.push(trigger.again.label, trigger.again.hits.join(), trigger + 1, `${trigger}`, JSON.stringify({ trigger }), [...trigger].join(), first(2).hits.join());
function setup() {
  const table = new Map();
  const list = [];
  let made = 0;
  return { add(key) { made++; table.set(key, made); list.push(key); return this; }, report() { return made + ":" + [...table].join("|") + ":" + list.join(); } };
}
const a = setup().add("x");
lines.push(a.report());
const again = [1, 2].map(() => setup().add("y").add("z").report());
lines.push(again.join(" "), a.add("w").report());
class Registry {
  static instances = 0;
  static last = null;
  items = [];
  constructor(name) { Registry.instances++; Registry.last = this; this.name = name; }
}
new Registry("one").items.push(1);
const makeRegistry = name => new Registry(name);
setTimeout(makeRegistry, 0, "from a timer");
queueMicrotask(() => makeRegistry("from a job").items.push(2, 3));
Promise.resolve(trigger).then(label => lines.push(label));
process.on("exit", () => { makeRegistry("at exit"); lines.push(Registry.instances + " " + Registry.last.name + " " + Registry.last.items.length); console.log(lines.join("\n")); });
function recursive(depth) {
  const local = { depth, below: null };
  if (depth > 0) local.below = recursive(depth - 1);
  return local;
}
lines.push(JSON.stringify(recursive(2)));
function* generated() { const own = { n: 0 }; for (;;) { own.n++; yield own; } }
const g1 = generated(), g2 = generated();
lines.push([g1.next().value.n, g1.next().value.n, g2.next().value.n, g1.next().value === g2.next().value].join());
