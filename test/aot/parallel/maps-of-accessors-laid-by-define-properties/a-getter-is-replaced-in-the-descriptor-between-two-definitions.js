const seed = Number(process.argv[2] ?? 3);
const map = { first: { get() { return 1; }, configurable: true } };
function A() {}
function B() {}
Object.defineProperties(A.prototype, map);
map.first.get = function () { return "two" + seed; };
Object.defineProperties(B.prototype, map);
console.log(new A().first, new B().first);
