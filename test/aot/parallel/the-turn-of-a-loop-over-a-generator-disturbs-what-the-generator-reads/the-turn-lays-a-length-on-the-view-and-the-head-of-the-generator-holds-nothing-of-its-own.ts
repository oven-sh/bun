// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view and the head of the generator holds nothing of its own.
// file: w3.ts   the generator's head holds nothing of its own
function* tick(v: Float64Array, c: number[]): Generator<number> { while (v.length > c[0]) yield c[0]++; }
const lay = [(v: any, x: number) => { if (x === 2) Object.defineProperty(v, "length", { value: 5 }); }][JSON.parse("0")];
function sum(v: Float64Array): number { let s = 0; for (const x of tick(v, [0])) { lay(v, x); s += x; } return s; }
console.log(sum(new Float64Array(4)), sum(new Float64Array(2)));
export {};
