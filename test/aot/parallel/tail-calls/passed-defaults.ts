// Parameters with a default that the calls of a function to itself pass on.
const log: string[] = [];
function note(x: number): number { log.push(String(x)); return x; }
function search(list: readonly number[], x: number, lo = 0, hi = list.length - 1): number { if (lo > hi) return -1; const m = Math.floor((lo + hi) / 2); if (list[m] === x) return m; if (list[m]! < x) return search(list, x, m + 1, hi); return search(list, x, lo, m - 1); }
function steps(n: number, step = note(2) + 0, out: number[] = []): number[] { if (n <= 0) return out; out.push(n, step); return steps(n - step, step, out); }
function taken(n: number, a: number | undefined = note(7)): number { return n === 0 ? a! : taken(n - 1, n === 2 ? undefined : a); }
function assigned(n: number, a = 1): number { if (n === 0) return a; a = n === 3 ? (undefined as any) : a + 1; return assigned(n - 1, a); }
function skipped(n: number, a = note(3), b = 4): number { return n === 0 ? a * 10 + b : skipped(n - 1, undefined, b + 1); }
function earlier(n: number, a = n + 1, b = a * 2): number[] { return n === 0 ? [a, b] : earlier(n - 1, a, b + a); }
function again(n: number, a = [n]): number[][] { return n === 0 ? [a] : again(n - 1, a); }
const show = (name: string, f: () => unknown): void => { let answer: string; try { answer = JSON.stringify(f()); } catch (e) { answer = (e as Error).name; } console.log(name, answer, log.join(" ")); log.length = 0; };
const sorted = Array.from({ length: 40 }, (_, i) => i * 3);
show("search", () => [0, 1, 3, 57, 117, 118, -4].map(x => search(sorted, x)));
show("search in part", () => [search(sorted, 57, 20), search(sorted, 57, 0, 18), search(sorted, 57, 0, undefined), search([1.5, 2.5, 4], 4), search([], 1), search(sorted, 57, 0.5, 39)]);
show("steps", () => [steps(5), steps(5, 3), steps(2, 1, [9])]);
show("taken", () => [taken(3), taken(1), taken(3, 1), taken(0, undefined)]);
show("assigned", () => [assigned(5), assigned(2, 5), assigned(0)]);
show("skipped", () => [skipped(0), skipped(2), skipped(2, 8, 9)]);
show("earlier", () => [earlier(0), earlier(3), earlier(3, 1), earlier(2, 1, 1)]);
show("again", () => { const a = again(3), b = again(3); return [a, a[0] === b[0]]; });
