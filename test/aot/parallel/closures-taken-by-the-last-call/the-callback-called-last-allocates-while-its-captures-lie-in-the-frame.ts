function last(f: (x: number) => number[], x: number): number[] { return f(x); }
function fill(k: number, label: { tag: string }): number[] { return last(x => { const out: number[] = []; for (let i = 0; i < 2000; i++) out.push(i + x + label.tag.length); return out; }, k); }
function pair(k: number): number[] { return last(x => [x, k], k + 1); }
let total = 0;
for (let i = 0; i < 300; i++) total += fill(i, { tag: "t" + i })[1999] + pair(i)[0];
console.log(total);
