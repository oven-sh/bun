// References that lie outside the cell of their object, read by code that knows nothing of the object: through `any` and through computed names.
// Objects that hold them, that hold undefined or null there, that never got them, that lost them.

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : v)));
}

interface Late {
  flags: number;
  target?: Late | null; mapper?: (n: number) => number; alias?: string; list?: number[]; origin?: Late; table?: Map<string, number>; text?: string | null; when?: Date;
  // Sixty more, stored right behind the birth: they take the room in the cell.
  q00?: Late; q01?: Late; q02?: Late; q03?: Late; q04?: Late; q05?: Late; q06?: Late; q07?: Late; q08?: Late; q09?: Late; q10?: Late; q11?: Late; q12?: Late; q13?: Late; q14?: Late; q15?: Late; q16?: Late; q17?: Late; q18?: Late; q19?: Late; q20?: Late; q21?: Late; q22?: Late; q23?: Late; q24?: Late; q25?: Late; q26?: Late; q27?: Late; q28?: Late; q29?: Late; q30?: Late; q31?: Late; q32?: Late; q33?: Late; q34?: Late; q35?: Late; q36?: Late; q37?: Late; q38?: Late; q39?: Late; q40?: Late; q41?: Late; q42?: Late; q43?: Late; q44?: Late; q45?: Late; q46?: Late; q47?: Late; q48?: Late; q49?: Late; q50?: Late; q51?: Late; q52?: Late; q53?: Late; q54?: Late; q55?: Late; q56?: Late; q57?: Late; q58?: Late; q59?: Late;
}
const Late = function (this: Late, flags: number) { this.flags = flags; } as unknown as new (flags: number) => Late;
function crowded(flags: number, other: Late | undefined) {
  const one = new Late(flags);
  if (!other) return one;
  one.q00 = other;
  one.q01 = other;
  one.q02 = other;
  one.q03 = other;
  one.q04 = other;
  one.q05 = other;
  one.q06 = other;
  one.q07 = other;
  one.q08 = other;
  one.q09 = other;
  one.q10 = other;
  one.q11 = other;
  one.q12 = other;
  one.q13 = other;
  one.q14 = other;
  one.q15 = other;
  one.q16 = other;
  one.q17 = other;
  one.q18 = other;
  one.q19 = other;
  one.q20 = other;
  one.q21 = other;
  one.q22 = other;
  one.q23 = other;
  one.q24 = other;
  one.q25 = other;
  one.q26 = other;
  one.q27 = other;
  one.q28 = other;
  one.q29 = other;
  one.q30 = other;
  one.q31 = other;
  one.q32 = other;
  one.q33 = other;
  one.q34 = other;
  one.q35 = other;
  one.q36 = other;
  one.q37 = other;
  one.q38 = other;
  one.q39 = other;
  one.q40 = other;
  one.q41 = other;
  one.q42 = other;
  one.q43 = other;
  one.q44 = other;
  one.q45 = other;
  one.q46 = other;
  one.q47 = other;
  one.q48 = other;
  one.q49 = other;
  one.q50 = other;
  one.q51 = other;
  one.q52 = other;
  one.q53 = other;
  one.q54 = other;
  one.q55 = other;
  one.q56 = other;
  one.q57 = other;
  one.q58 = other;
  one.q59 = other;
  return one;
}
const root = crowded(1, undefined);
{
  let same = 0;
  for (let i = 0; i < 2000; i++) { const one = crowded(i, root); if (one.q00 === one.q59) same++; }
  say("crowd", same);
}
const pool: Late[] = [];
function fromPool(flags: number) { pool.push(new Late(flags)); return pool[pool.length - 1]; }
const twice = (n: number) => n * 2;
function fill(i: number) {
  const one = fromPool(i);
  if (i % 2 === 0) one.target = i % 4 === 0 ? root : null;
  if (i % 3 === 0) one.mapper = twice;
  if (i % 5 === 0) one.alias = "a" + i;
  if (i % 7 === 0) one.list = [i, i + 1];
  if (i % 11 === 0) one.origin = one;
  if (i % 13 === 0) one.table = new Map([["k", i]]);
  if (i % 4 === 1) one.text = i % 8 === 1 ? null : "t" + i;
  if (i % 17 === 0) one.when = new Date(i * 1000);
  if (i % 19 === 0) one.alias = undefined;
  return one;
}
// Nothing here says what `o` is.
function show(v: any): unknown { return v === root ? "root" : v instanceof Map ? "map" + v.get("k") : v instanceof Date ? v.getTime() : v && typeof v === "object" && !Array.isArray(v) ? "late" + v.flags : v; }
function readAll(o: any) { return [o.target, o.mapper, o.alias, o.list, o.origin, o.table, o.text, o.when, o.q07, o.missing].map(show); }
function readByKey(o: any, key: string) { return show(o[key]); }
function tally(list: any[]) {
  let n = 0;
  for (const o of list) { if (o.target === root) n++; if (o.target === null) n += 10; if (o.mapper) n += o.mapper(100); if (o.alias !== undefined) n += o.alias.length * 1000; if (o.list) n += o.list[1]; if (o.origin === o) n += 7; if (o.text === null) n += 3; }
  return n;
}
const all: any[] = [];
for (let i = 0; i < 800; i++) all.push(i % 9 === 8 ? { target: "plain", alias: i, list: "no" } : fill(i));
say("tally", tally(all));
for (const i of [0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 13, 17, 19, 20, 21, 35, 38, 57, 60, 95, 143, 420, 799]) say("read " + i, readAll(all[i]));
say("by key", ["target", "mapper", "alias", "list", "origin", "table", "text", "when"].map(key => [readByKey(all[0], key), readByKey(all[1], key), readByKey(all[9], key), readByKey(all[195], key)]));
{
  const one: any = fill(0);
  delete one.target; delete one.alias;
  say("deleted", [readAll(one), "target" in one, Object.keys(one).join()]);
  one.target = root; say("again", [readAll(one), Object.keys(one).join()]);
  one.mapper = 5; one.list = "text"; one.origin = 1.5; one.table = true; say("other values", readAll(one));
  let reads = 0;
  Object.defineProperty(one, "when", { get() { reads++; return "got"; }, configurable: true, enumerable: true });
  say("accessor", [readAll(one), reads]);
  const frozen: any = Object.freeze(fill(0)); say("frozen", readAll(frozen));
  const below: any = Object.create(fill(0)); say("from above", [readAll(below), Object.keys(below).length]);
}
{
  let n = 0;
  for (let round = 0; round < 40; round++) { const fresh: any[] = []; for (let i = 0; i < 400; i++) fresh.push(fill(i + round)); n += tally(fresh); pool.length = 0; }
  say("rounds", n);
}

console.log(lines.join("\n"));
