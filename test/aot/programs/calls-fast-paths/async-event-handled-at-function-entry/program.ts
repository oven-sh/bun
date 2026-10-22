// ENV JSC_aotCountsPath=/dev/null JSC_watchdog=250
declare const console: any;
declare const aotOperationCount: (name: string) => number;
declare const sleepSeconds: (seconds: number) => void;
class Point { constructor(public x: number, public y: number) {} }
function walk(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number,
              p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number,
              text: string, point: Point, depth: number): number {
    if (depth === 0)
        return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + p * 0.5 + q * 1.5 + r * 2.5 + s * 3.5 + t * 4.5 + u * 5.5 + v * 6.5 + w * 7.5 + text.length + point.x * point.y;
    return walk(b, c, d, e, f, g, h, a, q, r, s, t, u, v, w, p, text, point, depth - 1) + 1;
}
const point = new Point(3, 7);
function once(): number { return walk(1, 2, 3, 4, 5, 6, 7, 8, 0.25, 1.25, 2.25, 3.25, 4.25, 5.25, 6.25, 7.25, "sixteen letters!", point, 21); }
const first = once();
let differing = 0;
for (let round = 0; round < 120; round++) {
    sleepSeconds(0.01);
    if (once() !== first)
        differing++;
}
console.log("the result:", first);
console.log("rounds whose result differs:", differing);
console.log("the poll at an entry was entered:", aotOperationCount("operationAOTPollAtPrologue") > 0);
