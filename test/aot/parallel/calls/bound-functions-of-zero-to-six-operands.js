// Functions bound to zero to six operands, by a callee that the compiler knows and by one that it does not: up to three operands lie in the bound function itself, more lie in a list beside it.
const say = (...values) => console.log(...values);
function sum(...values) { return [this === undefined ? "undefined" : this.tag, values.length, values.join("+")].join(" "); }
const receiver = { tag: "receiver" };
const operands = [1, 2, 3, 4, 5, 6];
const known = [sum.bind(), sum.bind(receiver), sum.bind(receiver, 1), sum.bind(receiver, 1, 2), sum.bind(receiver, 1, 2, 3), sum.bind(receiver, 1, 2, 3, 4), sum.bind(receiver, 1, 2, 3, 4, 5), sum.bind(receiver, 1, 2, 3, 4, 5, 6)];
for (const bound of known) say(bound("x"), bound.name, bound.length, typeof bound, Object.getPrototypeOf(bound) === Function.prototype, "prototype" in bound);
const unknown = globalThis[["Fun", "ction"].join("")].prototype[["bi", "nd"].join("")];
for (let count = 0; count <= 6; count++) { const bound = unknown.call(sum, receiver, ...operands.slice(0, count)); say(bound("y", "z"), bound.name, bound.length); }
function three(a, b, c) { return a + b + c; }
say(three.bind(null, 1, 2, 3, 4).length, three.bind(null, 1).length, three.bind(null, 1, 2, 3, 4)(), three.bind(null).bind(null, 1).bind(null, 2, 3, 4, 5)(), three.bind(null).bind(null).name);
class Point { constructor(x, y, z, w) { this.sum = x + y + z + w; } }
say(new (Point.bind(null, 1, 2, 3, 4))().sum, new (Point.bind(null, 1))(2, 3, 4) instanceof Point, new (Point.bind(null, 1, 2, 3, 4))() instanceof Point.bind(null, 1, 2, 3, 4));
const kept = { held: true }; const holder = sum.bind(kept, kept, kept, kept, kept); say(holder().length > 0);
let total = 0; for (let i = 0; i < 20000; i++) total += three.bind(null, i, 1, 2, 3)() + three.bind(null, i)(1, 2); say(total);
Object.defineProperty(three, "name", { value: "renamed" }); Object.defineProperty(three, "length", { value: 9 }); say(three.bind(null, 1, 2, 3, 4).name, three.bind(null, 1, 2, 3, 4).length);
for (const wrong of [() => unknown.call({}, 1, 2, 3, 4, 5), () => unknown.call(undefined), () => Function.prototype.bind.call(1)]) try { say(wrong()); } catch (e) { say(e.name, e.message); }
