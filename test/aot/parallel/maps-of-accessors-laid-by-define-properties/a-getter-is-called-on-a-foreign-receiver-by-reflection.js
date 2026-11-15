const seed = Number(process.argv[2] ?? 3);
const map = { first: { get() { return this.n + 1; } }, second: { get() { return this.list.length; } } };
function T(n) { this.n = n; this.list = [n]; }
Object.defineProperties(T.prototype, map);
const taken = Object.getOwnPropertyDescriptor(T.prototype, "first").get;
const said = [new T(seed).first, taken.call({ n: "text" }), Reflect.get(T.prototype, "first", { n: 0.5 }), Reflect.get(T.prototype, "second", { list: "four" })];
try { said.push(taken.call(undefined)); } catch (error) { said.push(error.constructor.name); }
console.log(said.join(" "));
