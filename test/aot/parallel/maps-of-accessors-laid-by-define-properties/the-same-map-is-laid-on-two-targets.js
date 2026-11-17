const seed = Number(process.argv[2] ?? 3);
const map = { first: { get() { return this.n + 1; } } };
function A(n) { this.n = n; }
function B(n) { this.n = n; }
Object.defineProperties(A.prototype, map);
Object.defineProperties(B.prototype, map);
console.log(new A(seed).first, new B("text").first, Object.getOwnPropertyDescriptor(A.prototype, "first").get === Object.getOwnPropertyDescriptor(B.prototype, "first").get);
