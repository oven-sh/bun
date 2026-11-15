// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 2
// `if (typeof Reflect.decorate === "function")`: nobody lays the member, so the classes that are handed to it stay known. What is handed to a member of a function does not: somebody may lay the name on Function.prototype.
class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }
}
function decorate(decorators, target, key) {
    let result = target;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
        result = Reflect.decorate(decorators, target, key);
    else {
        for (const decorator of decorators)
            result = decorator(result, key) || result;
    }
    return result;
}
function metadata(key, value) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function")
        return Reflect.metadata(key, value);
}
const seen = [];
decorate([(target, key) => { seen.push(typeof target.add, key); }], Point.prototype, "x");
metadata("design:type", Point);
for (const ask of [() => Math.sumOf(Point), () => JSON.other(new Point(1, 2)), () => Object.groupedBy.call(null, 1), () => new Promise.Any(1)]) {
    try {
        console.log(ask());
    } catch (error) {
        console.log(error.constructor.name);
    }
}
console.log(Math.sumOf?.(Point), Reflect.decorate, "metadata" in Reflect, JSON.other || "none");
function sum(count) {
    let p = new Point(0, 0);
    for (let i = 0; i < count; i++)
        p = p.add(new Point(i, 1));
    return p.x + p.y;
}
console.log(sum(10), seen.join());
