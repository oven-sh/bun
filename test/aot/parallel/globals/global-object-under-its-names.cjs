// The shims of browsers: the global object is stored under names of its own, listed ones and new ones.
globalThis.self = globalThis;
globalThis.window = globalThis;
global.global = global;
class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }
}
Library = { Point };
window.count = 1;
self.count++;
console.log(count, globalThis.count, window === self, self === global, typeof window.Library.Point);
let sum = new Library.Point(0, 0);
for (let i = 0; i < 10; i++)
    sum = sum.add(new window.Library.Point(i, 2));
console.log(sum.x, sum.y, Object.keys(sum).join());
self.Library = { Point: class extends Point { add() { return "replaced"; } } };
console.log(new Library.Point(1, 2).add(sum), new window.Library.Point(1, 2).x);
console.log(Object.getOwnPropertyDescriptor(globalThis, "window").enumerable, "window" in globalThis, delete window.window, typeof window);
globalThis.self = { Library: 5 };
console.log(self.Library, typeof globalThis.Library, typeof self.console);
globalThis.self = globalThis;
console.log(self.self === globalThis);
const key = process.argv.length > 50 ? "other" : "count";
self[key] = "text";
console.log(count, globalThis[key]);
