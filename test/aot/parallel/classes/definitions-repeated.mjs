// The same definitions on many objects of one Structure, and on errors: the names are there already, or get there by the definition.
const KIND = Symbol.for("kind"), log = [];
const one = d => ("value" in d ? typeof d.value + (d.writable ? "w" : "-") : "accessor") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
const show = o => Reflect.ownKeys(o).filter(k => !/^(stack|line|column|sourceURL|original)/.test(String(k.description ?? k))).map(k => String(k) + ":" + one(Object.getOwnPropertyDescriptor(o, k))).join(" ");
class Parcel { constructor(sort, n) { this.n = n; Object.defineProperty(this, KIND, { enumerable: false, value: sort }); } twin() { const made = Object.setPrototypeOf({}, Object.getPrototypeOf(this)); for (const name of Reflect.ownKeys(this)) Object.defineProperty(made, name, Object.getOwnPropertyDescriptor(this, name)); return made; } }
class Letter extends Parcel { constructor(n) { super("letter", n); this.stamps = n; } }
class Crate extends Parcel { constructor(n) { super("crate", n); Object.defineProperty(this, "boards", { configurable: true, enumerable: true, value: n }); } }
class Misrouted extends Error {
  constructor(message, stops) {
    super(message);
    this.weights = undefined; this.stops = stops; this.name = "Misrouted";
    Object.defineProperties(this, { count: { value: stops?.length, enumerable: false }, weights: { enumerable: false }, stops: { enumerable: false }, name: { enumerable: false }, message: { enumerable: true } });
  }
}
for (let turn = 0; turn < 3; turn++) {
  const rows = [];
  for (let n = 0; n < 40; n++) {
    const made = n % 3 === 0 ? new Letter(n) : n % 3 === 1 ? new Crate(n) : new Parcel("parcel" + n, n);
    const error = new Misrouted("m" + n, n % 2 ? [n] : undefined);
    if (n === 7 && turn === 1) { try { Object.defineProperty(made, KIND, { value: "again" }); } catch (e) { log.push(e.constructor.name); } }
    if (n === 9) Object.defineProperty(error, "message", { get() { return "got"; }, configurable: false });
    if (n === 11) { try { Object.defineProperty(Object.freeze(error), "late", { value: 1 }); } catch (e) { log.push(e.constructor.name); } }
    if (n % 13 === 0) rows.push(show(made) + " " + made[KIND] + " " + show(made.twin()) + " | " + show(error) + " " + error.message + " " + JSON.stringify(error) + " " + (typeof error.stack === "string"));
  }
  console.log(turn, rows.join("\n"), log.splice(0).join());
}
// The stack of an error is made by its own definition.
const own = new Misrouted("s"); Object.defineProperty(own, "stack", { value: "mine", configurable: true }); console.log(own.stack, show(own));
const lined = new Error("l"); Object.defineProperty(lined, "line", { value: -1, writable: true, configurable: true, enumerable: true }); console.log(lined.line, Object.getOwnPropertyDescriptor(lined, "line").enumerable);
