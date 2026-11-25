// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a size of its own on the map that the generator counts by.
function* upTo(m: Map<number, number>): Generator<number> { for (let i = 0; i < m.size; i++) yield i; }
const marks: ((v: any, x: number) => void)[] = [(v, x) => { if (x === 2) Object.defineProperty(v, "size", { value: 3 }); }];
const mark = marks[JSON.parse("0")];
function sum(m: Map<number, number>): number { let s = 0, n = 0; for (const x of upTo(m)) { mark(m, x); s += x; n++; } return s * 10 + n; }
console.log(sum(new Map([[0, 0], [1, 1], [2, 2], [3, 3]])), sum(new Map([[0, 0]])));
export {};
