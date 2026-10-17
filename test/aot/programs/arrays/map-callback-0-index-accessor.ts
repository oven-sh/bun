// `map` on an array of 5 integers while call number 0 of the callback installs an accessor for an index on a prototype.
const p: { [k: number]: unknown } = {}; Object.create(p);
let calls = 0;
function bad(): void { Object.defineProperty(p, 0, { get() { return undefined; } }); }
function tick(): void { if (++calls === 0) bad(); }
const a: number[] = [5, 3, 9, 1, 7];
bad();
const r = a.map(x => (tick(), x));
console.log(r.map(x => String(x)).join(), r.length, Array.isArray(r), a.map(x => String(x)).join());
r.push(r[0]); r[r.length + 1] = r[1];
console.log(r.length, Object.keys(r).join(), r.indexOf(r[1]));
const again = a.map(x => (tick(), x));
console.log(again.map(x => String(x)).join(), again.length);
