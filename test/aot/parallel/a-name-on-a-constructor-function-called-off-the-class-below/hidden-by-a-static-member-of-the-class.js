class O { constructor() { this.x = 1; } }
function Base(v) { this.held = v; }
Base.make = function (o) { o.x = "changed by the function"; return o; };
class A extends Base { constructor(v) { super(v); this.y = 2; } static make(o) { o.x = "changed by the member"; return super.make; } }
const o = new O();
console.log(A.make(o) === Base.make, o.x);
