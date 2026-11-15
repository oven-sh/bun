const deep: number = JSON.parse("1000000"), out: string[] = []; type N = number; function hop(t: string, x: () => N) { return t.substring(x(), 4); }
const jumps: any = { substring(left: N): unknown { return left > 0 ? hop(jumps, () => left - 1) : "end"; } };
const grows: any = { substring(left: N): unknown { if (left <= 0) return "end"; const v = hop(grows, () => left - 1); return v === "end" ? v : "odd"; } };
function step(n: N, a: N): N { if (n & 1) return down(n - 1, a + 1); return down(n - 1, a); } function down(n: N, a: N): N { if (n === 0) return a; return step(n, a); }
const table: { go(n: N): N } = { go(n) { return n === 0 ? 0 : by(n - 1); } }; function by(n: N): N { return table.go(n); }
function turn(n: N, a: N, b: N, c: N, d: N, e: N, f: N, g: N, h: N, i: N, j: N, k: N, l: N): string { return n === 0 ? [a, b, c, d, e, f, g, h, i, j, k, l].join() : turn(n - 1, l, k, j, i, h, g, f, e, d, c, b, a); }
const ring: any = { turn(n: N, a: N, b: N, c: N, d: N, e: N, f: N, g: N, h: N, i: N, j: N, k: N, l: N): unknown { return n === 0 ? [a, b, c, d, e, f, g, h, i, j, k, l].join() : ring.turn(n - 1, l, k, j, i, h, g, f, e, d, c, b, a); } };
const rows: Record<string, () => unknown> = { jumps: () => hop(jumps, () => deep), grows: () => hop(grows, () => deep), twoReturns: () => down(deep, 0), byValue: () => by(deep), twelve: () => turn(deep + 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), twelveByValue: () => ring.turn(deep + 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) };
for (const name in rows) { try { out.push(name + " " + String(rows[name]())); } catch (e) { out.push(name + " " + (e as Error).name); } } console.log("SAID " + out.join(" | ")); export {};
