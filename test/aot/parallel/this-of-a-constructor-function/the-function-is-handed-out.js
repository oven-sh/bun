// The constructor function itself leaves: to unseen code, to natives that call it with a receiver, and into a heir that unseen code makes.
const unseen = x => [x][JSON.parse("0")];
class O { constructor() { this.x = 1; } m() { return this.x; } }
const o = new O();
function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
console.log(new A(o).held === o);
const receiver = { tag: "receiver" };
[o].forEach(Base, receiver);
console.log(receiver.held === o, Object.keys(receiver).join());
const mapped = Array.from({ length: 1 }, Base, receiver);
console.log(mapped.length, receiver.held);
const Hidden = unseen(Base);
const made = new Hidden(o);
console.log(made.held.m(), made instanceof Base, made instanceof A);
const Heir = new Function("Base", "return class Heir extends Base { constructor(v) { super(v); this.late = 1; } }")(Base);
const heir = new Heir(o);
console.log(heir.held === o, Object.keys(heir).join(), heir instanceof Base, heir instanceof A);
heir.held.x = 9;
console.log(o.m());
