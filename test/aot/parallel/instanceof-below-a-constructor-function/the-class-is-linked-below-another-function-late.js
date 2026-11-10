function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function Other() {}
Object.defineProperty(Other, Symbol.hasInstance, { value: function (object) { object.held = "changed"; return true; } });
function test(x) { return x instanceof A; }
const b = new Base(1);
const before = test(b) + ":" + b.held;
Object.setPrototypeOf(A, Other);
console.log(before, test(b), b.held);
