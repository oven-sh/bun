// STATISTIC: ImageFunctionsEmitted <= 3
const kept = new WeakSet([Array.prototype, Error.prototype]);
function lazy(o, k, get) { Object.defineProperty(o, k, { get, configurable: true }); }
const made = {};
lazy(made, JSON.parse(`"a"`), () => 1);
console.log(made.a, kept.has(made));
