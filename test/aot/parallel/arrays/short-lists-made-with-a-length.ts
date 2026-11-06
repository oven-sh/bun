// Short lists made by new Array(n), filled and read in every way that keeps them as they were made, and in ways that do not.
function restAgain(a?: number, b?: number, c?: number): number[] { var r = new Array(arguments.length); for (var k = 0; k < r.length; k++) r[k] = arguments[k]; return r; }
function restSum(a?: number, b?: number, c?: number): number { var r = new Array(arguments.length); for (var k = 0; k < r.length; k++) r[k] = arguments[k]; return r.length + r[1]; }
function three(x: number): number { const r = new Array(3); r[0] = x; r[1] = x + 1; r[2] = x + 2; return r[0] + r[1] + r[2] + r.length; }
function holes(x: number): unknown[] { const r = new Array(4); r[1] = x; return [r.length, r[0], r[1], 0 in r, 1 in r]; }
function past(x: number): number { const r = new Array(2); for (let k = 0; k < 3; k++) r[k] = x + k; return r.length + r[2]; }
function pastRead(x: number): unknown { const r = new Array(2); r[0] = x; return r[5]; }
function byLength(x: number, n: number): number { const r = new Array(3); for (let k = 0; k < n; k++) r[k] = x; return r.length; }
function shrunk(x: number): number { const r = new Array(3); r[0] = x; r.length = 1; return r.length + (r[2] === undefined ? 10 : 20); }
function fractions(x: number): number { const r = new Array(3); for (let k = 0; k < r.length; k++) r[k] = x + 0.5; return r[0] + r[1] + r[2]; }
function strings(x: number): string { const r = new Array(2); for (let k = 0; k < r.length; k++) r[k] = "s" + (x + k); return r.join(); }
function given(x: number, take: (l: number[]) => void): number { const r = new Array(2); r[0] = x; take(r); return r.length; }
function negative(x: number): number { const r = new Array(2); r[-1 + (x & 0)] = x; return r.length; }
function zero(x: number): number { const r = new Array(0); r[0] = x; return r.length; }
const out: unknown[] = [];
let sum = 0;
for (let i = 0; i < 20000; i++) { sum += restSum(i & 7, 2, 3) + three(i & 3) + past(i & 1) + byLength(1, 2) + shrunk(i); sum += fractions(i & 1) + given(1, l => { l.push(9); }); }
out.push(sum, restAgain(1, 2, 3), restAgain(1), restAgain(), restSum(1, 2), three(1), holes(4), past(1), pastRead(1), byLength(1, 2), byLength(1, 5), shrunk(1), fractions(1), strings(1), given(1, l => { l.length = 0; }), negative(1), zero(1));
console.log(JSON.stringify(out));
