// Reads of an array stand on both sides of its sort; literals are sorted; comparators change the array.
interface Row { key: number; name: string }
function numbers(list: number[]): string { const a = list[0], b = list[1], n = list.length; list.sort((x, y) => x - y); return a + "," + b + "," + n + " -> " + list[0] + "," + list[1] + "," + list.length; }
function texts(list: string[]): string { const a = list[0], b = list[1]; list.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); return a + "," + b + " -> " + list[0] + "," + list[1]; }
function rows(list: Row[]): string { const a = list[0], b = list[1]; list.sort((x, y) => x.key - y.key); return a.name + "," + b.name + " -> " + list[0].name + "," + list[1].name + "," + (list[0] === a); }
function inLoop(list: number[]): string { let out = ""; for (let turn = 0; turn < 3; turn++) { const first = list[0]; list.sort((x, y) => (turn & 1 ? x - y : y - x)); out += first + ">" + list[0] + ";"; } return out; }
function literal(): number[] { return [3.5, 1.5, 2.5, 0.5]; }
function literalOfIntegers(): number[] { return [3, 1, 2, 0]; }
function literalOfTexts(): string[] { return ["c", "a", "b"]; }
function shortened(list: number[]): string { let calls = 0; list.sort((x, y) => { if (++calls === 2) list.length = 1; return x - y; }); return list.join() + "|" + list.length; }
function emptied(list: Row[]): string { let calls = 0; list.sort((x, y) => { if (++calls === 2) list.length = 0; return x.key - y.key; }); return list.map(r => r.name).join() + "|" + list.length; }
function changedKind(list: number[]): string { let calls = 0; list.sort((x, y) => { if (++calls === 2) (list as unknown[]).push({}); return x - y; }); return list.length + "|" + typeof (list as unknown[])[list.length - 1] + "|" + list.slice(0, 4).join(); }
function madeSparse(list: number[]): string { let calls = 0; list.sort((x, y) => { if (++calls === 2) list[100000] = 1; return x - y; }); return list.length + "|" + list.slice(0, 5).join(); }
function frozenMeanwhile(list: number[]): string { let calls = 0; try { list.sort((x, y) => { if (++calls === 2) Object.freeze(list); return x - y; }); } catch (e) { return (e as Error).constructor.name + "|" + list.join(); } return list.join(); }
for (let turn = 0; turn < 3; turn++) {
  console.log(numbers([5, 3, 9, 1]), numbers([5.5, 3.5, 9.5, 1.5]), numbers(literal()), numbers(literalOfIntegers()), literal().join(), literalOfIntegers().join());
  console.log(texts(["q", "b", "z", "a"]), texts(literalOfTexts()), literalOfTexts().join());
  console.log(rows([{ key: 3, name: "three" }, { key: 1, name: "one" }, { key: 2, name: "two" }]));
  console.log(inLoop([4, 8, 2, 6]), inLoop([4.5, 8.5, 2.5, 6.5]));
  console.log(shortened([5, 3, 9, 1, 7]), shortened([5.5, 3.5, 9.5, 1.5, 7.5]), emptied([{ key: 3, name: "three" }, { key: 1, name: "one" }, { key: 2, name: "two" }]));
  console.log(changedKind([5, 3, 9, 1]), changedKind([5.5, 3.5, 9.5, 1.5]), madeSparse([5, 3, 9, 1]), madeSparse([5.5, 3.5, 9.5, 1.5]), frozenMeanwhile([5, 3, 9, 1]), frozenMeanwhile([5.5, 3.5, 9.5, 1.5]));
}
