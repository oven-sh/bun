// A field that few objects fill lies outside the cell. `made.alias = alias` with an argument that is mostly undefined must leave an object that is the same to every look as one that holds undefined:
// the key is there, in its place, the value reads undefined, and a later value, deletion, redefinition or freeze finds what it should.

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}
function look(o: object) {
  const own: string[] = [];
  for (const key in o) own.push(key);
  return Object.keys(o).join() + " | " + own.join() + " | " + JSON.stringify(o) + " | " + Object.entries(o).map(([k, v]) => k + "=" + String(v && typeof v === "object" ? "o" : v)).join();
}

class Kind {
  flags: number;
  id: number;
  // Many fields, so that most of them lie outside the cell.
  symbol?: string; target?: Kind; mapper?: (n: number) => number; types?: Kind[]; members?: Map<string, number>; properties?: string[];
  callSignatures?: string[]; constructSignatures?: string[]; indexInfos?: string[]; aliasSymbol?: string; aliasTypeArguments?: Kind[]; origin?: Kind;
  value?: number | string; regular?: Kind; fresh?: Kind; constraint?: Kind; node?: object; pattern?: object; count?: number; done?: boolean; wide?: number;
  // Sixty more, which take the room in the cell: see crowd().
  p00?: Kind; p01?: Kind; p02?: Kind; p03?: Kind; p04?: Kind; p05?: Kind; p06?: Kind; p07?: Kind; p08?: Kind; p09?: Kind; p10?: Kind; p11?: Kind; p12?: Kind; p13?: Kind; p14?: Kind; p15?: Kind; p16?: Kind; p17?: Kind; p18?: Kind; p19?: Kind; p20?: Kind; p21?: Kind; p22?: Kind; p23?: Kind; p24?: Kind; p25?: Kind; p26?: Kind; p27?: Kind; p28?: Kind; p29?: Kind; p30?: Kind; p31?: Kind; p32?: Kind; p33?: Kind; p34?: Kind; p35?: Kind; p36?: Kind; p37?: Kind; p38?: Kind; p39?: Kind; p40?: Kind; p41?: Kind; p42?: Kind; p43?: Kind; p44?: Kind; p45?: Kind; p46?: Kind; p47?: Kind; p48?: Kind; p49?: Kind; p50?: Kind; p51?: Kind; p52?: Kind; p53?: Kind; p54?: Kind; p55?: Kind; p56?: Kind; p57?: Kind; p58?: Kind; p59?: Kind;
  constructor(flags: number) { this.flags = flags; this.id = ++ids; }
}
let ids = 0;

// Reads and stores of the sixty, often, so that they are worth more than the fields under test.
function crowd(one: Kind, other: Kind) {
  if (one.p00 === undefined) one.p00 = other;
  if (one.p01 === undefined) one.p01 = other;
  if (one.p02 === undefined) one.p02 = other;
  if (one.p03 === undefined) one.p03 = other;
  if (one.p04 === undefined) one.p04 = other;
  if (one.p05 === undefined) one.p05 = other;
  if (one.p06 === undefined) one.p06 = other;
  if (one.p07 === undefined) one.p07 = other;
  if (one.p08 === undefined) one.p08 = other;
  if (one.p09 === undefined) one.p09 = other;
  if (one.p10 === undefined) one.p10 = other;
  if (one.p11 === undefined) one.p11 = other;
  if (one.p12 === undefined) one.p12 = other;
  if (one.p13 === undefined) one.p13 = other;
  if (one.p14 === undefined) one.p14 = other;
  if (one.p15 === undefined) one.p15 = other;
  if (one.p16 === undefined) one.p16 = other;
  if (one.p17 === undefined) one.p17 = other;
  if (one.p18 === undefined) one.p18 = other;
  if (one.p19 === undefined) one.p19 = other;
  if (one.p20 === undefined) one.p20 = other;
  if (one.p21 === undefined) one.p21 = other;
  if (one.p22 === undefined) one.p22 = other;
  if (one.p23 === undefined) one.p23 = other;
  if (one.p24 === undefined) one.p24 = other;
  if (one.p25 === undefined) one.p25 = other;
  if (one.p26 === undefined) one.p26 = other;
  if (one.p27 === undefined) one.p27 = other;
  if (one.p28 === undefined) one.p28 = other;
  if (one.p29 === undefined) one.p29 = other;
  if (one.p30 === undefined) one.p30 = other;
  if (one.p31 === undefined) one.p31 = other;
  if (one.p32 === undefined) one.p32 = other;
  if (one.p33 === undefined) one.p33 = other;
  if (one.p34 === undefined) one.p34 = other;
  if (one.p35 === undefined) one.p35 = other;
  if (one.p36 === undefined) one.p36 = other;
  if (one.p37 === undefined) one.p37 = other;
  if (one.p38 === undefined) one.p38 = other;
  if (one.p39 === undefined) one.p39 = other;
  if (one.p40 === undefined) one.p40 = other;
  if (one.p41 === undefined) one.p41 = other;
  if (one.p42 === undefined) one.p42 = other;
  if (one.p43 === undefined) one.p43 = other;
  if (one.p44 === undefined) one.p44 = other;
  if (one.p45 === undefined) one.p45 = other;
  if (one.p46 === undefined) one.p46 = other;
  if (one.p47 === undefined) one.p47 = other;
  if (one.p48 === undefined) one.p48 = other;
  if (one.p49 === undefined) one.p49 = other;
  if (one.p50 === undefined) one.p50 = other;
  if (one.p51 === undefined) one.p51 = other;
  if (one.p52 === undefined) one.p52 = other;
  if (one.p53 === undefined) one.p53 = other;
  if (one.p54 === undefined) one.p54 = other;
  if (one.p55 === undefined) one.p55 = other;
  if (one.p56 === undefined) one.p56 = other;
  if (one.p57 === undefined) one.p57 = other;
  if (one.p58 === undefined) one.p58 = other;
  if (one.p59 === undefined) one.p59 = other;
  return one.p00 === one.p59;
}

