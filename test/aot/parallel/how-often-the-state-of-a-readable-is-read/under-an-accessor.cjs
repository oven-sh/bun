const { Readable, Duplex, Transform } = require("node:stream");
for (const [label, make] of [["Readable", () => new Readable({ read() {} })], ["Duplex", () => new Duplex({ read() {}, write() {} })], ["Transform", () => new Transform()], ["an heir", () => new (class Heir extends Readable { _read() {} })()]]) {
  const made = make(), state = made._readableState;
  let runs = 0;
  Object.defineProperty(made, "_readableState", { configurable: true, get() { runs++; return state; } });
  const told = [];
  const step = (name, work) => { const before = runs; work(); told.push(name + " " + (runs - before)); };
  const listener = () => {};
  step("on close", () => made.on("close", listener));
  step("on data-like", () => made.on("drop", listener));
  step("on readable-like", () => made.on("eightlet", listener));
  step("on symbol", () => made.on(Symbol.for("made-up"), listener));
  step("removeListener close", () => made.removeListener("close", listener));
  step("off drop", () => made.off("drop", listener));
  step("destroyed", () => made.destroyed);
  step("readableEnded", () => made.readableEnded);
  step("closed", () => made.closed);
  step("errored", () => made.errored);
  console.log(label + ": " + told.join(" . ") + " . in all " + runs);
}
const lazy = new Readable({ read() {} }), kept = lazy._readableState;
let made = "not made";
Object.defineProperty(lazy, "_readableState", { configurable: true, get() { made = "made"; return kept; } });
lazy.on("close", () => {});
console.log("a lazy state behind on(\"close\"): " + made);
