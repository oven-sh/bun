// A number that may be undefined is narrowed on one path out of a branch and not on the other.
function attempt(label: string, f: () => unknown): void { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
const list: number[] = [1, 20, 5]
function isBig(n: number): boolean { return n > 10 }
function twice(n: number): number { return n * 2 }
// `n` gets room: it is handed an element that need not be there.
function byEquality(n: number): number { if (n === 1 || n && !isBig(n)) { return twice(n) } return -1 }
function byTypeof(n: number): number { if (typeof n === "number" && n > 100 || n && !isBig(n)) { return twice(n) } return -1 }
function byUndefined(n: number): number { if (n !== undefined && n < 3 || n && !isBig(n)) { return twice(n) } return -1 }
function inALoop(n: number): number { let total = 0; for (let i = 0; i < 2; i++) { if (n === 1 || n && !isBig(n)) { total += twice(n) } else { total -= 1 } } return total }
function bySwitch(n: number): number { switch (n) { case 1: case 5: return twice(n); default: return -1 } }
for (const at of [0, 1, 2, 9]) {
  attempt("=== " + at, () => byEquality(list[at]))
  attempt("typeof " + at, () => byTypeof(list[at]))
  attempt("!== undefined " + at, () => byUndefined(list[at]))
  attempt("in a loop " + at, () => inALoop(list[at]))
  attempt("switch " + at, () => bySwitch(list[at]))
}
