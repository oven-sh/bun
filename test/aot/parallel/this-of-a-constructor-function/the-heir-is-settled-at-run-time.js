// What a class stands below is chosen at run time, changed after the fact, or bound.
const unseen = x => [x][JSON.parse("0")];
class O { constructor() { this.x = 1; } m() { return this.x; } }
const o = new O();
function Base(v) { this.held = v; }
function Other(v) { this.other = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const show = made => [made.held === o, made.other === o, Object.keys(made).join(), made instanceof Base, made instanceof Other].join(" ");
for (const choice of unseen([true, false])) {
  class Chosen extends (choice ? Base : Other) { constructor(v) { super(v); this.z = 3; } }
  console.log(show(new Chosen(o)));
}
console.log(show(new A(o)));
Object.setPrototypeOf(A, Other);
console.log(show(new A(o)));
Object.setPrototypeOf(A, Base);
Object.setPrototypeOf(A.prototype, Other.prototype);
console.log(show(new A(o)));
const Bound = Base.bind({ ignored: true }, o);
try {
    class BelowBound extends Bound { constructor() { super(); this.w = 4; } }
    console.log(show(new BelowBound()), new BelowBound() instanceof Bound);
} catch (error) { console.log(error.constructor.name); }
console.log(show(new Bound()));
console.log(o.m());
