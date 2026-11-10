// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view that a generator method counts by.
class Box { constructor(public v: Float64Array) {} *items(): Generator<number> { const v = this.v; for (let i = 0; i < v.length; i++) yield v[i]; } }
const marks: ((v: any, x: number) => void)[] = [(v, x) => { if (x === 2) Object.defineProperty(v, "length", { value: 3 }); }];
const mark = marks[JSON.parse("0")];
function sum(b: Box): number { let s = 0; for (const x of b.items()) { mark(b.v, x); s += x; } return s; }
console.log(sum(new Box(new Float64Array([1, 2, 3, 4]))), sum(new Box(new Float64Array([5, 6]))));
export {};
