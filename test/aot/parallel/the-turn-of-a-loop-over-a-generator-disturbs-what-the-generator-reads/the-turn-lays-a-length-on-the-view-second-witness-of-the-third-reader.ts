// The loop of a generator is walked with the turn of its consumer inside it: the turn lays a length on the view second witness of the third reader.
function* upTo(m: Set<number>): Generator<number> { for (let i = 0; i < m.size; i++) yield i; }
const lay = [(m: any, x: number) => { if (x === 1) Object.defineProperty(m, "size", { get: () => 5 }); }][JSON.parse("0")];
function count(m: Set<number>): number { let n = 100; for (const x of upTo(m)) { lay(m, x); n += x; } return n; }
console.log(count(new Set([7, 8, 9])), count(new Set([7])));
export {};
