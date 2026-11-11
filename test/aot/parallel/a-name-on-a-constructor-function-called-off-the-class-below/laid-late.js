class O { constructor() { this.x = 1; } }
function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function call(o) { try { return A.make(o) === o; } catch (error) { return error.constructor.name; } }
const o = new O();
const before = call(o) + ":" + o.x;
Base.make = function (o) { o.x = "changed by " + this.name; return o; };
console.log(before, call(o), o.x);
