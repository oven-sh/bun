declare const console: { log(...values: unknown[]): void };
function findLast<T>(array: readonly T[], predicate: (element: T, index: number) => boolean, startIndex?: number): T | undefined {
    for (let i = startIndex ?? array.length - 1; i >= 0; i--) { const element = array[i]; if (predicate(element, i)) return element; }
    return undefined;
}
function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean, startIndex?: number): T | undefined {
    for (let i = startIndex ?? 0; i < array.length; i++) { const element = array[i]; if (predicate(element, i)) return element; }
    return undefined;
}
function sumFrom(a: number[], start: number, step: number): number { let t = 0; for (let i = start; i < a.length; i += 2) t += a[i] === undefined ? 1000 : a[i]; return t + step; }
function sumDownFrom(a: number[], start: number): number { let t = 0; for (let i = start; i >= 0; i -= 3) t += a[i] === undefined ? 1000 : a[i]; return t; }
function lastEven(a: number[]): number | undefined { return findLast(a, x => (x & 1) === 0); }
function firstEven(a: number[]): number | undefined { return find(a, x => (x & 1) === 0); }
function lastEvenFrom(a: number[], from: number): number | undefined { return findLast(a, x => (x & 1) === 0, from); }
function firstEvenFrom(a: number[], from: number): number | undefined { return find(a, x => (x & 1) === 0, from); }
function places(a: number[]): string { let s = ""; findLast(a, (_, i) => { s += i + (Object.is(i, -0) ? "!" : "") + ","; return false; }); find(a, (_, i) => { s += i + ","; return false; }); return s; }
function fromTwo(a: number[]): number { return sumFrom(a, 2, 0) + sumDownFrom(a, a.length - 1) + sumDownFrom(a, 4); }
function notTested(a: number[]): number { let t = 0; let i = a.length - 1; while (true) { if (i < -3) break; t += i; i--; } return t; }
function testedElsewhere(a: number[], stop: boolean): number { let t = 0; for (let i = a.length - 1; i >= 0 || !stop; i--) { t += i; if (i < -5) break; } return t; }
function bothWays(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) { t += i; if (t > 1e6) i--; } return t; }
function steppedInTheOtherArm(a: number[]): number { let t = 0; let i = 0; for (;;) { if (i < a.length) { t += a[i]; i++; } else { i++; if (i > a.length + 2) break; } } return t + i; }
const a = [1, 2, 3, 4, 5, 7, 9];
for (let turn = 0; turn < 2; turn++) {
    console.log(lastEven(a), firstEven(a), lastEven([]), firstEven([]), lastEven([1]), places([5, 6, 7]), places([]));
    console.log([6, 3, 1, 0, -1, 2.5, NaN, 100, Infinity, -0].map(from => lastEvenFrom(a, from) + "|" + firstEvenFrom(a, from)).join(" "));
    console.log(fromTwo(a), sumFrom(a, 0.5, 0), sumFrom(a, -2, 0), sumDownFrom(a, 2.5), sumDownFrom(a, 1e3), notTested(a), testedElsewhere(a, true), testedElsewhere(a, false), bothWays(a), steppedInTheOtherArm(a));
}
