// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view first witness of the third reader.
function* items(v: Float64Array): Generator<number> { for (let i = 0; i < v.length; i++) yield v[i]; }
const cut = [(v: any, x: number) => { if (x === 2) Object.defineProperty(v, "length", { value: 3 }); }][JSON.parse("0")];
function sum(v: Float64Array): string { let s = 0, t = ""; for (const x of items(v)) { cut(v, x); s += x; t += x; } return s + t; }
console.log(sum(new Float64Array([1, 2, 3, 4])), [...items(new Float64Array([1, 2, 3]))].length);
export {};
