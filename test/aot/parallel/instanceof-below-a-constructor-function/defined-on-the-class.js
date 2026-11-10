function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
Object.defineProperty(A, Symbol.hasInstance, { value: function (object) { object.held = "changed by " + this.name; return true; } });
const b = new Base(1);
console.log(b instanceof A, b.held, b instanceof Base);
