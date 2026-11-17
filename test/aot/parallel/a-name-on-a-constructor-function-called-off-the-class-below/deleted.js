class O { constructor() { this.x = 1; } }
function Base(v) { this.held = v; }
Base.make = function (o) { o.x = "changed by " + this.name; return o; };
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function call(o) { try { return A.make(o) === o; } catch (error) { return error.constructor.name; } }
const o = new O();
const before = call(o) + ":" + o.x;
delete Base.make;
console.log(before, call(new O()));
