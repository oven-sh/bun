(globalThis as any).give = (i: number) => i;
const give: (i: number) => number = (globalThis as any).give;
function inner(limit: number, ...values: number[]): number { let pairs = 0; outer: for (const a of values) { for (const b of values) { if (a + b > limit) continue outer; if (a === b && a > 2) return -pairs; pairs++; } } return pairs; }
for (const k of [0, 1, 2, 9]) console.log(inner(k, give(1), give(2), give(3)));
