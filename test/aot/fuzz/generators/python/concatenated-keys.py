#!/usr/bin/env python3
"""concatenated-keys.py <seed>: KEYS MADE OF PARTS (State::m_keysByParts: the ADDRESSES of the string parts and the integers -> the key's cell; m_cachedKeys: hash -> the key's cell; both swept by removeDeadCachedKeys()): `map.get(`${a}:${i}:${b}`)`, template literals, Set, plain objects by such a key. THE PARTS ARE CELLS OF THEIR OWN EACH TIME, THEY DIE, AND OTHER TEXTS OF THE SAME LENGTH TAKE THEIR ROOM: an entry that outlives a part would answer for another text; one that outlives its key hands out freed memory. A model keyed by texts that are joined another way stands beside."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
words = R.choice([6, 10, 16]); length = R.choice([2, 3, 5])
alphabet = 'abcdefghijklmnopqrstuvwxyz'
texts = []
while len(texts) < words:
    t = ''.join(R.choice(alphabet) for _ in range(length))
    if t not in texts: texts.append(t)
print('''declare const console: { log(...values: unknown[]): void };
const shell: any = globalThis;
const young: () => void = typeof shell.edenGC === "function" ? shell.edenGC : () => shell.Bun.gc(false);
const full: () => void = typeof shell.fullGC === "function" ? shell.fullGC : () => shell.Bun.gc(true);
let state = %d; function next(n: number): number { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
const TEXTS: string[] = [%s];
// a cell of its own each time, flat, never an atom of the program
// FLAT: the lowering (Lowering::concatenateInOnePiece()) sends a part that is a rope the long way round, past the tables: what `+` and slice() make are ropes; join() and JSON.parse() make flat strings.
function fresh(i: number): string { const t = TEXTS[i]!; return next(2) ? t.split("").join("") : JSON.parse('"' + t + '"'); }
const map = new Map<string, number>(); const set = new Set<string>(); const table: Record<string, number> = {};
const model = new Map<string, number>(); const modelSet = new Set<string>(); const modelTable = new Map<string, number>();
const joined = (a: number, i: number, b: number): string => [TEXTS[a], String(i), TEXTS[b]].join(":");
function getOf(a: string, i: number, b: string): number | undefined { return map.get(`${a}:${i}:${b}`); }
function setOf(a: string, i: number, b: string, v: number): void { map.set(`${a}:${i}:${b}`, v); }
function hasOf(a: string, i: number, b: string): boolean { return map.has(`${a}:${i}:${b}`); }
function deleteOf(a: string, i: number, b: string): boolean { return map.delete(`${a}:${i}:${b}`); }
function inSet(a: string, i: number, b: string): boolean { return set.has(`${a}:${i}:${b}`); }
function addTo(a: string, i: number, b: string): void { set.add(`${a}:${i}:${b}`); }
function readTable(a: string, i: number, b: string): number | undefined { return table[`${a}:${i}:${b}`]; }
function writeTable(a: string, i: number, b: string, v: number): void { table[`${a}:${i}:${b}`] = v; }
function made(a: string, i: number, b: string): string { return `${a}:${i}:${b}`; }
let wrong = 0; const junk: string[] = []; const said = (what: string, a: number, i: number, b: number): void => { if (++wrong < 5) console.log("WRONG", what, joined(a, i, b)); };
for (let step = 0; step < 60000; step++) {
  const a = next(TEXTS.length), b = next(TEXTS.length), i = next(4), k = joined(a, i, b);
  switch (next(16)) {
    case 0: case 1: { const v = next(100000); setOf(fresh(a), i, fresh(b), v); model.set(k, v); break; }
    case 2: case 3: case 4: if (getOf(fresh(a), i, fresh(b)) !== model.get(k)) said("get", a, i, b); break;
    case 5: if (hasOf(fresh(a), i, fresh(b)) !== model.has(k)) said("has", a, i, b); break;
    case 6: if (deleteOf(fresh(a), i, fresh(b)) !== model.delete(k)) said("delete", a, i, b); break;
    case 7: addTo(fresh(a), i, fresh(b)); modelSet.add(k); break;
    case 8: if (inSet(fresh(a), i, fresh(b)) !== modelSet.has(k)) said("in the set", a, i, b); break;
    case 9: { const v = next(100000); writeTable(fresh(a), i, fresh(b), v); modelTable.set(k, v); break; }
    case 10: if (readTable(fresh(a), i, fresh(b)) !== modelTable.get(k)) said("the table", a, i, b); break;
    case 11: if (made(fresh(a), i, fresh(b)) !== k) said("made", a, i, b); break;
    case 12: young(); break;
    case 13: { junk.length = 0; for (let n = 0; n < 200; n++) junk.push(fresh(next(TEXTS.length))); if (next(3) === 0) junk.length = 0; break; }
    case 14: if (next(25) === 0) full(); else { young(); for (let n = 0; n < 40; n++) junk.push(fresh(next(TEXTS.length)) + ":" + next(4)); } break;
    default: { const p = fresh(a), q = fresh(b); if (getOf(p, i, q) !== model.get(k) || getOf(p, i, q) !== model.get(k) || hasOf(p, i, q) !== model.has(k)) said("twice by the same cells", a, i, b); break; }
  }
}
let sum = 0; for (const [k, v] of map) { if (model.get(k) !== v) wrong++; sum += v + k.length; } if (map.size !== model.size || set.size !== modelSet.size || Object.keys(table).length !== modelTable.size) wrong++;
console.log("wrong", wrong, "sizes", map.size, set.size, Object.keys(table).length, "sum", sum);''' % (seed * 37 + 11, ', '.join('"%s"' % t for t in texts)))
