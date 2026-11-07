// A counted loop stands inside a for-of. Its turns reckon with rows of fractions, and now and then meet a row that is something else, a row whose element throws, a break or a
// continue that leaves the for-of. Whatever hands out the rows (a list, an object with next and return, a generator, a set) is closed exactly when plain Bun closes it.
const out: string[] = [], J = JSON.parse, hide = (x: any): any => [x][J("0")];
const say = (name: string, f: () => unknown): void => { try { const v = f(); out.push(name + " " + typeof v + " " + (Object.is(v, -0) ? "-0" : String(v))); } catch (e: any) { out.push(name + " threw " + (e && e.name) + " " + (e && e.message)); } };
let log: string[] = [];
const fractions = (): any[] => J("[[1.5,2.5,3.5],[4.25,5.25,6.25],[7.125,8.125,9.125],[0.5,0.25,0.125]]");
const thrower = (at: number): any => { const row: any[] = [1.5, 2.5, 3.5]; Object.defineProperty(row, at, { get() { log.push("getter " + at); throw new RangeError("element " + at); } }); return row; };
const counting = (at: number): any => { const row: any[] = [1.5, 2.5, 3.5]; let n = 0; Object.defineProperty(row, at, { get() { log.push("read " + ++n); return n; } }); return row; };
const odd: Record<string, () => any> = {
  none: () => [2.5, 3.5, 4.5], whole: () => [1, 2, 3], holes: () => [1.5, , 3.5], texts: () => ["a", "b", "c"], mixed: () => [1.5, "x", 3], view: () => new Float64Array([1.5, 2.5, 3.5]),
  short: () => [9.5], record: () => ({ 0: 1.5, 1: 2.5, 2: 3.5, length: 3 }), text: () => "123", big: () => [1n, 2n, 3n], nan: () => [NaN, -0, Infinity], nothing: () => null, missing: () => undefined,
  throwsFirst: () => thrower(0), throwsLast: () => thrower(2), counts: () => counting(1), frozen: () => Object.freeze([1.5, 2.5, 3.5]),
};
const rowsWith = (kind: string, at: number): any[] => { const rows = fractions(); rows.splice(at, 0, odd[kind]!()); return rows; };
const givers: Record<string, (rows: any[]) => any> = {
  list: rows => rows,
  object: rows => ({ [Symbol.iterator]() { let i = 0; log.push("opened"); return { next() { log.push("next " + i); return i < rows.length ? { value: rows[i++], done: false } : { value: undefined, done: true }; }, return(v: any) { log.push("closed at " + i); return { value: v, done: true }; } }; } }),
  generator: rows => (function* () { try { for (let i = 0; i < rows.length; i++) yield rows[i]; log.push("ran out"); } finally { log.push("finally"); } })(),
  set: rows => new Set(rows),
  closeThrows: rows => ({ [Symbol.iterator]() { let i = 0; return { next() { return i < rows.length ? { value: rows[i++], done: false } : { value: undefined, done: true }; }, return() { log.push("close throws"); throw new EvalError("from return"); } }; } }),
};
function sums(given: any): any { let sum: any = 0; for (const row of given) { for (let j = 0; j < row.length; j++) sum = sum + row[j] * 2; } return sum; }
function distances(given: any, to: any): any { let least: any = Infinity, best = -1, at = 0; for (const p of given) { for (let c = 0; c < to.length; c++) { const dx = p[0] - to[c][0], dy = p[1] - to[c][1], v = dx * dx + dy * dy; if (v < least) { least = v; best = at * 10 + c; } } at++; } return best + ":" + least; }
function leaves(given: any, stop: number): any { let sum: any = 0, seen = 0; outer: for (const row of given) { seen++; for (let j = 0; j < row.length; j++) { if (row[j] > stop) break outer; if (row[j] === 5.25) continue outer; sum = sum + row[j]; } } return seen + ":" + sum; }
function returns(given: any, stop: number): any { let sum: any = 0; for (const row of given) { for (let j = 0; j < row.length; j++) { sum = sum + row[j]; if (sum > stop) return "early " + sum; } } return "late " + sum; }
function caught(given: any): any { let sum: any = 0, misses = 0; for (const row of given) { try { for (let j = 0; j < row.length; j++) sum = sum + row[j] * 2; } catch (e: any) { misses++; sum = sum + 100; } } return misses + ":" + sum; }
function nested(given: any, again: any): any { let sum: any = 0; for (const row of given) { for (const other of again) { for (let j = 0; j < row.length && j < other.length; j++) sum = sum + row[j] * other[j]; } } return sum; }
function stores(given: any): any { let n = 0; for (const row of given) { for (let j = 0; j < row.length; j++) { row[j] = row[j] * 2; n++; } } return n; }
// Each turn does something first and only then reads its rows: a turn that met an odd row may not do it a second time.
function tallies(given: any, to: any, tally: any): any { let sum: any = 0; for (const p of given) { for (let c = 0; c < to.length; c++) { tally.turns = tally.turns + 1; sum = sum + (p[0] - to[c][0]) * (p[1] - to[c][1]); } } return tally.turns + ":" + sum; }
function notes(given: any, to: any, note: any): any { let sum: any = 0; for (const p of given) { for (let c = 0; c < to.length; c++) { note(c); sum = sum + (p[0] - to[c][0]) * (p[1] - to[c][1]); } } return sum; }
for (let round = 0; round < 3; round++) {
  for (const giver of Object.keys(givers)) for (const kind of Object.keys(odd)) for (const at of [0, 2, 4]) {
    const name = giver + " " + kind + " " + at, make = () => hide(givers[giver]!(rowsWith(kind, at)));
    log = []; say("sums " + name, () => sums(make())); out.push(log.join(","));
    log = []; say("distances " + name, () => distances(make(), hide(fractions().slice(0, 3)))); out.push(log.join(","));
    log = []; say("centers " + name, () => distances(hide(fractions()), make() instanceof Array ? make() : hide(rowsWith(kind, at)))); out.push(log.join(","));
    log = []; say("leaves " + name, () => leaves(make(), 8)); out.push(log.join(","));
    log = []; say("returns " + name, () => returns(make(), 20)); out.push(log.join(","));
    log = []; say("caught " + name, () => caught(make())); out.push(log.join(","));
    log = []; say("nested " + name, () => nested(make(), hide(givers[giver]!(fractions())))); out.push(log.join(","));
    log = []; say("stores " + name, () => { const rows = rowsWith(kind, at); const n = stores(hide(givers[giver]!(rows))); return n + ":" + JSON.stringify(rows, (_, v) => typeof v === "bigint" ? v + "n" : v); }); out.push(log.join(","));
    log = []; say("tallies " + name, () => tallies(hide(givers[giver]!(fractions())), hide(rowsWith(kind, at)), hide({ turns: 0 }))); out.push(log.join(","));
    log = []; say("notes " + name, () => notes(hide(givers[giver]!(fractions())), hide(rowsWith(kind, at)), hide((c: number) => { log.push("turn " + c); }))); out.push(log.join(","));
  }
  if (round < 2) out.length = 0;
}
let hash = 0; for (const line of out) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(out.length, hash);
for (const pick of [0, 17, 101, 333, 702, 1201, 1777, 2400, 3001, 3500]) console.log(out[pick % out.length]);
console.log(out.filter(line => line.includes("threw")).length, out.filter(line => line.includes("closed at")).length, out.filter(line => line.includes("finally")).length, out.filter(line => line.includes("close throws")).length);
