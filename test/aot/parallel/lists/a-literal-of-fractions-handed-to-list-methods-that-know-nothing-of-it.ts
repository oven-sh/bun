const turns = 3000 + process.argv.length;
function make(i0: number): number[] { const i = i0 & 1023; return [i + 0.5, i + 1.5, i + 2.5, i + 3.5]; }
function total(v: any): number {
    let s = 0; v.forEach((x: number) => { s += x; });
    return s + v.reduce((p: number, q: number) => p + q, 0) + v.map((x: number) => x * 2)[3] + v.filter((x: number) => x > 2).length + (v.some((x: number) => x > 1000) ? 1 : 0) + (v.every((x: number) => x > 0) ? 1 : 0) + (v.find((x: number) => x > 3) ?? 0) + v.findIndex((x: number) => x > 3);
}
let sum = 0; for (let n = 0; n < turns; n++) sum += total(make(n));
console.log(sum);
