// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view and a list is carried round.
function* items(v: Float64Array): Generator<number> { for (let i = 0; i < v.length; i++) yield v[i]; }
const marks: ((v: any, x: number) => void)[] = [(v, x) => { if (x === 2) Object.defineProperty(v, "length", { value: 3 }); }];
const mark = marks[JSON.parse("0")];
function sum(v: Float64Array): string { let l: number[] = []; let last = l; for (const x of items(v)) { mark(v, x); last = [...last, x]; } return last.join() + l.length; }
console.log(sum(new Float64Array([1, 2, 3, 4])), sum(new Float64Array([5, 6])));
export {};
