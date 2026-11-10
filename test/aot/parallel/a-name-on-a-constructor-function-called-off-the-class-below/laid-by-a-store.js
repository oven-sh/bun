class O { constructor() { this.x = 1; } }
function Base(v) { this.held = v; }
Base.make = function (o) { o.x = "changed by " + this.name; return o; };
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const o = new O();
console.log(A.make(o) === o, o.x);
