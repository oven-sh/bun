// `const [x, ...z] = R` on arrays of `unknown`, `any` and generic element types.
const out: string[] = [];
function unknowns(R: unknown[]): unknown[] { const [x, ...z] = R; return z; }
function anys(R: any[]): any[] { const [x, ...z] = R; return z; }
function generic<T>(R: T[]): T[] { const [x, ...z] = R; return z; }
function two(R: unknown[]): unknown[] { const [x, y, ...z] = R; return z; }
function usesFirst(R: unknown[]): unknown[] { const [x, ...z] = R; z.push(x); return z; }
function usedBehind(R: unknown[]): unknown[] { const [x, ...z] = R; z.push(R.length); return z; }
function all(R: unknown[]): unknown[] { const [...z] = R; return z; }
function skipped(R: unknown[]): unknown[] { const [, ...z] = R; return z; }
function strings(R: string[]): string[] { const [x, ...z] = R; return z; }
function numbers(R: number[]): number[] { const [x, ...z] = R; return z; }
const makers: [string, (R: unknown[]) => unknown[]][] = [["unknowns", unknowns], ["anys", anys], ["generic", generic], ["two", two], ["usesFirst", usesFirst], ["usedBehind", usedBehind], ["all", all], ["skipped", skipped]];
for (const [name, f] of makers) {
    for (const R of [[], [1], [1, 2], [1, 2, 3], ["a", "b", "c", "d", "e", "f", "g", "h", "i"], [1.5, 2.5, 3.5], [, 1, , 2], [{}, null, undefined, "x"]]) out.push(name + " " + R.length + " -> " + JSON.stringify(f(R)));
}
for (const R of [[], ["a"], ["a", "b"], ["a", "b", "c", "d", "e", "f", "g", "h", "i"]]) out.push("strings " + R.length + " -> " + JSON.stringify(strings(R)) + " " + JSON.stringify(generic<string>(R)));
for (const R of [[], [1], [1, 2], [1.5, 2.5, 3.5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) out.push("numbers " + R.length + " -> " + JSON.stringify(numbers(R)) + " " + JSON.stringify(generic<number>(R)));
function rest(first: unknown, ...others: unknown[]): unknown[] { const [x, ...z] = others; return z; }
out.push(JSON.stringify(rest(0)), JSON.stringify(rest(0, 1)), JSON.stringify(rest(0, 1, 2, 3)));
function union(R: (string | number)[] | boolean[]): unknown[] { const [x, ...z] = R; return z; }
out.push(JSON.stringify(union(["a", 1, "b"])), JSON.stringify(union([true, false])));
out.push(String(((R: unknown[]) => { const [x, ...z] = R; return z; })([1, 2, 3]).length));
console.log(out.join("\n"));
