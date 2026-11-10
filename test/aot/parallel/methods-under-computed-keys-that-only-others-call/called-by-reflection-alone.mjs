const a = Symbol("a"), b = Symbol("b"); class A { [a]() { return "a"; } [b]() { return "b"; } idle() { return "idle"; } }
console.log(Object.getOwnPropertySymbols(A.prototype).map(s => new A()[s]()).join(), Reflect.ownKeys(A.prototype).length);
