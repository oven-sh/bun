// The functions of node:util's inspect that take own property descriptors apart, and Iterator.zipKeyed: what they print is what plain Bun prints.
// Flags: --aot-check=verify-each-pass
const util = require("node:util");
class Base { get size() { return 3; } set size(v) {} plain() {} }
Base.prototype.shared = 7; Base.prototype.list = [1, 2];
class Middle extends Base { get own() { return "own"; } }
Middle.prototype.tag = "middle";
class Leaf extends Middle { constructor() { super(); this.field = 1; } }
function Old() { this.a = 1; } Old.prototype.kept = { deep: true }; Object.defineProperty(Old.prototype, "hidden", { value: 5, enumerable: false });
const bare = Object.create(null); bare.x = 1;
const belowBare = Object.create(bare); belowBare.y = 2;
const noConstructor = Object.create({ inherited: 1 });
const accessorConstructor = Object.create(Object.defineProperty({}, "constructor", { get() { return Leaf; }, configurable: true }));
const oddConstructor = Object.create({ constructor: 5 });
const emptyNamed = Object.create({ constructor: function () {} });
const values = [new Leaf(), new Middle(), new Base(), new Old(), bare, belowBare, noConstructor, accessorConstructor, oddConstructor, emptyNamed, new (class extends Map {})(), new (class extends Array {})(2), Object.create(new Leaf()), new Proxy(new Leaf(), {}), function named() {}, class K { static s = 1; }, Symbol.prototype, new Date(0), /x/g];
for (let round = 0; round < 3; round++)
  for (const v of values)
    for (const options of [{}, { showHidden: true }, { showHidden: true, getters: true }, { showHidden: true, depth: 0 }, { showProxy: true }]) {
      let text; try { text = util.inspect(v, options); } catch (e) { text = "throws " + e.constructor.name; }
      if (round === 2) console.log(text.replace(/\n\s+at .*/g, ""));
    }
class WithText { toString() { return "text of mine"; } } class Heir extends WithText {} class ErrorHeir extends Error { toString() { return "error text"; } }
for (const v of [new WithText(), new Heir(), new ErrorHeir("x"), { toString() { return "own"; } }, Object.create(null), new Proxy({}, {}), new Date(0), new Leaf(), [1], new (class extends Date {})(0), Object.create({ toString: 5 })]) console.log(util.format("%s|%s", v, 1).replace(/\n\s+at .*/g, ""));
if (typeof Iterator.zipKeyed === "function") {
  const source = { a: [1, 2, 3], b: ["x", "y"], get c() { return [7, 8, 9].values(); } }; Object.defineProperty(source, "hidden", { value: [0], enumerable: false }); source[Symbol.for("s")] = [4, 5];
  for (const mode of ["shortest", "longest"]) console.log(JSON.stringify([...Iterator.zipKeyed(source, { mode })]), [...Iterator.zipKeyed(source, { mode })].map(r => String(r[Symbol.for("s")])).join());
  console.log(JSON.stringify([...Iterator.zipKeyed({ a: [1], b: [2, 3] }, { mode: "longest", padding: { a: "pad", get b() { return "never"; } } })]));
  try { [...Iterator.zipKeyed({ a: [1], b: [2, 3] }, { mode: "strict" })]; } catch (e) { console.log(e.constructor.name); }
}
