// Loops that compare a counter with the length of a list and then read or store there, while the list keeps, gains or loses elements in between.
const out: string[] = [];
const show = (label: string, value: unknown) => out.push(`${label}: ${JSON.stringify(value)}`);
function doubled(list: number[]): number[] { for (let k = 0; k < list.length; k++) list[k] = list[k]! * 2; return list; }
function turned(list: number[]): number[] { for (let k = 0; list.length > k; k++) list[k] = -list[k]!; return list; }
function shrinksFirst(list: number[]): (number | undefined)[] { const seen: (number | undefined)[] = []; for (let k = 0; k < list.length; k++) { if (k === 1) list.length = 1; seen.push(list[k]); } return seen; }
function popsFirst(list: number[]): number[] { for (let k = 0; k < list.length; k++) { list.pop(); list[k] = 7; } return list; }
function growsBehind(list: number[]): number[] { for (let k = 0; k < list.length && k < 6; k++) { list[k] = k; if (k < 2) list.push(100 + k); } return list; }
function shrunkByCallee(list: number[], cut: (l: number[]) => void): number[] { for (let k = 0; k < list.length; k++) { cut(list); list[k] = 9; } return list; }
function otherList(a: number[], b: number[]): number[] { for (let k = 0; k < a.length; k++) b[k] = a[k]! + 1; return b; }
function sameList(a: number[], b: number[]): number[] { for (let k = 0; k < a.length; k++) { b.length = 0; a[k] = 5; if (k > 3) break; } return a; }
function movedOn(list: number[]): number[] { for (let k = 0; k < list.length; k++) { k++; list[k] = 1; } return list; }
function holes(): unknown[] { const list: unknown[] = new Array(4); for (let k = 0; k < list.length; k++) if (k & 1) list[k] = k; return list; }
function rest(a?: number, b?: number, c?: number): unknown[] { var r = new Array(arguments.length); for (var k = 0; k < r.length; k++) r[k] = arguments[k]; return r; }
function nested(rows: number[][]): number { let sum = 0; for (let r = 0; r < rows.length; r++) { const row = rows[r]!; for (let c = 0; c < row.length; c++) { sum += row[c]!; row[c] = 0; } } return sum; }
function frozen(list: number[]): string { try { for (let k = 0; k < list.length; k++) list[k] = 1; return "stored"; } catch (e) { return (e as Error).constructor.name; } }
function texts(list: string[]): string[] { for (let k = 0; k < list.length; k++) list[k] = list[k]! + k; return list; }
show("doubled", doubled([1, 2, 3])); show("doubled fractions", doubled([0.5, 1.5])); show("doubled none", doubled([]));
show("turned", turned([1, 2, 3]));
show("shrinks first", shrinksFirst([1, 2, 3, 4]));
show("pops first", popsFirst([1, 2, 3, 4, 5]));
show("grows behind", growsBehind([0, 0]));
show("shrunk by callee", shrunkByCallee([1, 2, 3, 4], l => { if (l.length > 2) l.length = 2; }));
show("other list", otherList([1, 2, 3], [])); show("other list longer", otherList([1], [7, 8, 9]));
const shared = [1, 2, 3]; show("same list", sameList(shared, shared));
show("moved on", movedOn([0, 0, 0]));
show("holes", holes()); show("rest", [rest(), rest(1), rest(1, 2, 3)]);
show("nested", nested([[1, 2], [], [3, 4, 5]]));
show("frozen", frozen(Object.freeze([1, 2]) as number[]));
show("texts", texts(["a", "b"]));
let sum = 0;
for (let i = 0; i < 100000; i++) sum += doubled([i & 3, 1, 2])[i % 3]! + (rest(i, 2, 3) as number[]).length;
show("sum", sum);
console.log(out.join("\n"));
