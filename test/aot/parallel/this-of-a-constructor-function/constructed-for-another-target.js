// Reflect.construct with a target that stands below, one that does not, one out of unseen code, a bound one and a built-in.
const unseen = x => [x][JSON.parse("0")];
class O { constructor() { this.x = 1; } m() { return this.x; } }
const o = new O();
function Base(v) { this.held = v; this.target = new.target; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function Other(v) { this.other = v; }
class Apart { constructor() { this.z = 3; } }
const show = made => [made.held === o, made.target && made.target.name, Object.keys(made).join(), made instanceof Base, made instanceof A, made instanceof Other, made instanceof Apart, made instanceof Map].join(" ");
console.log(show(new A(o)));
console.log(show(Reflect.construct(Base, [o], A)));
console.log(show(Reflect.construct(Base, [o], Other)));
console.log(show(Reflect.construct(Base, [o], Apart)));
console.log(show(Reflect.construct(Base, [o], unseen(A))));
console.log(show(Reflect.construct(Base, [o], unseen(function () {}))));
console.log(show(Reflect.construct(Base, [o], Map)));
console.log(show(Reflect.construct(unseen(Base), unseen([o]), Base.bind(null))));
console.log(show(new (unseen(A))(o)), o.m());
