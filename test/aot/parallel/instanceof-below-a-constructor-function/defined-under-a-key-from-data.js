function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const keys = ["other", Symbol.hasInstance];
Object.defineProperty(Base, keys[JSON.parse("1")], { value: function (object) { object.held = "changed"; return true; } });
const b = new Base(1);
console.log(b instanceof A, b.held);
