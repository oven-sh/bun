const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const other = { from: "other" };
class First { constructor(p) { this.__proto__ = p; this.t = 1; } }
class Last { constructor(p) { this.a = 1; this.b = 2; this.__proto__ = p; } }
class Only { constructor(p) { this.__proto__ = p; } }
function Old(p) { this.x = 1; this.__proto__ = p; this.y = 2; }
function run(o, p) { o.r1 = 1; o.__proto__ = p; o.r2 = 2; return o; }
function show(what, make) {
    let right = 0;
    for (let i = 0; i < 40; i++) { const o = make(); if (Object.getPrototypeOf(o) === other && !own(o, "__proto__") && o.from === "other") right++; }
    const o = make();
    console.log(what, right, Object.keys(o).join(), o.from);
}
show("first", () => new First(other));
show("last", () => new Last(other));
show("only", () => new Only(other));
show("function", () => new Old(other));
show("run", () => run({}, other));
// The accessor ignores a value that is neither an object nor null.
{ const o = new First(5); console.log("a number", Object.getPrototypeOf(o) === First.prototype, own(o, "__proto__"), o.t); }
{ const o = new First(null); console.log("null", Object.getPrototypeOf(o), Object.keys(o).join()); }
