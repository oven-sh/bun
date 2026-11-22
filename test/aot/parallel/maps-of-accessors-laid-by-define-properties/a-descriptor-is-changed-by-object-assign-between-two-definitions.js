const seed = Number(process.argv[2] ?? 3);
const map = { first: { get() { return 1; }, configurable: true } };
function A() {}
function B() {}
Object.defineProperties(A.prototype, map);
Object.assign(map.first, { get() { return "assigned" + seed; } });
Object.defineProperties(B.prototype, { first: map.first });
console.log(new A().first, new B().first);
