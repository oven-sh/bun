// Variables at the top level of a module that hold now an object, now null, undefined, a boolean or a number, stored to from the top level and from functions, with collections in
// between: what a variable holds is alive as long as the variable holds it, and what it held before may go.
const lines: string[] = [];
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
let current: { id: number; text: string } | null = null;
let maybe: string[] | undefined = undefined;
let either: { n: number } | boolean = false;
let numberOrList: number | number[] = 0;
let anything: any = null;
let later: { id: number; text: string } | null = null;
function churn(n: number): number { let kept = 0; for (let i = 0; i < n; i++) { const junk = { i, text: "junk" + i, list: [i, i + 1] }; kept += junk.list.length; } return kept; }
function fill(i: number): void { current = { id: i, text: "current" + i }; maybe = ["m" + i, "n" + i]; either = { n: i }; numberOrList = [i, i * 2]; anything = { deep: { deeper: "any" + i } }; }
function clear(): void { current = null; maybe = undefined; either = true; numberOrList = 7; anything = undefined; }
function show(): string { return [current === null ? "null" : current.id + current.text, maybe === undefined ? "undefined" : maybe.join("+"), typeof either === "boolean" ? String(either) : "n" + either.n, typeof numberOrList === "number" ? String(numberOrList) : numberOrList.join("/"), anything == null || typeof anything === "number" ? String(anything) : anything.deep.deeper, later === null ? "null" : later.text].join(" ");
}
lines.push(show());
for (let round = 0; round < 6; round++) {
  fill(round); churn(20000); collect(); lines.push("filled " + show());
  if (round === 2) later = current;
  clear(); churn(20000); collect(); lines.push("cleared " + show());
  fill(round + 100); lines.push("again " + show()); collect(); churn(5000); lines.push("after " + show());
}
current = null; either = false; numberOrList = 0.5; anything = 3; collect(); lines.push(show());
current = { id: -1, text: "last" }; collect(); churn(30000); collect(); lines.push(show());
console.log(lines.join("\n"));
