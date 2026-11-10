// STATISTIC: TurnsOfForOfWrittenOutByNotedLength >= 1
function find(n: number, wanted: number): string { let seen = 0; for (let i = 0; i < n; i++) for (const k of [1, 2, 3]) { seen++; if (k * 10 + i === wanted) return "found " + i + ":" + k + " after " + seen; } return "none after " + seen; }
function first(n: number): number { for (let i = 0; i < n; i++) for (const k of [7, 8]) return k + i; return -1; }
function last(n: number): number { let kept = 0; for (let i = 0; i < n; i++) for (const k of [4, 5, 6]) { kept = k; if (i === n - 1 && k === 6) return kept * 100 + i; } return kept; }
const asked: [number, number][] = [[0, 10], [1, 10], [1, 30], [5, 24], [5, 12], [5, 99], [3, 32]];
for (const [n, wanted] of asked) console.log(find(n, wanted));
console.log(first(0), first(1), first(9), last(0), last(1), last(4));
