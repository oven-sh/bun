// COUNTER: StructuresPassingStores >= 1
var bodies = { 1: function (require, module, exports) {
class Point { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 0; this.parent = undefined; } getStart() { return this.pos; } }
function create(kind, parent) { const made = new Point(kind, 1); made.parent = parent; return made; }
function depth(node) { let sum = 0; while (node) { if (node.kind === 3) sum++; sum += node.flags + node.getStart(); node = node.parent; } return sum; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let made; for (let k = 0; k < 8; k++) made = create(k & 3, made); sum += depth(made); } return sum; }
exports.Point = Point; exports.create = create; exports.run = run;
} };
const load = () => { const module = { exports: {} }; bodies[process.argv[9] || 1](null, module, module.exports); return module.exports; };
const first = load(), second = load();
console.log(first.run(100), second.run(100), first.Point === second.Point, Object.keys(first.create(1)).join());
const log = [];
const keys = make => { try { return Object.keys(make()).join(); } catch (error) { return error.name; } };
Object.defineProperty(first.Point.prototype, "kind", { set(value) { log.push("kind " + value); }, configurable: true });
console.log(keys(() => first.create(1)), keys(() => second.create(1)), log.join());
Object.setPrototypeOf(second.Point.prototype, { set pos(value) { log.push("pos " + value); } });
console.log(keys(() => first.create(2)), keys(() => second.create(2)), log.join());
delete first.Point.prototype.kind;
Object.setPrototypeOf(second.Point.prototype, Object.freeze({ flags: 3 }));
for (let i = 0; i < 4; i++) console.log(keys(() => first.create(3)), keys(() => second.create(3)));
Object.setPrototypeOf(second.Point.prototype, new Proxy({}, { set(target, key, value, receiver) { log.push(key); return Reflect.set(target, key, value, receiver); } }));
console.log(keys(() => second.create(4)), log.length, first.run(50));
class Heir extends first.Point { constructor(kind) { super(kind, 7); this.more = 1; } }
for (let i = 0; i < 3; i++) console.log(Object.keys(new Heir(i)).join(), new Heir(i).getStart());
Object.defineProperty(Heir.prototype, "flags", { value: 9, writable: false });
for (let i = 0; i < 3; i++) console.log(keys(() => new Heir(i)));
