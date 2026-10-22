// Objects of a typed family, made by a constructor function and a class, read by small typed functions that run hot.
// Each case changes one object by a road on which its type is lost or widened, and the typed readers must see what plain JavaScript sees:
// a cast out of a type parameter, `unknown` and typeof, a list and a Map without a type, a field declared unknown, a function value typed (x: any) => void, `object`,
// a wider structural type, an index signature, a copy loop between two kinds of object, undefined that the types do not admit, a value that fails its check in front of a store, the host's own functions.
declare const console: { log(...values: unknown[]): void };

const lines: string[] = [];
function text(value: unknown): string {
  return JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : typeof v === "bigint" ? "#" + v + "n" : typeof v === "number" && v !== v ? "#NaN" : v);
}
function say(label: string, value: unknown) { lines.push(label + ": " + text(value)); }

interface Kind { flags: number; id: number; name: string; next: Kind | undefined; on: boolean; ratio: number; late?: number; }
const Kind = function (this: Kind, flags: number, id: number) {
  this.flags = flags; this.id = id; this.name = "k" + id; this.next = undefined; this.on = (id & 1) === 1; this.ratio = id / 2;
} as unknown as new (flags: number, id: number) => Kind;
class Mark { constructor(public flags: number, public id: number, public owner: Kind | undefined) {} twice(): number { return this.flags * 2; } }

function flagsOf(kind: Kind): number { return kind.flags; }
function idOf(kind: Kind): number { return kind.id; }
function nameOf(kind: Kind): string { return kind.name; }
function isOn(kind: Kind): boolean { return kind.on; }
function ratioOf(kind: Kind): number { return kind.ratio; }
function nextId(kind: Kind): number { const next = kind.next; return next ? next.id : -1; }
function lateOf(kind: Kind): number { return kind.late ?? -2; }
function hasFlag(kind: Kind, flag: number): boolean { return (kind.flags & flag) !== 0; }
function markFlags(mark: Mark): number { return mark.flags + mark.twice(); }
function ownerId(mark: Mark): number { return mark.owner ? mark.owner.id : -1; }
function show(kind: Kind) { return [flagsOf(kind), idOf(kind), nameOf(kind), isOn(kind), ratioOf(kind), nextId(kind), lateOf(kind), hasFlag(kind, 4), Object.keys(kind).join()]; }
function showMark(mark: Mark) { return [markFlags(mark), ownerId(mark), mark.id, Object.keys(mark).join()]; }

const warm: Kind[] = [], warmMarks: Mark[] = [];
for (let i = 0; i < 300; i++) { const kind = new Kind(i & 15, i); if (i) kind.next = warm[i - 1]; if (i % 3 === 0) kind.late = i; warm.push(kind); warmMarks.push(new Mark(i, i, kind)); }
function tally(): number {
  let t = 0;
  for (const kind of warm) t += flagsOf(kind) + idOf(kind) + nameOf(kind).length + (isOn(kind) ? 1 : 0) + ratioOf(kind) + nextId(kind) + lateOf(kind) + (hasFlag(kind, 2) ? 1 : 0);
  for (const mark of warmMarks) t += markFlags(mark) + ownerId(mark);
  return t;
}
for (let round = 0; round < 60; round++) tally();
say("warm", tally());
let serial = 1000;
function fresh(): Kind { const kind = new Kind(5, serial++); kind.next = warm[7]; return kind; }
const keyOf = (index: number) => ["flags", "id", "name", "next", "on", "ratio", "late"][index % 7];

// A cast out of a type parameter.
function pokeGeneric<T>(value: T, key: string, stored: unknown): T { (value as any)[key] = stored; return value; }
function dropGeneric<T>(value: T, key: string): T { delete (value as any)[key]; return value; }
function through<T>(value: T): T { return value; }
{ const a = fresh(); say("T: a string for flags", show(pokeGeneric(a, keyOf(0), "text"))); say("T: read again", show(through(a))); }
{ const a = fresh(); say("T: id deleted", show(dropGeneric(a, keyOf(1)))); a.id = 77; say("T: id stored again", show(a)); }
{ const a = fresh(); say("T: next is a Mark", [nextIdOrText(pokeGeneric(a, keyOf(3), new Mark(1, 2, undefined)))]); }
function nextIdOrText(kind: Kind): unknown { return nextId(kind); }

