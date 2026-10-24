// A reference that is stored once the object is out in the world, or never, read by typed code.
// A filled slot is the answer whatever lies above the object. An empty one is undefined only while nothing above the object has the name and the field lies nowhere else.
declare const console: { log(...values: unknown[]): void };

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : v)));
}

interface Links { id: number; type?: Kind; target?: Links; mapper?: (n: number) => number; name?: string; list?: number[]; }
interface Kind { id: number; members?: Map<string, number>; resolved?: Kind; alias?: Links; }
const Links = function (this: Links, id: number) { this.id = id; } as unknown as new (id: number) => Links;
const Kind = function (this: Kind, id: number) { this.id = id; } as unknown as new (id: number) => Kind;

// What is done to the objects from outside is done under names that only the run knows.
const names = ["type", "target", "mapper", "name", "list", "members", "resolved"];
function nameAt(index: number): string { return names[index % names.length]; }
function redefine(object: any, index: number, descriptor: PropertyDescriptor) { Object.defineProperty(object, nameAt(index), descriptor); }
function remove(object: any, index: number) { delete object[nameAt(index)]; }
function put(object: any, index: number, value: unknown) { object[nameAt(index)] = value; }
const TYPE = 0, TARGET = 1, MAPPER = 2, NAME = 3, LIST = 4, MEMBERS = 5;

// Each reads one late field of its argument, as a checker's small functions do.
function typeOf(links: Links): number { const type = links.type; if (type) return type.id; return -1; }
function targetOf(links: Links): Links | undefined { return links.target; }
function membersOf(kind: Kind): number { if (!kind.members) return 0; return kind.members.size; }
function resolve(kind: Kind): Kind { return kind.resolved || (kind.resolved = new Kind(kind.id + 1000)); }
function mapped(links: Links, n: number): number { const mapper = links.mapper; return mapper ? mapper(n) : n; }
function nameOf(links: Links): string { return links.name ?? "none"; }
function firstOf(links: Links): number | undefined { return links.list?.[0]; }
function show(links: Links) { const target = targetOf(links); return [typeOf(links), target === undefined ? "#u" : target === null ? "#n" : (target as any).id ?? String(target), mapped(links, 5), nameOf(links), firstOf(links)]; }

const all: Links[] = [], kinds: Kind[] = [];
for (let i = 0; i < 400; i++) {
  const links = new Links(i), kind = new Kind(i);
  all.push(links); kinds.push(kind);
  if (i % 2) links.type = kind;
  if (i % 3 === 0 && i) links.target = all[i - 1];
  if (i % 5 === 0) links.mapper = n => n * i;
  if (i % 7 === 0) links.name = "n" + i;
  if (i % 11 === 0) links.list = [i, i];
  if (i % 4 === 0) kind.members = new Map([["a", i]]);
}
function tally() {
  let t = 0;
  for (const links of all) { t += typeOf(links) + mapped(links, 2) + nameOf(links).length + (firstOf(links) ?? 3); const target = targetOf(links); if (target) t += target.id; }
  for (const kind of kinds) t += membersOf(kind);
  return t;
}
for (let round = 0; round < 30; round++) tally();
say("tally", tally());
say("some", [0, 1, 3, 5, 7, 11, 15, 35, 77, 385].map(i => show(all[i])));
say("resolve", [resolve(kinds[1]).id, resolve(kinds[1]) === resolve(kinds[1]), resolve(resolve(kinds[2])).id]);

