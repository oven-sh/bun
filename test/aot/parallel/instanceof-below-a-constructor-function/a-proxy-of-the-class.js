function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const seen = [];
const proxy = new Proxy(A, { get(target, key, receiver) { seen.push(String(key)); return key === Symbol.hasInstance ? function (object) { object.held = "changed"; return true; } : Reflect.get(target, key, receiver); } });
const b = new Base(1);
console.log(b instanceof proxy, b.held, seen.join());
