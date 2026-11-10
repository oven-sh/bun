const seed = Number(process.argv[2] ?? 3);
const map = { first: { get() { return 1; }, configurable: true } };
function A() {}
function B() {}
Object.defineProperties(A.prototype, map);
map.first = { get() { return "other" + seed; } };
map.extra = { value: seed, enumerable: true };
delete map.gone;
Object.defineProperties(B.prototype, map);
Object.freeze(map);
console.log(new A().first, new B().first, new B().extra, new A().extra, Object.isFrozen(map));
