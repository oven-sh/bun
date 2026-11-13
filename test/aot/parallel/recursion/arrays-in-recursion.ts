// Functions that call themselves ask the array that arrives once for what their accesses rely on. Each array that has not got it, and each that loses it on the way, gives what the program as written gives.
function sum(a: number[], i: number): number { return i === a.length ? 0 : a[i] + sum(a, i + 1); }
function down(a: number[], i: number, n: number): void { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && a[l] > a[m]) m = l; if (r < n && a[r] > a[m]) m = r; if (m !== i) { const x = a[i]; a[i] = a[m]; a[m] = x; down(a, m, n); } }
function two(a: number[], b: number[], i: number): number { if (i >= a.length - 1) return 0; let s = 0; if (a[i] > b[i + 1]) s = a[i] - b[i + 1]; b[i + 1] = a[i] + 1; s += a[i + 1] * 2; two(a, b, i + 1); return s + a[i]; }
function grow(a: number[], i: number): number { if (i > 6) return 0; const s = a[i] + a[i + 1]; a.push(i); const t = grow(a, i + 1); return s + t + a[a.length - 1]; }
function shrink(a: number[], i: number): number { if (i > 4) return 0; const s = a[i] * 2; a.pop(); shrink(a, i + 1); return s + a[i]; }
function turns(a: number[], i: number): number { if (i > 3) return 0; const s = a[i] - 1; a[i] = i === 2 ? 0.5 : i; return s + turns(a, i + 1) + a[i]; }
function holes(a: number[], i: number): number { if (i > 3) return 0; const s = a[i] + 1; delete a[i + 1]; return s + holes(a, i + 1) * 2; }
function outside(a: number[], i: number): number { if (i < -2) return 0; const s = a[i] + a[i + 3]; return s + outside(a, i - 1); }
function stops(a: number[], i: number): number { const s = a[i] + 1; if (i === 2) throw new Error("at " + s); a[i] = s; return stops(a, i + 1) + a[i]; }
function text(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
function print(name: string, result: number, a: number[]): void { let s = ""; for (let i = 0; i < a.length; i++) s += (i in a ? text(a[i]) : "hole") + " "; console.log(name, text(result), s, a.length); }
function heap(a: number[]): number[] { for (let i = a.length >> 1; i >= 0; i--) down(a, i, a.length); for (let n = a.length - 1; n > 0; n--) { const x = a[0]; a[0] = a[n]; a[n] = x; down(a, 0, n); } return a; }
function frozen(a: number[]): number[] { return Object.freeze(a) as number[]; }
for (let turn = 0; turn < 3; ++turn) {
    print("heap", 0, heap([5, 3, 9, 1, 7, 2, 8, 6, 4, 0, 11, 13, 12, 10 + turn]));
    print("heap", 0, heap([0.5, 3, -0, 2147483648, 7, NaN, 8, -2147483649, 4, 0]));
    print("heap", 0, heap([5, , 9, 1, , 2, 8] as number[]));
    print("heap", 0, heap([]));
    print("sum", sum([1, 2, 3, 4], 0), [1]);
    print("sum", sum([1.5, 2, , 4] as number[], turn & 1), [1]);
    print("sum", sum([2147483647, 2147483647, 1], 0), [1]);
    const same = [4, 8, 15, 16, 23, 42];
    print("two", two(same, same, 0), same);
    const one = [3, 1, 2, 5], other = [9, 0.5, 7];
    print("two", two(one, other, 0), one); print("two", 0, other);
    const grown = [1, 2, 3, 4, 5, 6, 7, 8];
    print("grow", grow(grown, 0), grown);
    const shrunk = [1, 2, 3, 4, 5, 6, 7];
    print("shrink", shrink(shrunk, 0), shrunk);
    const turned = [1, 2, 3, 4, 5];
    print("turns", turns(turned, 0), turned);
    const holed = [1, 2, 3, 4, 5];
    print("holes", holes(holed, 0), holed);
    const far = [1, 2, 3, 4, 5];
    print("outside", outside(far, 1), far);
    const still = frozen([3, 2, 1]);
    try { print("heap", 0, heap(still)); } catch (e) { console.log("threw", e instanceof TypeError); }
    print("sum", sum(still, 0), still);
    const stopped = [1, 2, 3, 4];
    try { print("stops", stops(stopped, 0), stopped); } catch (e) { console.log("threw", (e as Error).message, (e as Error).stack!.split("\n").filter(line => line.includes("stops")).length); print("stops", 0, stopped); }
}