// undefined and null stored by name: the field is there and holds them.
{
  const a = new Links(1000), b = new Links(1001), c = new Links(1002);
  a.type = undefined; a.target = undefined; a.name = undefined; put(b, TYPE, null); put(b, TARGET, null); put(b, NAME, null);
  say("undefined stored", [show(a), "type" in a, Object.keys(a).join(), Object.hasOwn(a, "target")]);
  say("null stored", [show(b), "type" in b, Object.keys(b).join()]);
  say("nothing stored", [show(c), "type" in c, Object.keys(c).join(), Object.hasOwn(c, "target")]);
  a.type = kinds[3]; a.target = b; say("then filled", [show(a), Object.keys(a).join()]);
}
// The field leaves its slot: an accessor, a constant, a deletion.
{
  const a = new Links(2000); a.type = kinds[5]; a.target = all[5]; a.name = "first";
  let reads = 0;
  redefine(a, TYPE, { get() { reads++; return kinds[6]; }, configurable: true, enumerable: true });
  redefine(a, NAME, { value: "fixed", writable: false, configurable: true });
  say("redefined", [show(a), show(a), reads]);
  remove(a, TARGET); remove(a, TYPE); say("deleted", [show(a), Object.keys(a).join()]);
  a.type = kinds[7]; say("stored again", [show(a), Object.keys(a).join()]);
  const empty = new Links(2001);
  redefine(empty, TARGET, { get() { return all[9]; }, configurable: true });
  say("an accessor where nothing was", show(empty));
  const frozen = Object.freeze(new Links(2002)); say("frozen and empty", show(frozen));
  const full = new Links(2003); full.type = kinds[8]; full.name = "kept"; say("frozen and filled", show(Object.freeze(full)));
}
// Other values than the types allow.
{
  const a: any = new Links(3000);
  put(a, TYPE, 5); put(a, TARGET, "text"); put(a, MAPPER, null); put(a, NAME, 7); put(a, LIST, { 0: "zero" });
  let answer: unknown; try { answer = show(a); } catch (error) { answer = (error as Error).constructor.name; }
  say("other values", answer);
}
// The world above the objects changes. What is filled stays; what is empty finds what is above.
{
  const filled = new Links(4000); filled.type = kinds[9]; filled.target = all[1]; filled.name = "own"; filled.mapper = n => n + 1; filled.list = [8];
  const empty = new Links(4001), holdsUndefined = new Links(4002); holdsUndefined.name = undefined; holdsUndefined.target = undefined; holdsUndefined.type = undefined;
  const reparented = new Links(4003), other = new Links(4004);
  say("before", [show(filled), show(empty), show(holdsUndefined)]);
  const parent: any = {}; put(parent, NAME, "from the new parent"); put(parent, TARGET, all[2]); put(parent, TYPE, kinds[10]);
  Object.setPrototypeOf(reparented, parent);
  say("another parent", [show(reparented), show(other), show(filled)]);
  put(Links.prototype, NAME, "from the prototype");
  say("the prototype has the name", [show(filled), show(empty), show(holdsUndefined), show(reparented), nameOf(all[7]), nameOf(all[8])]);
  const top: any = {};
  Object.setPrototypeOf(Links.prototype, top); Object.setPrototypeOf(Kind.prototype, top);
  say("a new top that is empty", [show(filled), show(empty), show(holdsUndefined), membersOf(kinds[5])]);
  redefine(top, TARGET, { get() { return all[3]; }, configurable: true });
  say("an accessor at the top", [show(filled), show(empty), show(holdsUndefined), targetOf(all[3])!.id, targetOf(all[4])!.id]);
  put(top, MEMBERS, new Map([["x", 1], ["y", 2]]));
  say("members at the top", [membersOf(kinds[4]), membersOf(kinds[5])]);
  say("tally above", tally());
  remove(Links.prototype, NAME); remove(top, TARGET); remove(top, MEMBERS);
  say("taken away again", [show(filled), show(empty), show(holdsUndefined), membersOf(kinds[5]), tally()]);
}

