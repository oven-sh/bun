// The same in TypeScript's words: the callee stands behind an assertion, and the function is called plainly as well.
function Marker(this: unknown): void { }
function Pair(a: number, b: number): { a: number; b: number } { return { a, b }; }
const made = new (Marker as unknown as new () => object)();
const pair = new (Pair as unknown as new (a: number, b: number) => { a: number; b: number })(1, 2);
console.log(made instanceof Marker, Object.keys(made).length, pair.a + pair.b, pair instanceof Pair, Pair(3, 4).b);
let sum = 0;
for (let i = 0; i < 50000; i++) sum += new (Pair as unknown as new (a: number, b: number) => { a: number; b: number })(i, 1).a & 3;
console.log(sum);
