// A counted loop inside a for-of reckons with two rows a turn and does something between them; the second row is now and then something else.
const out: string[] = [], J = JSON.parse, hide = (x: any): any => [x][J("0")];
const say = (name: string, f: () => unknown): void => { try { const v = f(); out.push(name + " " + typeof v + " " + (Object.is(v, -0) ? "-0" : String(v))); } catch (e: any) { out.push(name + " threw " + (e && e.name) + " " + (e && e.message)); } };
let log: string[] = [];
const fractions = (): any[] => J("[[1.5,2.5,3.5],[4.25,5.25,6.25],[7.125,8.125,9.125],[0.5,0.25,0.125]]");
const odd: Record<string, () => any> = {
  none: () => [2.5, 3.5, 4.5], whole: () => [1, 2, 3], holes: () => [1.5, , 3.5], texts: () => ["a", "b", "c"], mixed: () => [1.5, "x", 3], view: () => new Float64Array([1.5, 2.5, 3.5]),
  short: () => [9.5], record: () => ({ 0: 1.5, 1: 2.5, 2: 3.5, length: 3 }), text: () => "123", nan: () => [NaN, -0, Infinity], frozen: () => Object.freeze([1.5, 2.5, 3.5]),
};
const rowsWith = (kind: string, at: number): any[] => { const rows = fractions(); rows.splice(at, 1, odd[kind]!()); return rows; };
const givers: Record<string, (rows: any[]) => any> = {
  list: rows => rows, set: rows => new Set(rows),
  generator: rows => (function* () { try { for (let i = 0; i < rows.length; i++) yield rows[i]; } finally { log.push("finally"); } })(),
};
function turns(given: any, to: any, other: any, acc: any): any { let sum: any = 0; for (const p of given) { for (let c = 0; c < to.length; c++) { const dx = p[0] - to[c][0]; acc[c] = acc[c] + dx; const dy = p[1] - other[c][1]; sum = sum + dx * dy; } } return sum + ":" + acc.join(); }
for (let round = 0; round < 3; round++) {
  for (const giver of Object.keys(givers)) for (const kind of Object.keys(odd)) for (const at of [0, 2, 3]) {
    log = []; say(giver + " " + kind + " " + at, () => turns(hide(givers[giver]!(fractions())), hide(fractions()), hide(rowsWith(kind, at)), hide([0.5, 0.5, 0.5, 0.5]))); out.push(log.join(","));
  }
  if (round < 2) out.length = 0;
}
let hash = 0; for (const line of out) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(out.length, hash); for (const pick of [0, 8, 20, 44, 90, 132]) console.log(out[pick % out.length]);
export {};
