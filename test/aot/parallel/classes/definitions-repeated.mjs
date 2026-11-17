// The same definitions on many objects of one Structure, and on errors: the names are there already, or get there by the definition.
const KIND = Symbol.for("kind"), log = [];
const one = d => ("value" in d ? typeof d.value + (d.writable ? "w" : "-") : "accessor") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
const show = o => Reflect.ownKeys(o).filter(k => !/^(stack|line|column|sourceURL|original)/.test(String(k.description ?? k))).map(k => String(k) + ":" + one(Object.getOwnPropertyDescriptor(o, k))).join(" ");
class Node { constructor(type, n) { Object.defineProperty(this, KIND, { value: type }); this.n = n; } clone() { const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this)); return copy; } }
class Scalar extends Node { constructor(n) { super("scalar", n); this.value = n; } }
class Pair extends Node { constructor(n) { super("pair", n); Object.defineProperty(this, "key", { value: n, enumerable: true, configurable: true }); } }
class Located extends Error {
  constructor(message, nodes) {
    super(message);
    this.name = "Located"; this.nodes = nodes; this.positions = undefined;
    Object.defineProperties(this, { message: { writable: true, enumerable: true }, name: { enumerable: false }, nodes: { enumerable: false }, positions: { enumerable: false }, source: { enumerable: false, value: nodes?.length } });
  }
}
for (let turn = 0; turn < 3; turn++) {
  const rows = [];
  for (let n = 0; n < 40; n++) {
    const made = n % 3 === 0 ? new Scalar(n) : n % 3 === 1 ? new Pair(n) : new Node("node" + n, n);
    const error = new Located("m" + n, n % 2 ? [n] : undefined);
    if (n === 7 && turn === 1) { try { Object.defineProperty(made, KIND, { value: "again" }); } catch (e) { log.push(e.constructor.name); } }
    if (n === 9) Object.defineProperty(error, "message", { get() { return "got"; }, configurable: false });
    if (n === 11) { try { Object.defineProperty(Object.freeze(error), "late", { value: 1 }); } catch (e) { log.push(e.constructor.name); } }
    if (n % 13 === 0) rows.push(show(made) + " " + made[KIND] + " " + show(made.clone()) + " | " + show(error) + " " + error.message + " " + JSON.stringify(error) + " " + (typeof error.stack === "string"));
  }
  console.log(turn, rows.join("\n"), log.splice(0).join());
}
// The stack of an error is made by its own definition.
const own = new Located("s"); Object.defineProperty(own, "stack", { value: "mine", configurable: true }); console.log(own.stack, show(own));
const lined = new Error("l"); Object.defineProperty(lined, "line", { value: -1, writable: true, configurable: true, enumerable: true }); console.log(lined.line, Object.getOwnPropertyDescriptor(lined, "line").enumerable);