function withAlias(flags: number, aliasSymbol: string | undefined, aliasTypeArguments: Kind[] | undefined) {
  const made = new Kind(flags);
  made.aliasSymbol = aliasSymbol;
  made.aliasTypeArguments = aliasTypeArguments;
  return made;
}
function reference(target: Kind, mapper: ((n: number) => number) | undefined, aliasSymbol: string | undefined, aliasTypeArguments: Kind[] | undefined, origin: Kind | undefined) {
  const made = new Kind(4);
  made.target = target;
  made.mapper = mapper;
  made.aliasSymbol = aliasSymbol;
  made.aliasTypeArguments = aliasTypeArguments;
  made.origin = origin;
  return made;
}
function numbers(count: number | undefined, done: boolean | undefined, wide: number | undefined, value: number | string | undefined) {
  const made = new Kind(8);
  made.count = count;
  made.done = done;
  made.wide = wide;
  made.value = value;
  return made;
}

const root = new Kind(1);
{
  let same = 0;
  for (let i = 0; i < 2000; i++) if (crowd(new Kind(i), root)) same++;
  say("crowd", same);
}
{
  const all: Kind[] = [];
  for (let i = 0; i < 400; i++) all.push(withAlias(i, i % 6 ? undefined : "a" + i, i % 9 ? undefined : [root]));
  say("none", look(all[1]));
  say("both", look(all[0]));
  say("first", look(all[6]));
  say("second", look(all[9]));
  say("in", ["aliasSymbol" in all[1], "aliasTypeArguments" in all[1], "origin" in all[1], Object.hasOwn(all[1], "aliasSymbol"), all[1].hasOwnProperty("origin")]);
  say("descriptor", [Object.getOwnPropertyDescriptor(all[1], "aliasSymbol"), Object.getOwnPropertyDescriptor(all[1], "origin") ?? "none"]);
  let have = 0, listed = 0;
  for (const one of all) { if (one.aliasSymbol !== undefined) have++; if ("aliasSymbol" in one) listed++; }
  say("counts", [have, listed]);
  // A value comes later, then undefined again.
  all[1].aliasSymbol = "late"; say("late value", look(all[1]));
  all[1].aliasSymbol = undefined; say("undefined again", look(all[1]));
  all[2].aliasTypeArguments = [root, root]; say("the second alone", look(all[2]));
  delete all[3].aliasSymbol; say("deleted", look(all[3]));
  all[3].aliasSymbol = undefined; say("added behind the others", look(all[3]));
  delete all[4].aliasSymbol; all[4].aliasSymbol = "x"; say("deleted, then a value", look(all[4]));
}
{
  const all: Kind[] = [];
  const twice = (n: number) => n * 2;
  for (let i = 0; i < 400; i++) all.push(reference(root, i % 3 ? twice : undefined, i % 7 ? undefined : "s", i % 7 ? undefined : [], i % 11 ? undefined : root));
  for (const i of [0, 1, 3, 7, 11, 21, 77]) say("reference " + i, look(all[i]));
  let sum = 0;
  for (const one of all) sum += (one.mapper ? one.mapper(one.id) : 1) + (one.origin ? 1000 : 0) + (one.aliasTypeArguments ? 100000 : 0);
  say("sum", sum);
  say("spread", look({ ...all[1] }));
  say("assign", look(Object.assign(new Kind(0), all[1], { id: 0 })));
  say("keys of a copy by hand", Reflect.ownKeys(all[5]).join());
}
{
  const all: Kind[] = [];
  for (let i = 0; i < 300; i++) all.push(numbers(i % 4 ? undefined : i, i % 5 ? undefined : i % 2 === 0, i % 6 ? undefined : i + 0.5, i % 7 ? undefined : i % 14 ? "s" + i : i));
  for (const i of [0, 1, 4, 5, 6, 7, 14, 60, 210]) say("numbers " + i, look(all[i]));
  let total = 0;
  for (const one of all) total += (one.count ?? -1) + (one.done === undefined ? 0 : one.done ? 10 : 20) + (one.wide ?? 0.25) + (typeof one.value === "number" ? one.value : 0);
  say("total", total);
}
// One store alone, of a value that nobody knows before it is read.
{
  const origins: (Kind | undefined)[] = [undefined, root, undefined, undefined];
  const names: (string | undefined)[] = [undefined, undefined, "n"];
  const widths: (number | undefined)[] = [undefined, 1.5, undefined, 7];
  const all: Kind[] = [];
  for (let i = 0; i < 240; i++) {
    const made = new Kind(i);
    made.origin = origins[i % 4];
    all.push(made);
  }
  for (let i = 0; i < 240; i += 2) all[i].aliasSymbol = names[i % 3];
  for (let i = 0; i < 240; i += 3) all[i].wide = widths[i % 4];
  for (let i = 0; i < 240; i += 5) all[i].origin = origins[(i + 1) % 4];
  for (const i of [0, 1, 2, 3, 4, 5, 6, 9, 10, 12, 15, 30, 60, 239]) say("one store " + i, look(all[i]));
  let listed = 0;
  for (const one of all) listed += Object.keys(one).length * 10 + ("wide" in one ? 1 : 0);
  say("listed", listed);
}
// Frozen, sealed, not extensible, redefined: with the field listed and nothing stored for it.
{
  const frozen = Object.freeze(withAlias(1, undefined, undefined));
  let threw = "no";
  try { (frozen as Kind).aliasSymbol = "x"; } catch (error) { threw = (error as Error).constructor.name; }
  say("frozen", [threw, look(frozen), Object.isFrozen(frozen)]);
  const sealed = Object.seal(withAlias(2, undefined, undefined));
  sealed.aliasSymbol = "stored"; threw = "no";
  try { sealed.origin = root; } catch (error) { threw = (error as Error).constructor.name; }
  say("sealed", [threw, look(sealed)]);
  const closed = Object.preventExtensions(withAlias(3, undefined, undefined));
  closed.aliasTypeArguments = [root]; threw = "no";
  try { closed.pattern = {}; } catch (error) { threw = (error as Error).constructor.name; }
  say("not extensible", [threw, look(closed)]);
  const redefined = withAlias(4, undefined, undefined);
  let reads = 0;
  Object.defineProperty(redefined, "aliasSymbol", { get() { return "got" + ++reads; }, enumerable: true, configurable: true });
  say("accessor", [redefined.aliasSymbol, redefined.aliasSymbol, look(redefined)]);
  const hidden = withAlias(5, undefined, undefined);
  Object.defineProperty(hidden, "aliasSymbol", { enumerable: false });
  say("not enumerable", [look(hidden), Object.getOwnPropertyNames(hidden).join(), Object.getOwnPropertyDescriptor(hidden, "aliasSymbol")]);
  const fixed = withAlias(6, undefined, undefined);
  Object.defineProperty(fixed, "aliasTypeArguments", { writable: false }); threw = "no";
  try { fixed.aliasTypeArguments = []; } catch (error) { threw = (error as Error).constructor.name; }
  say("read-only", [threw, look(fixed)]);
}
// By a name that is computed, by Reflect, and kept over collections.
{
  const names = ["aliasSymbol", "origin", "aliasTypeArguments", "node"] as const;
  const kept: Kind[] = [];
  for (let i = 0; i < 3000; i++) {
    const made = withAlias(i, i % 50 ? undefined : "k" + i, undefined);
    const name = names[i % 4];
    if (i % 3 === 0) (made as unknown as Record<string, unknown>)[name] = i % 6 ? undefined : { i };
    if (i % 5 === 0) Reflect.set(made, names[(i + 1) % 4], undefined);
    if (i % 10 === 0) kept.push(made);
  }
  let text = 0;
  for (const one of kept) text += look(one).length;
  say("kept", [kept.length, text, look(kept[3]), look(kept[30]), look(kept[299])]);
}

console.log(lines.join("\n"));
