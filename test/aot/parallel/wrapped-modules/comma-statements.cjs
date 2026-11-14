// Statements that are lists of expressions, as minifiers write them.
var out = [], log = (...values) => (out.push(values.join(" ")), values[0]);
log("one"), log("two"), log("three");
(log("in parentheses"), log("again")), log("behind");
var a = 1; a++, a += 2, log(a), (a = a * 2, log(a));
"not a directive", log(typeof this, this === module.exports);
exports.first = 1, exports.second = () => exports.first, log(Object.keys(exports).join());
Object.defineProperty(exports, "third", { enumerable: true, get: () => a }), Object.defineProperty(exports, "__esModule", { value: true }), log(exports.third, exports.__esModule);
function throwing(where) {
  var steps = [];
  try { steps.push("a"), where === 1 && thrown(), steps.push("b"), where === 2 && thrown(), steps.push("c"); } catch (error) { steps.push(error.message), steps.push("caught"); } finally { steps.push("finally"), steps.push("end"); }
  return steps.join();
}
function thrown() { throw new Error("thrown"); }
for (var k = 0; k < 3; k++) log(throwing(k)), log(k), k === 1 && log("middle");
function* generator() { yield 1, yield 2, log("between"), yield* [3, 4], log("done"); }
log([...generator()].join());
function absent() { var before; before = "before", log(before), undeclared(), log("never"); }
try { absent(); } catch (error) { log(error.name); }
function later() { hoisted(), value = 5, log(value); var value; function hoisted() { log("hoisted", value); } }
later();
class Box { static { Box.count = 1, Box.count++, log(Box.count); } constructor() { this.x = 1, this.y = 2, log(Object.keys(this).join()); } }
new Box(), new Box;
class Derived extends Box { constructor() { super(), this.z = 3, log(this.z, Object.keys(this).join()); } }
new Derived();
switch (a) { case a: log("case"), a = 0; default: log("fell"), a--; }
label: { log("label"), a--; if (a < 0) break label; log("never"), log("never"); }
if (a) log("then"), log("then"); else log("else"), log("else");
do log("do"), a++; while (a < 0);
let { p, q = (log("default"), 7) } = { p: 1 }; p = [p, q], [q] = p, log(p.join(), q);
async function waits() { await null, log("waited"), log(await 8, await 9); try { await null, await Promise.reject(new Error("rejected")), log("never"); } catch (error) { log(error.message), log("after"); } }
waits().then(() => (log("end"), console.log(out.join("\n")), void 0));
log("last"), void 0;
