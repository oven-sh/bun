#!/usr/bin/env python3
"""collected-keys.py <seed>: `x[key] = v` and `x[key]` on a typed object are remembered by the key's cell. Here: keys that are made anew each time, die, and whose room is taken by OTHER texts: a remembered entry that outlives its key would send a store or a read to another field. Typed records of several layouts, one site each for stores and reads, a model beside; collections of the young and full ones between; wrong values behind right ones (they must be refused and change nothing)."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
n = R.choice([4, 6, 9]); names = ['f%d' % i for i in range(n)]
kinds = [R.choice(['number', 'whole', 'string', 'boolean', 'ref']) for _ in names]
ty = {'number': 'number', 'whole': 'number', 'string': 'string', 'boolean': 'boolean', 'ref': 'Leaf | null'}
init = {'number': '0.5', 'whole': '1', 'string': '"s"', 'boolean': 'false', 'ref': 'null'}
print('''declare const console: { log(...values: unknown[]): void };
const shell: any = globalThis;
const young: () => void = typeof shell.edenGC === "function" ? shell.edenGC : () => shell.Bun.gc(false);
const full: () => void = typeof shell.fullGC === "function" ? shell.fullGC : () => shell.Bun.gc(true);
let state = %d; function next(n: number): number { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
class Leaf { constructor(public id: number) {} }
interface Row { %s }
class Kept implements Row { %s }
const literal = (): Row => ({ %s });
const rows: Row[] = []; for (let i = 0; i < 8; i++) rows.push(i & 1 ? literal() : new Kept());
const NAMES = [%s]; const KINDS = [%s];
const model: string[][] = rows.map(() => NAMES.map(() => ""));
const show = (v: unknown): string => v instanceof Leaf ? "leaf " + v.id : typeof v + ":" + String(v);
function put(o: any, key: string, v: unknown): void { o[key] = v; }
function get(o: any, key: string): unknown { return o[key]; }
function has(o: any, key: string): boolean { return key in o; }
// a key that is a cell of its own each time: never an atom of the program, flat by the time it is used
// in three forms: a substring (a rope until it is resolved), and two FLAT ones (join, JSON.parse): a stub may send a rope another way than a flat string
function makeKey(i: number): string { const digits = String(i); switch (next(3)) { case 0: return ("ff" + digits).slice(1); case 1: return ["f", digits].join(""); default: return JSON.parse('"f' + digits + '"'); } }
function anotherText(): string { const n = next(1000); switch (next(3)) { case 0: return ("gg" + n).slice(1) + "x"; case 1: return ["g", String(n %% 10)].join(""); default: return JSON.parse('"h' + (n %% 10) + '"'); } }
function right(kind: string): unknown { switch (kind) { case "number": return next(1000) + 0.25; case "whole": return next(1000); case "string": return "t" + next(1000); case "boolean": return next(2) === 1; default: return next(3) ? new Leaf(next(1000)) : null; } }
function wrong(kind: string): unknown { switch (kind) { case "number": case "whole": return "not a number"; case "string": return 5; case "boolean": return "yes"; default: return 7; } }
for (let r = 0; r < rows.length; r++) for (let i = 0; i < NAMES.length; i++) model[r]![i] = show(get(rows[r], NAMES[i]!));
let wrongAnswers = 0, refused = 0, taken = 0, steps = 0; const junk: string[] = [];
const POOL = 6; const pool: string[] = [], indexInPool: number[] = []; for (let s = 0; s < POOL; s++) { indexInPool.push(s < NAMES.length ? s : 0); pool.push(makeKey(indexInPool[s]!)); }
for (let step = 0; step < 40000; step++) {
  const r = next(rows.length); let i = next(NAMES.length); steps++;
  // A KEY THAT LIVES FOR A WHILE: a key made for one use never enters the keyed tables (they go by the key's CELL and are filled at the second sight): a pool of key cells, each used some dozens of times, then dropped: its room goes to a key of ANOTHER text
  if (next(40) === 0) { const s = next(POOL); indexInPool[s] = next(NAMES.length); pool[s] = makeKey(indexInPool[s]!); }
  const slot = next(POOL), pooled = next(3) !== 0; if (pooled) i = indexInPool[slot]!;
  const keyNow = (): string => pooled ? pool[slot]! : makeKey(i);
  switch (next(12)) {
    case 0: case 1: case 2: case 3: { const v = right(KINDS[i]!); put(rows[r], keyNow(), v); model[r]![i] = show(v); break; }
    case 4: case 5: case 6: { if (show(get(rows[r], keyNow())) !== model[r]![i]) { wrongAnswers++; if (wrongAnswers < 4) console.log("WRONG read", r, NAMES[i], show(get(rows[r], NAMES[i]!)), model[r]![i]); } break; }
    case 7: { try { put(rows[r], keyNow(), wrong(KINDS[i]!)); taken++; } catch { refused++; } const v = right(KINDS[i]!); put(rows[r], keyNow(), v); model[r]![i] = show(v); break; }
    case 8: young(); break;
    case 9: { junk.length = 0; for (let k = 0; k < 300; k++) junk.push(anotherText()); if (next(4) === 0) junk.length = 0; break; }
    case 10: { if (next(20) === 0) full(); else { young(); for (let k = 0; k < 50; k++) junk.push(anotherText()); } break; }
    default: { const k = anotherText(); if (has(rows[r], k) || get(rows[r], k) !== undefined) wrongAnswers++; if (!has(rows[r], keyNow())) wrongAnswers++; break; }
  }
}
for (let r = 0; r < rows.length; r++) for (let i = 0; i < NAMES.length; i++) if (show(get(rows[r], NAMES[i]!)) !== model[r]![i]) wrongAnswers++;
console.log("steps", steps, "wrong answers", wrongAnswers, "sum", model.map(m => m.join()).join("|").length, JSON.stringify(rows[0]), JSON.stringify(rows[1]));
console.log("wrong values: taken or refused", taken + refused);''' % (seed * 31 + 7, '; '.join('%s: %s' % (a, ty[k]) for a, k in zip(names, kinds)), ' '.join('%s: %s = %s;' % (a, ty[k], init[k]) for a, k in zip(names, kinds)), ', '.join('%s: %s' % (a, init[k]) for a, k in zip(names, kinds)), ', '.join('"%s"' % a for a in names), ', '.join('"%s"' % k for k in kinds)))
