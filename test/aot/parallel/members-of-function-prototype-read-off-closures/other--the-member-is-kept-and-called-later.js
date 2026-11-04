function Base(a) { this.a = a; }
const kept = Base.call;
const o = { };
kept.call(Base, o, 5);
console.log(o.a, kept === Function.prototype.call);
