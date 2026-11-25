// The global object goes to a bound Object.defineProperty with a registered symbol as the key.
const g = globalThis;
const ObjectDefineProperty = Object.defineProperty.bind(Object);
ObjectDefineProperty(g, Symbol.for("x"), { value: 1 });
console.log(g[Symbol.for("x")]);
