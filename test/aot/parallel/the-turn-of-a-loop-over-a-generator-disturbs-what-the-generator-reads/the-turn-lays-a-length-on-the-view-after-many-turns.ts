// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view after many turns.
function* items(v: Float64Array): Generator<number> { for (let i = 0; i < v.length; i++) yield v[i]; }
const marks: ((v: any, x: number) => void)[] = [(v, x) => { if (x === 50) v.note = "seen"; }];
const mark = marks[JSON.parse("0")];
function sum(v: Float64Array): number { let s = 0; for (const x of items(v)) { mark(v, x); s += x; } return s; }
let t = ""; for (let r = 0; r < 20; r++) t += sum(Float64Array.from({ length: 100 }, (_, i) => i)) + ","; console.log(t);
export {};
