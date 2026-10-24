// The same for fields that no declaration creates: a constructor function stores one field, and every other key comes into being with its first store, in the order of the stores,
// be the value undefined or not.

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}
function look(o: object) {
  const own: string[] = [];
  for (const key in o) own.push(key);
  return Object.keys(o).join() + " | " + own.join() + " | " + JSON.stringify(o) + " | " + Object.entries(o).map(([k, v]) => k + "=" + String(v && typeof v === "object" ? "o" : v)).join();
}

interface Late {
  flags: number;
  target?: Late; mapper?: (n: number) => number; aliasSymbol?: string; aliasTypeArguments?: Late[]; origin?: Late; count?: number; done?: boolean; wide?: number; value?: number | string;
  // Sixty more, which take the room in the cell: see crowd().
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
// What comes out of an array is no object that was just made, as far as anybody can see.
const pool: Late[] = [];
function fromPool(flags: number) {
  pool.push(new Late(flags));
  return pool[pool.length - 1];
}

function withAlias(flags: number, aliasSymbol: string | undefined, aliasTypeArguments: Late[] | undefined) {
  const made = fromPool(flags);
  made.aliasSymbol = aliasSymbol;
  made.aliasTypeArguments = aliasTypeArguments;
  return made;
}
function reference(target: Late, mapper: ((n: number) => number) | undefined, aliasSymbol: string | undefined, aliasTypeArguments: Late[] | undefined, origin: Late | undefined) {
  const made = fromPool(4);
  made.target = target;
  made.mapper = mapper;
  made.aliasSymbol = aliasSymbol;
  made.aliasTypeArguments = aliasTypeArguments;
  made.origin = origin;
  return made;
}
function backwards(origin: Late | undefined, aliasSymbol: string | undefined, count: number | undefined, target: Late | undefined) {
  const made = fromPool(5);
  made.origin = origin;
  made.count = count;
  made.aliasSymbol = aliasSymbol;
  made.target = target;
  return made;
}
{
  const all: Late[] = [];
  for (let i = 0; i < 400; i++) all.push(withAlias(i, i % 6 ? undefined : "a" + i, i % 9 ? undefined : [root]));
  for (const i of [0, 1, 6, 9, 18]) say("alias " + i, look(all[i]));
  say("in", ["aliasSymbol" in all[1], "aliasTypeArguments" in all[1], "origin" in all[1], Object.hasOwn(all[1], "aliasSymbol"), all[1].hasOwnProperty("origin")]);
  say("descriptor", [Object.getOwnPropertyDescriptor(all[1], "aliasSymbol"), Object.getOwnPropertyDescriptor(all[1], "origin") ?? "none"]);
  all[1].aliasSymbol = "late"; say("late value", look(all[1]));
  all[1].aliasSymbol = undefined; say("undefined again", look(all[1]));
  delete all[3].aliasSymbol; say("deleted", look(all[3]));
  all[3].aliasSymbol = undefined; say("added behind the others", look(all[3]));
  all[5].origin = undefined; all[5].target = root; say("two more", look(all[5]));
}
{
  const twice = (n: number) => n * 2;
  const all: Late[] = [];
  for (let i = 0; i < 400; i++) all.push(reference(root, i % 3 ? twice : undefined, i % 7 ? undefined : "s", i % 7 ? undefined : [], i % 11 ? undefined : root));
  for (const i of [0, 1, 3, 7, 11, 21, 77]) say("reference " + i, look(all[i]));
  const other: Late[] = [];
  for (let i = 0; i < 300; i++) other.push(backwards(i % 2 ? undefined : root, i % 3 ? undefined : "b", i % 5 ? undefined : i, i % 7 ? undefined : root));
  for (const i of [0, 1, 2, 3, 5, 6, 7, 30, 210]) say("backwards " + i, look(other[i]));
  say("spread", look({ ...other[1] }));
  say("own keys", Reflect.ownKeys(other[1]).join());
}
// One store alone, of a value that nobody knows before it is read.
{
  const origins: (Late | undefined)[] = [undefined, root, undefined, undefined];
  const names: (string | undefined)[] = [undefined, undefined, "n"];
  const widths: (number | undefined)[] = [undefined, 1.5, undefined, 7];
  const flags: (boolean | undefined)[] = [undefined, false, undefined, true, undefined];
  const all: Late[] = [];
  for (let i = 0; i < 240; i++) {
    const made = fromPool(i);
    made.origin = origins[i % 4];
    all.push(made);
  }
  for (let i = 0; i < 240; i += 2) all[i].aliasSymbol = names[i % 3];
  for (let i = 0; i < 240; i += 3) all[i].wide = widths[i % 4];
  for (let i = 0; i < 240; i += 4) all[i].done = flags[i % 5];
  for (let i = 0; i < 240; i += 5) all[i].origin = origins[(i + 1) % 4];
  for (const i of [0, 1, 2, 3, 4, 5, 6, 9, 10, 12, 15, 20, 30, 60, 239]) say("one store " + i, look(all[i]));
  let listed = 0;
  for (const one of all) listed += Object.keys(one).length * 10 + ("wide" in one ? 1 : 0) + (one.done === undefined ? 0 : 100);
  say("listed", listed);
}
{
  const frozen = Object.freeze(withAlias(1, undefined, undefined));
  let threw = "no";
  try { (frozen as Late).aliasSymbol = "x"; } catch (error) { threw = (error as Error).constructor.name; }
  say("frozen", [threw, look(frozen)]);
  const closed = Object.preventExtensions(withAlias(3, undefined, undefined));
  closed.aliasTypeArguments = [root]; threw = "no";
  try { closed.origin = undefined; } catch (error) { threw = (error as Error).constructor.name; }
  say("not extensible", [threw, look(closed)]);
  const hidden = withAlias(5, undefined, undefined);
  Object.defineProperty(hidden, "aliasSymbol", { enumerable: false });
  say("not enumerable", [look(hidden), Object.getOwnPropertyNames(hidden).join()]);
}

console.log(lines.join("\n"));
