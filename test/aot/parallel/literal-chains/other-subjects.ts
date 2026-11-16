// Comparisons with literals in a row that are no switch over one string: another subject, work between them, a subject that changes, loose comparisons of objects, repeated literals.
class Token { kind: any; constructor(kind: any) { this.kind = kind; } }
const words = ["add", "sub", "mul", "div", "const", "a", "", "other"];
const joined = words.join(" ") + " tail", pieces = joined.split(" ");
const strings: any[] = [...words, ...pieces];
const others: any[] = [0, 1, NaN, null, undefined, true, {}, ["add"], new String("add"), { toString: () => "sub" }, { valueOf: () => "mul" }, 10n, "0", "1", "null"];
const values: any[] = [...strings, ...others];
let count = 0, shared: any = "";
const counted = (x: number): number => { count++; return x; };
const change = (v: any): void => { shared = v; };
function otherSubject(list: any[]): number { let r = 0; for (let j = 0; j < list.length; j++) { const k = list[j], o = list[(j * 3 + 1) % list.length]; if (k === "add") r += 1; else if (o === "sub") r += 2; else if (k === "mul") r += 3; else if (k === "div") r += 4; else r += 5; r = (r * 7) % 1000003; } return r; }
function everyOtherSubject(list: any[]): number { let r = 0; for (let j = 0; j < list.length; j++) { const k = list[j], o = list[(j * 5 + 2) % list.length]; if (k === "add") r += 1; else if (o === "add") r += 2; else if (k === "sub") r += 3; else if (o === "sub") r += 4; else if (k === "mul") r += 5; else if (o === "mul") r += 6; r = (r * 7) % 1000003; } return r; }
function twoFields(list: Token[]): number { let r = 0; for (let j = 0; j < list.length; j++) { const t = list[j]!, u = list[(j + 1) % list.length]!; if (t.kind === "add" || u.kind === "sub" || t.kind === "mul" || u.kind === "div") r += 1; else r += 2; r = (r * 7) % 1000003; } return r; }
function callsBetween(list: any[]): string { let r = 0; count = 0; for (const k of list) { if (k === "add") r += 1; else if ((counted(1), k === "sub")) r += 2; else if ((counted(2), k === "mul")) r += 3; else if ((counted(3), k === "div")) r += 4; r = (r * 7) % 1000003; } return r + "." + count; }
function countsBetween(list: any[]): string { let r = 0, n = 0; for (const k of list) { if (k === "add") r += 1; else if ((n++, k === "sub")) r += 2; else if ((n += 2, k === "mul")) r += 3; else if ((n += 3, k === "div")) r += 4; r = (r * 7 + n) % 1000003; } return r + "." + n; }
function storesBetween(list: Token[]): string { let r = 0; for (const t of list) { const was = t.kind; if (t.kind === "add") r += 1; else if ((t.kind = "mul", t.kind === "sub")) r += 2; else if (t.kind === "mul") r += 3; else if (t.kind === "div") r += 4; r = (r * 7) % 1000003; t.kind = was; } return "" + r; }
function changedBetween(list: any[]): number { let r = 0; for (const v of list) { shared = v; if (shared === "add") r += 1; else if ((change("sub"), shared === "sub")) r += 2; else if (shared === "mul") r += 3; else if (shared === "div") r += 4; r = (r * 7) % 1000003; } return r; }
function assignedBetween(list: any[]): number { let r = 0; for (let j = 0; j < list.length; j++) { let k = list[j]; if (k === "add") r += 1; else if ((k = list[(j + 1) % list.length], k === "sub")) r += 2; else if (k === "mul") r += 3; else if ((k = "div" as any, k === "div")) r += 4; r = (r * 7) % 1000003; } return r; }
function loose(list: any[]): number { let r = 0; for (const k of list) { if (k == "add") r += 1; else if (k == "sub") r += 2; else if (k == "mul") r += 3; else if (k == "1") r += 4; else if (k == "") r += 5; else if (k == "null") r += 6; r = (r * 7) % 1000003; } return r; }
function looseTurned(list: any[]): number { let r = 0; for (const k of list) { if ("add" == k) r += 1; else if ("sub" == k) r += 2; else if ("mul" == k) r += 3; else if ("0" == k) r += 4; r = (r * 7) % 1000003; } return r; }
function looseRepeated(list: any[]): number { let r = 0; for (const k of list) { if (k == "add") r += 1; else if (k == "sub") r += 2; else if (k == "add") r += 3; else if (k == "mul") r += 4; else if (k == "sub") r += 5; r = (r * 7) % 1000003; } return r; }
function repeated(list: any[]): number { let r = 0; for (const k of list) { if (k === "add") r += 1; else if (k === "sub") r += 2; else if (k === "add") r += 3; else if (k === "mul") r += 4; else if (k === "sub") r += 5; else if (k === "div") r += 6; r = (r * 7) % 1000003; } return r; }
function repeatedInOr(list: any[]): number { let r = 0; for (const k of list) { if (k === "add" || k === "sub") r += 1; else if (k === "sub" || k === "mul") r += 2; else if (k === "add" || k === "div") r += 3; else r += 4; r = (r * 7) % 1000003; } return r; }
function notSwitched(list: any[]): number { let r = 0; for (const k of list) { if (!(k === "add")) { if (!(k === "sub")) { if (!(k === "mul")) r += 1; else r += 2; } else r += 3; } else r += 4; r = (r * 7) % 1000003; } return r; }
function carried(list: any[]): number { let r = 0, last = ""; for (const k of list) { let found = 0; if (k === "add") found = 1; else { found = 5; if (k === "sub") found = 2; else { found += last.length; if (k === "mul") found += 3; else found += 4; } } last = k === "div" ? "long" : "s"; r = (r * 7 + found) % 1000003; } return r; }
function fallsThrough(list: any[]): number { let r = 0; for (const k of list) { if (k === "add") r += 1; if (k === "sub") r += 2; if (k === "mul") r += 3; if (k === "add") r += 4; r = (r * 7) % 1000003; } return r; }
const tokens = (): Token[] => values.map(v => new Token(v));
for (let turn = 0; turn < 30; turn++) {
  const line = [otherSubject(values), everyOtherSubject(values), twoFields(tokens()), callsBetween(values), countsBetween(values), storesBetween(tokens()), changedBetween(values), assignedBetween(values), loose(values), looseTurned(values), looseRepeated(values), looseRepeated(strings), repeated(values), repeatedInOr(values), notSwitched(values), carried(values), fallsThrough(values)].join("|");
  if (turn === 0 || turn === 29) console.log(line);
}
