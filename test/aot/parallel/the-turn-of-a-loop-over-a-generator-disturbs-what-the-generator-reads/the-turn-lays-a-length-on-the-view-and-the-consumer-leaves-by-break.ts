// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view and the consumer leaves by break.
// file: w4.ts   the consumer leaves by break
function* items(v: Float64Array): Generator<number> { for (let i = 0; i < v.length; i++) yield v[i]; }
const lay = [(v: any, x: number) => { if (x === 2) Object.defineProperty(v, "length", { value: 4 }); }][JSON.parse("0")];
function sum(v: Float64Array): number { let s = 0; for (const x of items(v)) { lay(v, x); s += x; if (x === 4) break; } return s; }
console.log(sum(new Float64Array([1, 2, 3, 4])), sum(new Float64Array([5, 6])));
export {};
