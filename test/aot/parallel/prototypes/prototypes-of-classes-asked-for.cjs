// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 2
// Whoever walks up from a class or from its prototype opens neither: each step finds what is written above.
"use strict";
class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }
}
class Deep extends Point {
    depth() {
        return this.x;
    }
}
class Kept {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Kept(this.x + other.x, this.y + other.y);
    }
}
class KeptBelow extends Kept {
    below() {
        return this.y;
    }
}
class Fault extends Error {}
class Table extends Map {
    total() {
        return this.size;
    }
}
const out = [];
const nameOf = value => value === null ? "null" : typeof value === "function" ? `class ${value.name}` : value === Object.prototype ? "Object.prototype" : `prototype of ${value.constructor.name}`;
function namesAbove(value) {
    const names = [];
    for (let above = value; above; above = Object.getPrototypeOf(above))
        names.push(Object.getOwnPropertyNames(above).filter(name => name !== "constructor" && name !== "length").slice(0, 3).join("+"));
    return names.length;
}
out.push(namesAbove(new Deep(1, 2)), namesAbove(Deep.prototype), namesAbove(new Table()), namesAbove(new Fault("f")));
out.push(nameOf(Object.getPrototypeOf(Deep)), nameOf(Object.getPrototypeOf(Deep.prototype)), nameOf(Object.getPrototypeOf(Point.prototype)));
out.push(nameOf(Object.getPrototypeOf(Fault)), nameOf(Object.getPrototypeOf(Fault.prototype)), nameOf(Reflect.getPrototypeOf(Table)));
out.push(Object.getPrototypeOf(Point) === Function.prototype, Object.getPrototypeOf(Object.getPrototypeOf(Point)) === Object.prototype);
out.push(Point.prototype.isPrototypeOf(new Deep(3, 4)), Deep.prototype.isPrototypeOf(new Point(3, 4)), Point.prototype.hasOwnProperty("add"), Deep.prototype.hasOwnProperty("add"), Point.prototype.propertyIsEnumerable("add"));

// The class above is called through what was found.
out.push(Object.getPrototypeOf(Deep.prototype).add.call(new Deep(5, 6), new Point(1, 1)).x, new (Object.getPrototypeOf(Deep))(8, 9).y);
Object.getPrototypeOf(Deep.prototype).moved = function () {
    return this.y * 2;
};
out.push(new Deep(1, 21).moved());

// What stands above is laid there while the program runs.
class Plain {
    own() {
        return "own";
    }
}
class Above {
    above() {
        return "above";
    }
    static made() {
        return "made";
    }
}
Object.setPrototypeOf(Plain.prototype, Above.prototype);
Object.setPrototypeOf(Plain, Above);
out.push(nameOf(Object.getPrototypeOf(Plain)), nameOf(Object.getPrototypeOf(Plain.prototype)), new Plain().above(), Plain.made(), Object.getPrototypeOf(Plain).made());
const mixed = Base => class Mixed extends Base {
    mixed() {
        return this.x;
    }
};
const Mixed = mixed(Point);
out.push(nameOf(Object.getPrototypeOf(Mixed)), Object.getPrototypeOf(Mixed.prototype) === Point.prototype, Object.getPrototypeOf(Mixed.prototype).add.call(new Mixed(2, 3), new Point(1, 1)).y);
class Nothing extends null {}
out.push(nameOf(Object.getPrototypeOf(Nothing.prototype)));
function Old(a) {
    this.a = a;
}
Old.prototype.read = function () {
    return this.a;
};
function Heir(a) {
    Old.call(this, a);
}
Heir.prototype = Object.create(Old.prototype, { constructor: { value: Heir } });
Object.setPrototypeOf(Heir, Old);
out.push(nameOf(Object.getPrototypeOf(Heir)), Object.getPrototypeOf(Heir.prototype).read.call(new Heir(4)), nameOf(Object.getPrototypeOf(new Heir(1))));

let steps = 0;
for (let above = KeptBelow.prototype; above; above = Object.getPrototypeOf(above))
    steps++;
out.push(steps, Object.getPrototypeOf(KeptBelow) === Kept, Object.getPrototypeOf(Kept) === null, Object.getPrototypeOf(Kept.prototype) === Object.prototype);
out.push(Kept.prototype.isPrototypeOf(new KeptBelow(1, 2)), Kept.prototype.hasOwnProperty("add"), new KeptBelow(1, 2).below());

function run(turns) {
    let sum = new Kept(0, 0);
    const step = new Kept(1, 2);
    for (let turn = 0; turn < turns; turn++)
        sum = sum.add(step);
    return sum.x + sum.y;
}
out.push(run(1000));
console.log(out.join("\n"));
