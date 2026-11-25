// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view under a consumer in a consumer.
function* items(v: Float64Array): Generator<number> { for (let i = 0; i < v.length; i++) yield v[i]; }
const marks: ((v: any, x: number) => void)[] = [(v, x) => { if (x === 2) Object.defineProperty(v, "length", { value: 3 }); }];
const mark = marks[JSON.parse("0")];
function sum(v: Float64Array): number { let s = 0; for (let r = 0; r < 2; r++) { s += 10; for (const x of items(v)) { mark(v, x); s += x; } } return s; }
console.log(sum(new Float64Array([1, 2, 3, 4])), sum(new Float64Array([5, 6])));
export {};
