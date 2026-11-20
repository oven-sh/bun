// Typed helpers that only reckon with their parameter, called in loops inside loops with elements of parsed lists: what is no number, and a hole, stands at each place of the list in turn.
function plus(v: number): number { return v + 1; }
function minus(v: number): number { return 1 - v; }
function scaled(v: number): number { return (v + 2) * 3; }
function apart(v: number, w: number): number { return v - w + 1; }
function both(v: number, w: number): number { return v + w; }
function less(v: number): boolean { return v + 1 < 8; }
function echo(v: number): string { return (v + 1) + "/" + v; }
function seen(v: number): string { return (v + 1) + typeof v; }
function boxed(v: number): { sum: number; raw: number } { return { sum: v + 1, raw: v }; }
function cut(list: number[]): number { let s = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < list.length; i++) s = (s + plus(list[i]!)) | 0; return s; }
function sum(list: number[]): number { let s = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < list.length; i++) s += minus(list[i]!) + scaled(list[i]!); return s; }
function pairs(list: number[]): number { let s = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < list.length; i++) s = (s + apart(list[i]!, list[i + 1]!)) | 0; return s; }
function sums(list: number[]): number { let s = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < list.length; i++) s = (s + both(list[i]!, list[i + 1]!)) | 0; return s; }
function counted(list: number[]): number { let s = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < list.length + 2; i++) if (less(list[i]!)) s++; return s; }
function texts(list: number[]): string { let s = ""; for (let k = 0; k < 2; k++) for (let i = 0; i < list.length; i++) s = echo(list[i]!) + seen(list[i]!) + s.length; return s; }
function objects(list: number[]): string { let s = 0, none = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < list.length; i++) { const b = boxed(list[i]!); if (b.raw === undefined) none++; else s = (s + b.sum) | 0; } return s + "," + none; }
const shown = (x: unknown): string => typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : String(x);
const odd: [string, unknown][] = [["none", 4], ["undefined", undefined], ["NaN", NaN], ["a fraction", 2.5], ["minus zero", -0], ["past an int32", 2 ** 40], ["endless", Infinity], ["null", null], ["a text", "12"], ["true", true], ["an object", { valueOf() { return 12; } }], ["a hole", 0]];
for (const [what, value] of odd) {
  const said: string[] = [];
  for (let at = 0; at < 12; at++) {
    const list: number[] = JSON.parse("[62,18,5,7,-3,18,62,0,1,9,11,2]");
    if (what === "a hole") delete list[at]; else (list as unknown[])[at] = value;
    said.push([cut(list), sum(list), pairs(list), sums(list), counted(list), texts(list), objects(list)].map(shown).join(" "));
  }
  console.log(what, said.join("; "));
}
const xs: number[] = JSON.parse("[62,18,5,7,-3,18,62,0.5,1,9,11,2]"); let s = 0;
for (let t = 0; t < 4; t++) for (let i = 0; i < xs.length + 1; i++) { const x = xs[i]!; s = (s + plus(x)) | 0; }
console.log(s);
export {};
