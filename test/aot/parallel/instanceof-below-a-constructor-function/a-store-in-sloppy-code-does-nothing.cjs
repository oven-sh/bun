function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
Base[Symbol.hasInstance] = function () { return true; };
console.log(new Base(1) instanceof A, Object.hasOwn(Base, Symbol.hasInstance), Base[Symbol.hasInstance] === Function.prototype[Symbol.hasInstance]);
