function Base(v) { this.held = v; }
Object.defineProperty(Base, Symbol.hasInstance, { value: function (object) { object.held = "changed by " + this.name; return true; }, writable: true });
const bound = Base.bind(null);
const b = new Base(1);
console.log(b instanceof bound, b.held);
