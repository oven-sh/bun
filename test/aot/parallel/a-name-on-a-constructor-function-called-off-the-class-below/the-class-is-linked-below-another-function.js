class O { constructor() { this.x = 1; } }
function Base(v) { this.held = v; }
Base.make = function (o) { o.x = "changed by Base's"; return o; };
function Other() {}
Other.make = function (o) { o.x = "changed by Other's"; return o; };
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function call(o) { return A.make(o).x; }
const before = call(new O());
Object.setPrototypeOf(A, Other);
console.log(before, call(new O()));
