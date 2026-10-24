// `x instanceof f.bind(..)` asks the target, which has a `Symbol.hasInstance` since after the bind.
const f = () => 1, b = f.bind(null);
Object.defineProperty(f, Symbol.hasInstance, { value: () => true });
console.log(1 instanceof b);
