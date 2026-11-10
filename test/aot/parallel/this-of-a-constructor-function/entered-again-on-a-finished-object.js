// The constructor function runs a second time on an object of the heir that is long finished, on one whose field was deleted, and in front of the heir's own stores.
const unseen = x => [x][JSON.parse("0")];
class O { constructor(x) { this.x = x; } m() { return this.x; } }
const first = new O(1), second = new O(2);
function Base(v) { this.held = v; this.count = (this.count | 0) + 1; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function B(v) { this.early = 0; Base.call(this, v); this.y = 3; }
Object.setPrototypeOf(B.prototype, Base.prototype);
const read = made => made.held.m() + ":" + made.count + ":" + Object.keys(made).join();
const a = new A(first), b = new B(first);
console.log(read(a), read(b));
Base.call(a, second);
Base.call(b, second);
console.log(read(a), read(b));
delete a.held;
delete b.count;
console.log(Object.keys(a).join(), Object.keys(b).join());
Base.call(a, first);
Base.call(b, first);
console.log(read(a), read(b));
for (let i = 0; i < unseen(3); i++) Base.call(i & 1 ? a : b, i & 1 ? first : second);
console.log(read(a), read(b), first.m(), second.m());