// Fields that lie outside the cell, because sixty others took the room in it. One that a store of undefined creates is listed and has no storage: it is there, and it reads as undefined.
{
  interface Crowded { id: number; late?: Kind; later?: Kind; q00?: Kind; q01?: Kind; q02?: Kind; q03?: Kind; q04?: Kind; q05?: Kind; q06?: Kind; q07?: Kind; q08?: Kind; q09?: Kind; q10?: Kind; q11?: Kind; q12?: Kind; q13?: Kind; q14?: Kind; q15?: Kind; q16?: Kind; q17?: Kind; q18?: Kind; q19?: Kind; q20?: Kind; q21?: Kind; q22?: Kind; q23?: Kind; q24?: Kind; q25?: Kind; q26?: Kind; q27?: Kind; q28?: Kind; q29?: Kind; q30?: Kind; q31?: Kind; q32?: Kind; q33?: Kind; q34?: Kind; q35?: Kind; q36?: Kind; q37?: Kind; q38?: Kind; q39?: Kind; q40?: Kind; q41?: Kind; q42?: Kind; q43?: Kind; q44?: Kind; q45?: Kind; q46?: Kind; q47?: Kind; q48?: Kind; q49?: Kind; q50?: Kind; q51?: Kind; q52?: Kind; q53?: Kind; q54?: Kind; q55?: Kind; q56?: Kind; q57?: Kind; q58?: Kind; q59?: Kind; }
  const Crowded = function (this: Crowded, id: number) { this.id = id; } as unknown as new (id: number) => Crowded;
  function crowded(id: number, kind: Kind | undefined): Crowded {
    const one = new Crowded(id);
    if (!kind) return one;
    one.q00 = kind; one.q01 = kind; one.q02 = kind; one.q03 = kind; one.q04 = kind; one.q05 = kind; one.q06 = kind; one.q07 = kind; one.q08 = kind; one.q09 = kind; one.q10 = kind; one.q11 = kind; one.q12 = kind; one.q13 = kind; one.q14 = kind; one.q15 = kind; one.q16 = kind; one.q17 = kind; one.q18 = kind; one.q19 = kind; one.q20 = kind; one.q21 = kind; one.q22 = kind; one.q23 = kind; one.q24 = kind; one.q25 = kind; one.q26 = kind; one.q27 = kind; one.q28 = kind; one.q29 = kind; one.q30 = kind; one.q31 = kind; one.q32 = kind; one.q33 = kind; one.q34 = kind; one.q35 = kind; one.q36 = kind; one.q37 = kind; one.q38 = kind; one.q39 = kind; one.q40 = kind; one.q41 = kind; one.q42 = kind; one.q43 = kind; one.q44 = kind; one.q45 = kind; one.q46 = kind; one.q47 = kind; one.q48 = kind; one.q49 = kind; one.q50 = kind; one.q51 = kind; one.q52 = kind; one.q53 = kind; one.q54 = kind; one.q55 = kind; one.q56 = kind; one.q57 = kind; one.q58 = kind; one.q59 = kind;
    return one;
  }
  function lateOf(one: Crowded): number { const late = one.late; if (late) return late.id; return -1; }
  function laterOf(one: Crowded): Kind | undefined { return one.later; }
  function hasLate(one: Crowded): boolean { return "late" in one; }
  function hasLater(one: Crowded): boolean { return Object.hasOwn(one, "later"); }
  const pool: Crowded[] = [];
  for (let i = 0; i < 300; i++) pool.push(crowded(i, kinds[i]));
  for (let i = 0; i < 300; i++) {
    const one = pool[i];
    if (i % 3 === 0) one.late = kinds[i];
    if (i % 3 === 1) one.late = undefined;
    if (i % 4 === 0) one.later = undefined;
    if (i % 4 === 1) one.later = kinds[i + 1];
  }
  let t = 0, present = 0;
  for (let round = 0; round < 30; round++) for (const one of pool) { t += lateOf(one); const later = laterOf(one); if (later) t += later.id; if (hasLate(one)) present++; if (hasLater(one)) present += 1000; }
  say("outside the cell", [t, present]);
  say("listed without storage", [0, 1, 2, 3, 4, 5].map(i => [lateOf(pool[i]), laterOf(pool[i])?.id, hasLate(pool[i]), hasLater(pool[i]), Object.keys(pool[i]).filter(key => key.startsWith("l")).join()]));
  put(Crowded.prototype, 7, kinds[50]); names.push("late");
  put(Crowded.prototype, 7, kinds[50]);
  say("the prototype has it", [0, 1, 2].map(i => [lateOf(pool[i]), hasLate(pool[i]), Object.hasOwn(pool[i], "late")]));
  remove(Crowded.prototype, 7); remove(Crowded.prototype, 0);
  say("no longer", [0, 1, 2].map(i => [lateOf(pool[i]), hasLate(pool[i])]));
}

console.log(lines.join("\n"));
