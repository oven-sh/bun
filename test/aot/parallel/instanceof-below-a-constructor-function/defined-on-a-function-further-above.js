function Grand() { this.top = 1; }
function Base(v) { Grand.call(this); this.held = v; }
Object.setPrototypeOf(Base.prototype, Grand.prototype);
Object.setPrototypeOf(Base, Grand);
class A extends Base { constructor(v) { super(v); this.y = 2; } }
Object.defineProperty(Grand, Symbol.hasInstance, { value: function (object) { object.held = "changed by " + this.name; return true; } });
const b = new Base(1);
console.log(b instanceof A, b.held);
