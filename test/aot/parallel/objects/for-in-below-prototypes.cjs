// for-in over instances of constructor functions, whose prototypes are ordinary objects that change.
// COUNT: operationAOTGetPropertyEnumerator <= 4000
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.norm = function () { return this.x + this.y; };
function Leaf(x) { this.x = x; this.leaf = true; }
Leaf.prototype = Object.create(Point.prototype);
Object.defineProperty(Leaf.prototype, "constructor", { value: Leaf, enumerable: false, configurable: true, writable: true });
function Empty() {}
const names = object => { const list = []; for (const name in object) list.push(name); return list.join(); };
const own = object => { let list = ""; for (const name in object) if (Object.prototype.hasOwnProperty.call(object, name)) list += name + object[name]; return list; };
const copy = object => { const made = new object.constructor(); for (const name in object) if (Object.prototype.hasOwnProperty.call(object, name)) made[name] = object[name]; return made; };
for (let round = 0; round < 3000; ++round) {
    const point = new Point(round, 2), leaf = new Leaf(round);
    check("point", names(point), "x,y,norm");
    check("leaf", names(leaf), "x,leaf,norm");
    check("own", own(point), "x" + round + "y2");
    check("own of leaf", own(leaf), "x" + round + "leaftrue");
    check("copy", copy(point).norm(), round + 2);
    check("nothing", names(new Empty()), "");
}
const expect = (what, point, leaf, empty = "") => {
    for (let turn = 0; turn < 3; ++turn) {
        check("point " + what, names(new Point(1, 2)), point);
        check("leaf " + what, names(new Leaf(1)), leaf);
        check("empty " + what, names(new Empty()), empty);
    }
};
expect("at first", "x,y,norm", "x,leaf,norm");
Point.prototype.added = 1;
expect("with a name added", "x,y,norm,added", "x,leaf,norm,added");
Leaf.prototype.late = 1;
expect("with a name added between", "x,y,norm,added", "x,leaf,late,norm,added");
delete Point.prototype.norm;
expect("with a name removed", "x,y,added", "x,leaf,late,added");
Object.defineProperty(Point.prototype, "added", { enumerable: false });
expect("with a name hidden", "x,y", "x,leaf,late");
Object.defineProperty(Point.prototype, "added", { enumerable: true });
expect("with a name shown", "x,y,added", "x,leaf,late,added");
Object.defineProperty(Point.prototype, "got", { get() { return 1; }, enumerable: true, configurable: true });
expect("with an accessor", "x,y,added,got", "x,leaf,late,added,got");
Object.defineProperty(Leaf.prototype, "got", { value: 1, enumerable: false, configurable: true });
expect("with a name that hides one", "x,y,added,got", "x,leaf,late,added");
delete Leaf.prototype.got;
expect("with a name that hides none", "x,y,added,got", "x,leaf,late,added,got");
Leaf.prototype[0] = "element";
expect("with an element between", "x,y,added,got", "x,leaf,0,late,added,got");
Point.prototype[3] = 1.5;
expect("with an element", "x,y,3,added,got", "x,leaf,0,late,3,added,got");
Point.prototype[1] = "two";
expect("with two elements", "x,y,1,3,added,got", "x,leaf,0,late,1,3,added,got");
delete Point.prototype[1]; delete Point.prototype[3]; delete Leaf.prototype[0];
expect("without elements", "x,y,added,got", "x,leaf,late,added,got");
Empty.prototype[7] = null;
expect("with an element below nothing", "x,y,added,got", "x,leaf,late,added,got", "7");
Object.defineProperty(Empty.prototype, 8, { get() { return 1; }, enumerable: true });
expect("with an accessor under an index", "x,y,added,got", "x,leaf,late,added,got", "7,8");
Object.setPrototypeOf(Leaf.prototype, null);
expect("with no prototype above", "x,y,added,got", "x,leaf,late", "7,8");
Object.setPrototypeOf(Leaf.prototype, new Proxy({ far: 1 }, {}));
expect("with a proxy above", "x,y,added,got", "x,leaf,late,far", "7,8");
Object.setPrototypeOf(Leaf.prototype, [4, 5]);
expect("with a list above", "x,y,added,got", "x,leaf,late,0,1", "7,8");
Object.getPrototypeOf(Leaf.prototype).push(6);
expect("with a longer list above", "x,y,added,got", "x,leaf,late,0,1,2", "7,8");
Object.setPrototypeOf(Leaf.prototype, { literal: 1 });
expect("with a literal above", "x,y,added,got", "x,leaf,late,literal", "7,8");
Object.getPrototypeOf(Leaf.prototype).second = 2;
expect("with a longer literal above", "x,y,added,got", "x,leaf,late,literal,second", "7,8");
Object.setPrototypeOf(Leaf.prototype, Point.prototype);
for (let i = 0; i < 100; ++i) Point.prototype["many" + i] = i;
check("many names", names(new Point(1, 2)).length, names(new Leaf(1)).length - "leaf,late".length + 1);
for (let i = 0; i < 100; ++i) { delete Point.prototype["many" + i]; check("fewer names", names(new Point(1, 2)).split(",").length, 103 - i); }
expect("behind many names", "x,y,added,got", "x,leaf,late,added,got", "7,8");
Object.freeze(Point.prototype);
expect("frozen", "x,y,added,got", "x,leaf,late,added,got", "7,8");
if (globalThis.Bun) Bun.gc(true);
expect("behind a collection", "x,y,added,got", "x,leaf,late,added,got", "7,8");
// A prototype that changes while its instances are walked.
function Changing(n) { this.a = n; this.b = n; this.c = n; }
for (let round = 0; round < 200; ++round) {
    const list = [];
    for (const name in new Changing(round)) { list.push(name); if (name === "b") { Changing.prototype["p" + round] = 1; Changing.prototype[round % 5] = 1; } }
    check("names before the change", list.slice(0, 3).join(), "a,b,c");
    check("number of names", names(new Changing(round)).split(",").length, 3 + round + 1 + Math.min(round + 1, 5));
}
// An instance that loses names while it is walked.
for (let round = 0; round < 200; ++round) {
    const list = [], point = new Point(1, 2);
    for (const name in point) { list.push(name); if (round & 1) delete point.y; }
    check("names that are left", list.join(), round & 1 ? "x,added,got" : "x,y,added,got");
}
// Literals that gain names late, walked by a loop that knows other classes.
const literals = [{ a: 1, b: 2 }, { a: 1, b: 2, c: 3 }, new Point(1, 2), new Leaf(2), Object.assign(new Point(3, 4), { z: 5 })];
const sum = object => { let total = 0; for (const name in object) total += name.length; return total; };
const last = (object, stop) => { let found = ""; for (const name in object) { if (name === stop) break; found = name; object.grown = 1; } return found; };
for (let round = 0; round < 2000; ++round) { check("length of names", sum(literals[round % 5]), [2, 3, 10, 17, 11][round % 5]); check("last", last({ a: 1, b: 2, c: 3 }, round & 1 ? "c" : "z"), round & 1 ? "b" : "c"); }
console.log("ended", failures);
