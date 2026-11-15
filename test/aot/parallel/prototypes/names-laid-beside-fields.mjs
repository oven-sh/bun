// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 2
// A program lays methods, a value and a symbol on the prototypes of its classes: the constructors' stores under other names pass them as before.
class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }
}
Point.prototype.length2 = function () { return this.x * this.x + this.y * this.y; };
Point.prototype.kind = 3;
Object.assign(Point.prototype, { flip() { return new Point(this.y, this.x); } });
Point.prototype[Symbol.toStringTag] = "Point";
class Below extends Point {
    constructor(x, y) {
        super(x, y);
        this.z = x;
    }
}
Below.prototype.depth = function () { return this.z; };
// A name that a constructor stores under: an accessor that stands above it takes the store.
class Watched {
    constructor(v) {
        this.seen = 0;
        this.v = v;
    }
}
const log = [];
Object.defineProperty(Watched.prototype, "v", { set(v) { log.push(v); }, get() { return "above"; }, configurable: true });
class Late {
    constructor(v) {
        this.v = v;
    }
}
function sum(count) {
    let p = new Point(0, 0);
    for (let i = 0; i < count; i++)
        p = p.add(new Point(i, 1));
    return p.x + p.y;
}
function sumBelow(count) {
    let total = 0;
    for (let i = 0; i < count; i++)
        total += new Below(i, 2).depth();
    return total;
}
console.log(sum(10), sumBelow(10), new Point(3, 4).length2(), new Point(1, 2).flip().x, new Point(0, 0).kind, new Point(0, 0)[Symbol.toStringTag]);
console.log(Object.keys(new Watched(5)).join(), new Watched(6).v, log.join());
console.log(Object.keys(new Late(1)).join());
Object.defineProperty(Late.prototype, "v", { set(v) { log.push("late" + v); }, configurable: true });
console.log(Object.keys(new Late(2)).join(), log.join(), Object.keys(Point.prototype).join());
Late.prototype.kind = 4;
console.log(new Late(0).kind, delete Late.prototype.kind, new Late(0).kind);