// unknown, typeof and a narrowing.
function pokeUnknown(value: unknown, key: string, stored: unknown) { if (typeof value === "object" && value !== null) (value as Record<string, unknown>)[key] = stored; }
function definedOn(value: unknown, key: string) { if (value instanceof Object) Object.defineProperty(value, key, { get() { return 41; }, configurable: true, enumerable: true }); }
{ const a = fresh(); pokeUnknown(a, keyOf(4), "yes"); say("unknown: a string for on", show(a)); }
{ const a = fresh(); definedOn(a, keyOf(0)); say("unknown: a getter for flags", show(a)); }
{ const a = fresh(); pokeUnknown(a, keyOf(5), null); say("unknown: null for ratio", show(a)); }

// A list and a Map whose literals have no type.
{ const list: any[] = []; const a = fresh(); list.push(a); list[0].flags = undefined; say("a list of any", show(a)); }
{ const list = []; const a = fresh(); list.push(a); list.push("text"); const first = list[0]; if (typeof first !== "string") (first as { flags: unknown }).flags = list[1]; say("a list without a type", show(a)); }
{ const map = new Map(); const a = fresh(); map.set(1, a); map.get(1).name = 12; say("a Map without a type", show(a)); delete map.get(1).ratio; say("and a deletion", show(a)); }

// A field declared unknown, read back through another interface.
interface Holder { held: unknown; } interface HolderOfLoose extends Holder { held: { flags: string | number; id: number | undefined }; }
{ const a = fresh(); const holder: Holder = { held: a }; (holder as HolderOfLoose).held.flags = "held"; (holder as HolderOfLoose).held.id = undefined; say("a field declared unknown", show(a)); }

// A function value typed (value: any) => void.
const table: Record<string, (value: any) => void> = { spoil(mark: { flags: string }) { mark.flags = "spoiled"; }, grow(kind: { extra: number }) { kind.extra = 1; } };
{ const a = fresh(); table[["spoil"][0]](a); say("a function typed any", show(a)); const b = fresh(); table[["grow"][0]](b); say("a name more", show(b)); }

// `object`, then a cast.
function identity(kind: Kind): object { return kind; }
{ const a = fresh(); (identity(a) as { on: unknown }).on = 0; say("object and a cast", show(a)); }

// A wider structural type: no cast at all.
function widen(value: { flags: number | string }) { value.flags = "wide"; }
function forget(value: { late?: number; id?: number }) { delete value.id; delete value.late; }
function blank(value: { ratio: number | undefined; next: Kind | Mark | undefined }) { value.ratio = undefined; value.next = new Mark(3, 9, undefined); }
{ const a = fresh(); widen(a); say("a wider field", show(a)); }
{ const a = fresh(); a.late = 3; forget(a); say("an optional view deletes", show(a)); }
{ const a = fresh(); blank(a); say("undefined and another class by a wider view", [flagsOf(a), ratioOf(a), nextId(a)]); }
{ const m = new Mark(2, 3, warm[4]); widen(m); say("a class by a wider view", showMark(m)); }

// An index signature over a type alias.
type Point = { x: number; y: number };
function xOf(point: Point): number { return point.x; } function yOf(point: Point): number { return point.y; }
{ const points: Point[] = []; for (let i = 0; i < 200; i++) points.push({ x: i, y: i * 2 }); let t = 0; for (let r = 0; r < 50; r++) for (const p of points) t += xOf(p) + yOf(p);
  const p: Point = { x: 1, y: 2 }; const loose: Record<string, unknown> = p; loose[["x"][0]] = "ex"; delete loose[["y"][0]]; loose.z = 3; say("an index signature", [t, xOf(p), yOf(p), Object.keys(p).join()]); }

// A copy loop between two kinds of object whose names agree and whose types do not.
interface Other { flags: string; id: number; name: number; extra: boolean }
function copyInto(target: object, source: object) { for (const key in source) (target as any)[key] = (source as any)[key]; }
function copyTyped<T extends object>(target: T, source: T) { for (const key in source) target[key] = source[key]; }
{ const a = fresh(); const other: Other = { flags: "f", id: 3, name: 4, extra: true }; copyInto(a, other); say("a copy loop from another kind", show(a)); }
{ const a = fresh(), b = fresh(); b.late = 8; b.flags = 9; copyTyped(a, b); say("a copy loop from its own kind", show(a)); }
{ const a = fresh(); copyTyped<object>(a, { on: "never", ratio: "none" }); say("a typed copy loop under a wider T", show(a)); }

