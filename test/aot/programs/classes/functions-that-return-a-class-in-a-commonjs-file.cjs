// A CommonJS file: sloppy code around the function; the class body is strict all the same.
var lines = [];
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
class Base { who() { return "base"; } }
const Mix = function (Parent) { return class extends Parent { who() { return "mix>" + super.who(); } loose() { return attempt(() => { undeclaredName = 1; }); } self() { return (function () { return this === undefined; })(); } static args() { return arguments.length; } }; };
const Arrow = (Parent) => class extends Parent { #x = 2; get x() { return this.#x; } static has(o) { return #x in o; } };
const A = Mix(Base), B = Mix(Base); class C extends Mix(A) { } const D = Arrow(Base), E = Arrow(A);
lines.push([new A().who(), new B().who(), new C().who(), new A().loose(), new A().self(), A.args(1, 2), A === B, new C() instanceof A, new C() instanceof B].join());
lines.push([new D().x, new E().x, D.has(new E()), E.has(new E()), E.has(new D()), new E().who()].join());
module.exports = { Mix, Arrow };
const again = module.exports.Mix(Base), third = module.exports.Arrow(B);
lines.push([new again().who(), again === A, third.has(new third()), third.has(new D()), D.has(new third())].join());
with ({ Mix: (P) => class extends P { who() { return "shadowed"; } } }) { var S = Mix(Base); }
lines.push(new S().who());
var evaluated = eval("Mix(Base)"); lines.push(new evaluated().who(), String(evaluated === A));
console.log(lines.join("\n"));
