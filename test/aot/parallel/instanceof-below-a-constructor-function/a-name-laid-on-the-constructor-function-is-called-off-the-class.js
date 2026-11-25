function Base(v) { this.held = v; }
Base.make = function (v) { return new this(v); };
class A extends Base { constructor(v) { super(v); this.y = 2; } }
const made = A.make(5);
console.log(made instanceof A, made.held, made.y, Base.make(6).y);
