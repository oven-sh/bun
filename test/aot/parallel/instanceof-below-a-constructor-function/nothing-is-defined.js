class O { constructor() { this.x = 1; } m() { return this.x; } }
const o = new O();
function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const a = new A(o), b = new Base(o);
console.log(a.y, o.m(), b instanceof A, a instanceof A, a instanceof Base, "text" instanceof A, null instanceof A);
