// `sort` on an array of 3 strings and the callback never installs an accessor on a prototype (the control).
const p: { [k: number]: unknown } = {}; Object.create(p);
let calls = 0;
function bad(): void { Object.defineProperty(p, 0, { get() { return undefined; } }); }
function tick(): void { if (++calls === 99) bad(); }
const a: string[] = ["e", "c", "i"];
const r = a.slice().sort((x, y) => (tick(), x < y ? -1 : x > y ? 1 : 0));
console.log(r.map(x => x).join(), r.length, Array.isArray(r), a.map(x => x).join());
r.push(r[0]); r[r.length + 1] = r[1];
console.log(r.length, Object.keys(r).join(), r.indexOf(r[1]));
const again = a.slice().sort((x, y) => (tick(), x < y ? -1 : x > y ? 1 : 0));
console.log(again.map(x => x).join(), again.length);
