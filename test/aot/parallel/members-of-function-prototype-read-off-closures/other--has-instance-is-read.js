function Base(a) { this.a = a; }
console.log(typeof Base[Symbol.hasInstance], new Base(1) instanceof Base);
