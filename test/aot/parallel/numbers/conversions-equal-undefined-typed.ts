// An integer or undefined and the number that it converts to, with their types written: undefined converts to NaN, which equals nothing.
const out: string[] = [];
function say(v: unknown) { out.push(v === true ? "T" : v === false ? "F" : String(v)); }
function line(name: string) { console.log(name, out.join(" ")); out.length = 0; }
const view = new Int32Array([1, 2, 3]);
function views(n: number) { let x: number | undefined; for (let i = 0; i < n; i++) { x = view[i]; say(Number(x) === x); say(x! * 1 === x); say(Math.floor(x!) === x); say(Number(x) === Number(view[i + 1])); say(x === view[i]); } }
function parameter(x: number | undefined, y?: number): boolean { return Number(x) === x || Number(y) === y; }
function parameters() { for (let i = 0; i < 6; i++) { const v = i > 2 ? i : undefined; say(parameter(v)); say(parameter(v, i)); say(Number(v) !== v); const kept = Number(v) === v; say(kept); say(kept ? "equal" : "differ"); } }
class Cell { value: number | undefined; isNumber() { return Number(this.value) === this.value; } }
function fields() { const cell = new Cell(); for (let i = 0; i < 6; i++) { if (i === 3) cell.value = i; say(cell.isNumber()); say(Math.trunc(cell.value!) === cell.value); say(Object.is(Number(cell.value), cell.value)); } }
function optional(n: number) { let first: number | undefined, second: number | undefined; let equal = 0; for (let i = 0; i < n; i++) { if (i === 2) first = i; if (i === 4) second = i - 2; if (first! + 0 === second! + 0) equal++; say(first! + 0 === second); say(first! * 1 === second! * 1); } say(equal); }
views(6); line("views"); parameters(); line("parameters"); fields(); line("fields"); optional(7); line("optional");
