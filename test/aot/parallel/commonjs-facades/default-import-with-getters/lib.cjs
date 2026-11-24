const log = [];
let counter = 0;
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
const make = i => new Point(i, 2);
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += make(i).sum(); return t; }
const value = new Point(3, 4);
Object.defineProperty(exports, "log", { enumerable: true, get: () => log });
Object.defineProperty(exports, "Point", { enumerable: true, get: function () { counter++; return Point; } });
Object.defineProperty(exports, "make", { enumerable: true, get: function () { log.push("make " + (this === exports)); return make; } });
Object.defineProperty(exports, "unread", { enumerable: true, get: function () { value.y = 5; log.push("unread"); return make(1); } });
Object.defineProperty(exports, "broken", { enumerable: true, get: () => { throw new Error("broken"); } });
Object.defineProperty(exports, "counter", { enumerable: true, get: () => counter });
Object.defineProperty(exports, "value", { enumerable: true, get: () => value });
exports.run = run;
log.push("end of body " + counter);
