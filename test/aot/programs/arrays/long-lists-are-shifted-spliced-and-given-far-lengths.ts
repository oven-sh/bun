// The engine gives an array another kind of storage when it is long and is shifted, spliced, given a far index or a far length.
function fill(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i + 0.5); return a; }
function fillInts(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i); return a; }
function fillAny(n: number): (number | string)[] { const a: (number | string)[] = []; for (let i = 0; i < n; i++) a.push(i & 1 ? "s" + i : i); return a; }
function sum(a: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function show(a: (number | string)[]): string { return a.length + ":" + a[0] + "," + a[1] + "," + a[a.length - 1]; }
const events: [string, (a: any[]) => void][] = [
    ["shift", a => { a.shift(); }],
    ["unshift", a => { a.unshift(7); }],
    ["splice front", a => { a.splice(0, 1); }],
    ["splice insert", a => { a.splice(1, 0, 8, 9); }],
    ["far length", a => { a.length = a.length + 200000; a.length = 5; }],
    ["far index", a => { a[a.length + 100000] = 3; a.length = 5; }],
    ["shrink and grow", a => { a.length = 0; for (let i = 0; i < 20; i++) a.push(i); }],
    ["reverse", a => { a.reverse(); }],
    ["copyWithin", a => { a.copyWithin(0, 5); }],
    ["delete", a => { delete a[1]; a[1] = 4; }],
];
for (const n of [5, 9999, 10001, 30000, 101000]) {
    for (const [name, event] of events) {
        const d = fill(n), i = fillInts(n), m = fillAny(n);
        const before = sum(d) + sum(i);
        event(d); event(i); event(m);
        d.push(1.5); i.push(2); m.push("end");
        let local = 0;
        for (let k = 0; k < d.length; k++) local += d[k] + i[k];
        console.log(n, name, before, sum(d), sum(i), local, show(d), show(i), show(m));
    }
}
function queue(n: number): number {
    const q: number[] = [];
    for (let i = 0; i < n; i++) q.push(i);
    let s = 0, extra = 5;
    while (q.length) { s += q.shift()!; if (extra > 0 && q.length % 1024 === 1) { extra--; q.push(1); } }
    return s;
}
console.log(queue(50), queue(10050), queue(12000));
console.log(new Array(100001).length, new Array<number>(100001).fill(1.5).reduce((x, y) => x + y, 0), Array.from({ length: 100005 }, (_, i) => i).at(-1));
const holes: number[] = new Array(120000);
holes[5] = 1; holes.push(2);
console.log(holes.length, holes[5], holes[6], holes[120000]);