// undefined that the types do not admit.
{ const numbers: number[] = [1, 2]; const a = fresh(); a.flags = numbers[5]; a.ratio = numbers[9]; say("past the end of a list", show(a)); }
{ const maybe: { n?: number } = {}; const a = fresh(); a.id = maybe.n!; say("x!", show(a)); }
{ class Unset { n!: number; b!: boolean; } const u = new Unset(); const a = fresh(); a.flags = u.n; a.on = u.b; say("a field never set", show(a)); }
{ const made = new Kind(([] as number[])[0], ([] as number[])[1]); say("undefined into the constructor", show(made)); }
{ const m = new Mark(([] as number[])[0], 1, undefined); say("undefined into a class", showMark(m)); }

// A value that fails its check in front of a store.
function setFlags(kind: Kind, flags: number, id: number) { kind.id = id; kind.flags = flags; kind.ratio = flags / 2; }
const parsed: any = JSON.parse('{"text":"seven","nothing":null,"list":[1],"big":4294967296.5}');
for (let i = 0; i < 2000; i++) setFlags(warm[i % 300], i & 15, i % 300);
{ const a = fresh(); setFlags(a, parsed.text, 1); say("a string where a number is declared", show(a)); }
{ const a = fresh(); setFlags(a, parsed.nothing, parsed.missing); say("null and undefined", show(a)); }
{ const a = fresh(); setFlags(a, parsed.list, parsed.big); say("a list and a large fraction", show(a)); }
{ setFlags(parsed, 1, 2); say("another receiver", [parsed.id, parsed.flags, parsed.ratio]); }
{ const m = new Mark(1, 1, undefined); setFlags(m as unknown as Kind, 6, 7); say("a Mark where a Kind is declared", showMark(m)); }

// The host's own functions, reached by a value.
const host = [Object.defineProperty, Object.assign, Object.freeze, Object.setPrototypeOf, Reflect.deleteProperty, Reflect.set, Object.seal, Object.preventExtensions] as Function[];
{ const a = fresh(); host[0](a, keyOf(2), { value: "fixed", writable: false, configurable: true, enumerable: false }); say("defineProperty", show(a)); try { a.name = "new"; } catch (error) { say("store refused", (error as Error).constructor.name); } say("after the store", nameOf(a)); }
{ const a = fresh(); host[1](a, { flags: "assigned", more: 1 }); say("assign", show(a)); }
{ const a = fresh(); host[2](a); try { a.flags = 1; } catch (error) { say("frozen", (error as Error).constructor.name); } try { a.late = 1; } catch (error) { say("frozen, a late name", (error as Error).constructor.name); } say("freeze", show(a)); }
{ const a = fresh(); host[3](a, { late: 99, get flags() { return -1; } }); say("setPrototypeOf", show(a)); host[4](a, keyOf(0)); say("then flags deleted", show(a)); }
{ const a = fresh(); host[5](a, keyOf(1), 1.5); host[5](a, keyOf(4), undefined); say("Reflect.set", show(a)); }
{ const a = fresh(); host[7](a); try { a.late = 4; } catch (error) { say("not extensible", (error as Error).constructor.name); } say("preventExtensions", show(a)); }
{ const child = Object.create(fresh()) as Kind; say("as a prototype", show(child)); child.flags = 12; say("the heir's own", [flagsOf(child), flagsOf(Object.getPrototypeOf(child)), Object.keys(child).join()]); }

// An object seen before its constructor is through.
const seen: unknown[] = [];
const Early = function (this: Kind, id: number) { seen.push(show(this)); this.flags = 1; seen.push(flagsOf(this)); this.id = id; this.name = "e"; this.next = undefined; this.on = true; this.ratio = 0; } as unknown as new (id: number) => Kind;
{ const e = new Early(5); say("seen early", [seen, show(e)]); }

say("the others are as they were", tally());
console.log(lines.join("\n"));
