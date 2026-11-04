function Base(a, b) { this.a = a; }
console.log(Base.name, Base.length, typeof Base.prototype, typeof Base.call, typeof Base.toString, Base.hasOwnProperty("call"), "call" in Base);
