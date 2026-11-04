// under a try for each entry written any
let log = "";
const noisy = (name: string, text: unknown) => ({ toString() { log += name + "s"; return text; }, valueOf() { log += name + "v"; return text; } });
const lists: unknown[][] = [[1, 2, 3], [0.5, -0, NaN, Infinity, 1e21, 2 ** 31, -7], [], ["a", "", "bb"], [1, "two", 3], [null, undefined, true, false], [1, , 3], [noisy("x", "X"), 2, noisy("y", 7)], [10n, 2], [1, Symbol("s"), 3], [[1, 2], { a: 1 }], [noisy("z", {})]];
function shape(list: any[]): string { let line = ""; try { for (const [, c] of list.entries()) { line += c + ","; } } catch (thrown) { line += "!" + (thrown as Error).name; } return line; }
const keep: unknown = shape;
(globalThis as any).kept = keep;
for (const list of lists) {
    try { console.log(JSON.stringify(shape(list as any))); } catch (thrown) { console.log("caught " + (thrown as Error).name); }
    console.log(JSON.stringify(log)); log = "";
}
console.log(typeof keep);
