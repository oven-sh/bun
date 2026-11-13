// One place is read twice in a turn that stores: once for a product, once to ask whether anything is there; in either order. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function halves(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function withHoles(n: number): number[] { const list = halves(n); delete list[1]; delete list[n - 1]; list.length = n + 2; return list; }
function tell(name: string, list: number[]) { let there = ""; for (let i = 0; i < list.length; i++) there += i in list ? "x" : "."; told.push(name + ": " + JSON.stringify(list) + " " + there + " " + list.length); }
const factors: number[] = unseen([2, 0.5, 0, -1, NaN, Infinity]);
function productFirst(list: number[], by: number): string { let holes = 0, sum = 0; for (let i = 0; i < list.length; i++) { const product = list[i] * by; if (list[i] === undefined) holes++; else sum += product; list[i] = i + 0.25; } return holes + "," + sum; }
function questionFirst(list: number[], by: number): string { let holes = 0, sum = 0; for (let i = 0; i < list.length; i++) { if (list[i] === undefined) holes++; const product = list[i] * by; if (product === product) sum += product; list[i] = i + 0.25; } return holes + "," + sum; }
for (const by of factors) { const a = withHoles(5); told.push("product first " + by + ": " + productFirst(a, by)); tell("a", a); const b = withHoles(5); told.push("question first " + by + ": " + questionFirst(b, by)); tell("b", b); }
console.log(told.join("\n"));
