// The positions lie beyond every typed array: the check of the read fails before the loop runs.
// STATISTIC: TypedArrayReadsFolded >= 2
const h = new Uint16Array([7, 6, 5, 4, 3, 2, 1, 9]), doubles = new Float64Array(4);
function f(y: number) { for (const i of [0, 1, 2, 3]) { h[y - (y & ~7)] += 1; } }
function g(y: number) { let s = 0; for (const i of [0, 1, 2, 3]) { doubles[y] = doubles[y] + i; s += doubles[i]; } return s; }
f(2 ** 32 + 3); f(2 ** 40 + 5); f(2 ** 32); console.log(h.join());
console.log(g(2 ** 32 + 3), g(2 ** 40 + 5), g(2 ** 32), doubles.join());
