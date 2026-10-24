// `instanceof` asks a `Symbol.hasInstance` that the class got after its declaration.
class C {}
Object.defineProperty(C, Symbol.hasInstance, { value: () => true });
console.log(({}) instanceof C);
