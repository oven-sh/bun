// RUN: lower
// OPTIONS: builtin-modules

// Objects of a typed family, made by a constructor function and a class, read by small typed functions that run hot.
// Each case carries one object into a place whose type says nothing, or brings a value out of such a place into a typed field, BY A KIND OF SYNTAX OF ITS OWN:
// yield, yield*, next(v), the result of a generator, an assignment to a pattern, a for-of with a target that is no declaration, getters and setters, a spread in an object literal,
// `arguments`, class fields, parameter properties, destructured parameters and their defaults, a variable without an initializer, a catch parameter, a tagged template,
// a logical assignment, a function value that comes out of `any`, a method of an object that comes out of `any`. The typed readers must see what plain JavaScript sees.
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
const parsed: any = JSON.parse('{"text":"seven","nothing":null,"list":[1],"big":4294967296.5,"flags":"parsed flags","id":"parsed id"}');

// Generators.
function* yieldsIt(kind: Kind): Generator<any> { yield kind; }
function* delegates(kind: Kind): Generator<any> { yield* yieldsIt(kind); }
function* takesIt(): Generator<number, void, any> { const got = yield 1; got.name = 7; }
function* returnsIt(kind: Kind): Generator<number, any> { yield 1; return kind; }
function* yieldsList(kind: Kind): Generator<unknown[]> { yield [kind]; }
{ const a = fresh(); for (const x of yieldsIt(a)) x.flags = "yielded"; say("yield", show(a)); }
{ const a = fresh(); for (const x of delegates(a)) delete x.id; say("yield*", show(a)); }
{ const a = fresh(); const g = takesIt(); g.next(); g.next(a); say("next(v)", show(a)); }
{ const a = fresh(); const g = returnsIt(a); g.next(); g.next().value.on = "returned"; say("the result of a generator", show(a)); }
{ function* yieldsLoose(): Generator<Kind, void, void> { yield parsed; } const a = fresh(); for (const x of yieldsLoose()) a.next = x; say("a value nobody knows is yielded as a Kind", [nextId(a)]); }
{ const a = fresh(); for (const list of yieldsList(a)) (list[0] as { ratio: unknown }).ratio = "in a yielded list"; say("a list is yielded", show(a)); }
{ const a = fresh(); const [x] = yieldsIt(a); x.flags = null; say("a pattern takes what is yielded", show(a)); }
{ const a = fresh(); const all = [...yieldsIt(a)]; all[0].id = "spread of a generator"; say("a spread takes what is yielded", show(a)); }

// An assignment to a pattern.
{ const a = fresh(); let x: any; [x] = [a]; x.flags = "pattern"; say("[x] = [a]", show(a)); }
{ const a = fresh(); let x: any; ({ held: x } = { held: a }); x.ratio = "pattern"; say("({ held: x } = ..)", show(a)); }
{ const a = fresh(); let x: any, rest: any[]; [x, ...rest] = [1, a]; rest[0].id = undefined; say("[x, ...rest] = ..", [x, show(a)]); }
{ const a = fresh(); let rest: any; ({ one: {}, ...rest } = { one: {}, two: a }); rest.two.name = 2; say("({ ...rest } = ..)", show(a)); }
{ const a = fresh(); const box: { any: any } = { any: 0 }; [box.any] = [a]; box.any.on = 3; say("a member is the target in a pattern", show(a)); }
{ const a = fresh(); let x: any; [x = a] = []; x.name = null; say("a default in an assignment pattern", show(a)); }
{ const a = fresh(); let x: any; ({ x = a } = {} as { x?: Kind }); x.flags = "shorthand default"; say("a default behind a shorthand", show(a)); }
{ const a = fresh(); [a.next] = [parsed]; say("a typed field is the target, the value comes out of any", [nextId(a)]); }
{ const a = fresh(); ({ flags: a.flags, id: a.id } = parsed); say("typed fields take members of a value nobody knows", show(a)); }
{ const a = fresh(); let x: any; [[x]] = [[a]]; delete x.ratio; say("a pattern in a pattern", show(a)); }

// for-of and for-in with a target that is no declaration.
{ const a = fresh(); let x: any; for (x of [a]) x.flags = "for-of target"; say("for (x of ..)", show(a)); }
{ const a = fresh(); const box: { any: any } = { any: 0 }; for (box.any of [a]); box.any.id = "for-of member"; say("for (box.any of ..)", show(a)); }
{ const a = fresh(); for (a.next of [parsed] as Kind[]); say("for (a.next of ..)", [nextId(a)]); }
{ const a = fresh(); let x: any; for ([x] of [[a]]) x.on = "for-of pattern"; say("for ([x] of ..)", show(a)); }
{ const a = fresh(); for (const { held } of [{ held: a as any }]) held.name = 5; say("for (const { held } of ..)", show(a)); }

// Getters and setters.
class Door { constructor(private kept: Kind) {} get open(): any { return this.kept; } set shut(value: any) { value.flags = "set"; } }
const literalDoor = { kept: undefined as Kind | undefined, get open(): any { return this.kept; }, set shut(value: any) { value.id = "literal setter"; } };
class Swap { #value: unknown; get value(): Kind { return this.#value as Kind; } set value(value: unknown) { this.#value = value; } }
class Narrow { constructor(private kind: Kind) {} set flags(value: number | string) { (this.kind as { flags: unknown }).flags = value; } get flags(): number { return this.kind.flags; } }
{ const a = fresh(); new Door(a).open.flags = "got"; say("a getter that says nothing", show(a)); }
{ const a = fresh(); new Door(fresh()).shut = a; say("a setter that says nothing", show(a)); }
{ const a = fresh(); literalDoor.kept = a; literalDoor.open.name = 1; say("a getter of a literal", show(a)); }
{ const a = fresh(); literalDoor.shut = a; say("a setter of a literal", show(a)); }
{ const a = fresh(); const swap = new Swap(); swap.value = new Mark(1, 2, undefined); a.next = swap.value; say("a setter takes more than the getter gives", [nextId(a)]); }
{ const a = fresh(); new Narrow(a).flags = "through a wider setter"; say("a wider setter", show(a)); }

// A spread in an object literal.
interface Plain { flags: number; id: number; }
function plainFlags(plain: Plain): number { return plain.flags; } function plainId(plain: Plain): number { return plain.id; }
{ let t = 0; for (let i = 0; i < 3000; i++) { const p: Plain = { flags: i, id: i }; t += plainFlags(p) + plainId(p); } say("plain, warm", t); }
{ const a = fresh(); const copy: any = { ...{ held: a } }; copy.held.flags = "spread"; say("a spread into a place that says nothing", show(a)); }
{ const p: Plain = { ...parsed }; say("a value nobody knows is spread into a typed literal", [plainFlags(p), plainId(p)]); }
{ const p: Plain = { flags: 1, id: 2, ...(parsed as Partial<Plain>) }; say("and behind the names", [plainFlags(p), plainId(p)]); }
{ const a = fresh(); const holder: { held: unknown } = { ...{ held: a } }; (holder.held as { on: unknown }).on = "held"; say("a spread into a field declared unknown", show(a)); }
{ const a = fresh(); const wide: { flags: number | string } = { flags: "wide" }; const mixed = { ...a, ...wide }; say("a spread over a copy leaves the object alone", [show(a), mixed.flags]); }

// `arguments`.
function spoilFirst(x: any) { x.id = "applied"; }
{ function viaArguments(kind: Kind) { arguments[0].flags = "arguments"; return kind; } const a = fresh(); say("arguments[0]", show(viaArguments(a))); }
{ function passArguments(kind: Kind) { spoilFirst.apply(undefined, arguments as any); return kind; } const a = fresh(); say("apply(.., arguments)", show(passArguments(a))); }
{ function listOfArguments(kind: Kind): any[] { return Array.prototype.slice.call(arguments); } const a = fresh(); listOfArguments(a)[0].name = 0; say("slice.call(arguments)", show(a)); }
{ function spreadArguments(kind: Kind) { spoilFirst(...(arguments as unknown as [any])); return kind; } const a = fresh(); say("...arguments", show(spreadArguments(a))); }

// Class fields and parameter properties.
interface HasFlags { flags: number; }
function fieldedFlags(fielded: HasFlags): number { return fielded.flags; }
class Propertied { constructor(public flags: number, public owner: Kind) {} }
function propertiedFlags(p: Propertied): number { return p.flags; }
class FieldKeeper { constructor(public kept: any) {} }
class InitKeeper { static last: Kind | undefined; kept: any = InitKeeper.last; }
class StaticKeeper { static kept: any; static { StaticKeeper.kept = undefined; } }
{ let t = 0; for (let i = 0; i < 2000; i++) t += propertiedFlags(new Propertied(i, warm[i % 300])); class Fielded { flags: number = parsed.text; id = 1; } say("a class field from a value nobody knows", [t, fieldedFlags(new Fielded())]); }
{ const a = fresh(); say("a parameter property from a value nobody knows", [propertiedFlags(new Propertied(parsed.text, a))]); }
{ const a = fresh(); new FieldKeeper(a).kept.flags = "parameter property"; say("a parameter property that says nothing", show(a)); }
{ const a = fresh(); InitKeeper.last = a; new InitKeeper().kept.id = "field initializer"; say("a field initializer into a field that says nothing", show(a)); }
{ const a = fresh(); StaticKeeper.kept = a; StaticKeeper.kept.on = "static"; say("a static field that says nothing", show(a)); }
{ class OwnerField { owner: Kind = parsed; } const a = fresh(); a.next = new OwnerField().owner; say("a field of a declared type is initialized from a value nobody knows", [nextId(a)]); }

// Destructured parameters and their defaults.
let lastKind: Kind = warm[3];
function takeApart({ held }: { held: any }) { held.flags = "destructured"; }
function takeList([first]: any[]) { first.id = "list pattern"; }
function takeNested({ box: { held } }: { box: { held: any } }) { delete held.ratio; }
function takeRest({ one, ...others }: { one: number; two: any }) { others.two.flags = one; others.two.name = one; }
function storeApart(kind: Kind, { flags, id }: { flags: number; id: number }) { kind.flags = flags; kind.id = id; }
{ const a = fresh(); takeApart({ held: a }); say("a destructured parameter", show(a)); }
{ const a = fresh(); takeList([a]); say("a list pattern as a parameter", show(a)); }
{ function takeDefault({ held = lastKind }: { held?: any }) { held.name = 9; } const a = fresh(); lastKind = a; takeDefault({}); say("a default in a destructured parameter", show(a)); lastKind = warm[3]; }
{ function takeWholeDefault(held: any = lastKind) { held.on = "a default"; } const a = fresh(); lastKind = a; takeWholeDefault(); say("a default of a parameter", show(a)); lastKind = warm[3]; }
{ const a = fresh(); takeNested({ box: { held: a } }); say("a pattern in a pattern as a parameter", show(a)); }
{ const a = fresh(); takeRest({ one: 1, two: a }); say("the rest of a destructured parameter", show(a)); }
{ const a = fresh(); storeApart(a, parsed); say("what a pattern takes out of a value nobody knows is stored", show(a)); }
{ function storeListApart(kind: Kind, [flags]: number[]) { kind.flags = flags; } const a = fresh(); storeListApart(a, []); say("what a list pattern finds past the end is stored", show(a)); }
{ function storeDefault(kind: Kind, { flags = parsed.text }: { flags?: number }) { kind.flags = flags; } const a = fresh(); storeDefault(a, {}); say("a default that nobody knows is stored", show(a)); }

// A variable without an initializer.
{ const a = fresh(); let late: number; const store = () => { a.flags = late; }; store(); late = 1; say("a variable is read before it is assigned", show(a)); }
{ const a = fresh(); var hoisted: boolean; a.on = hoisted!; say("a var without an initializer", show(a)); }
{ const a = fresh(); let kind!: Kind; a.next = kind; a.id = (kind as Kind | undefined)?.id!; say("let x!: T", show(a)); }

// What is thrown is caught.
function throwIt(value: unknown): never { throw value; }
{ const a = fresh(); try { throw a; } catch (e: any) { e.flags = "caught"; } say("catch (e: any)", show(a)); }
{ const a = fresh(); try { throwIt(a); } catch (e) { (e as { id: unknown }).id = "caught below"; } say("thrown by a callee", show(a)); }
{ const a = fresh(); try { throw { held: a }; } catch ({ held }: any) { held.name = 4; } say("a pattern as the catch parameter", show(a)); }
{ const a = fresh(); try { try { throw a; } finally { say("finally", 1); } } catch (e) { delete (e as { on?: unknown }).on; } say("through a finally", show(a)); }

// Tagged templates, logical assignments, chains, commas.
function tag(strings: TemplateStringsArray, value: any) { value.flags = strings[0]; return value; }
{ const a = fresh(); tag`tagged${a}`; say("a tagged template", show(a)); }
{ const a = fresh(); let x: any; x ||= a; x.id = "||="; say("x ||= a", show(a)); }
{ const a = fresh(); let x: any = null; x ??= a; x.name = 8; say("x ??= a", show(a)); }
{ const a = fresh(); let x: any = 1; x &&= a; x.on = "&&="; say("x &&= a", show(a)); }
{ const a = fresh(); const box: { any?: any } = {}; box.any ??= a; box.any.ratio = "member ??="; say("box.any ??= a", show(a)); }
{ const a = fresh(); const maybe: { spoil?: (x: any) => void } = { spoil: spoilFirst }; maybe.spoil?.(a); say("an optional call", show(a)); }
{ const a = fresh(); a.flags ||= parsed.text; a.flags = 0; a.flags ||= parsed.text; say("a typed field ||= a value nobody knows", show(a)); }

// Lists, Maps, Sets and promises of a declared type take a value nobody knows and hand it on as what they declare.
function restOf(...kinds: Kind[]): Kind { return kinds[0]; }
{ const a = fresh(); const list: Kind[] = []; list.push(parsed); a.next = list[0]; say("push", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = []; list.unshift(parsed); a.next = list[0]; say("unshift", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = [warm[1]]; list.splice(0, 1, parsed); a.next = list[0]; say("splice", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = [warm[1]]; list.fill(parsed); a.next = list[0]; say("fill", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = [parsed]; a.next = list[0]; say("a list literal", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = [...[parsed]]; a.next = list[0]; say("a spread in a list literal", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = []; list[0] = parsed; a.next = list[0]; say("list[0] = v", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = ([] as Kind[]).concat(parsed); a.next = list[0]; say("concat", [nextId(a)]); }
{ const a = fresh(); const map = new Map<number, Kind>(); map.set(1, parsed); a.next = map.get(1); say("Map.set", [nextId(a)]); }
{ const a = fresh(); const map = new Map<number, Kind>([[1, parsed]]); a.next = map.get(1); say("new Map(entries)", [nextId(a)]); }
{ const a = fresh(); const set = new Set<Kind>(); set.add(parsed); for (const x of set) a.next = x; say("Set.add", [nextId(a)]); }
{ const a = fresh(); a.next = restOf(parsed); say("a rest parameter", [nextId(a)]); }
{ const a = fresh(); a.next = restOf(...[parsed]); say("a spread into a rest parameter", [nextId(a)]); }
{ const a = fresh(); const numbers: number[] = []; numbers.push(parsed.text); a.flags = numbers[0]; say("a list of numbers", show(a)); }
{ const a = fresh(); const list: Kind[] = Array.from([parsed]); a.next = list[0]; say("Array.from", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = Array.of(parsed); a.next = list[0]; say("Array.of", [nextId(a)]); }
{ const a = fresh(); const list: Kind[] = [warm[1]].map(() => parsed); a.next = list[0]; say("map with a function that answers any", [nextId(a)]); }
{ const a = fresh(); const pair: [number, Kind] = [1, parsed]; a.next = pair[1]; say("a tuple", [nextId(a)]); }
{ const a = fresh(); const record: Record<string, Kind> = { one: parsed }; a.next = record.one; say("an index signature of a declared type", [nextId(a)]); }
{ const a = fresh(); const record: Record<string, Kind> = {}; record[["one"][0]] = parsed; a.next = record[["one"][0]]; say("and a computed store into it", [nextId(a)]); }

// Generic helpers carry a value nobody knows to the functions that they are handed, and keep it between two calls.
function each<T>(list: readonly T[], f: (x: T) => void) { for (const x of list) f(x); }
function eachEntry<T>(map: { [key: string]: T }, f: (x: T, key: string) => void) { for (const key in map) f(map[key], key); }
function firstOf<T, U>(list: readonly T[], f: (x: T) => U | undefined): U | undefined { for (const x of list) { const u = f(x); if (u) return u; } return undefined; }
function keeper<T>() { let kept: T; return { put(x: T) { kept = x; }, get(): T { return kept; } }; }
function once<T>(make: () => T): () => T { let value: T; let made = false; return () => { if (!made) { value = make(); made = true; } return value; }; }
function apply<T>(x: T, f: (x: T) => void) { f(x); }
{ const a = fresh(); each([parsed] as Kind[], k => { a.next = k; }); say("a generic loop hands it to a function", [nextId(a)]); }
{ const a = fresh(); eachEntry({ one: parsed } as { [key: string]: Kind }, k => { a.next = k; }); say("a generic loop over an index signature", [nextId(a)]); }
{ const a = fresh(); a.next = firstOf([parsed] as Kind[], k => k); say("what the function answers comes out of the generic call", [nextId(a)]); }
{ const a = fresh(); const k = keeper<Kind>(); k.put(parsed); a.next = k.get(); say("a generic closure keeps it", [nextId(a)]); }
{ const a = fresh(); const get = once<Kind>(() => parsed); a.next = get(); say("a generic function remembers what it made", [nextId(a)]); }
{ const a = fresh(); apply<any>(a, x => { x.flags = "applied as any"; }); say("T is any at one call", show(a)); }
{ const a = fresh(); apply(a as unknown, x => { (x as { id: unknown }).id = "applied as unknown"; }); say("T is unknown at one call", show(a)); }
{ const a = fresh(); const setNext = (k: Kind) => { a.next = k; }; each([parsed] as Kind[], setNext); say("the function is a variable", [nextId(a)]); }

// Literals that say nothing: what is in them, at any depth, and what typed code puts into them.
interface Holder { kind: Kind | undefined; }
{ const a = fresh(); const box: any = {}; box.inner = a; box.inner.flags = "out of a literal"; say("stored into a literal and read out of it", show(a)); }
{ const a = fresh(); const box: any = {}; const outer: any = {}; box.inner = a; outer.box = box; const again = outer.box; again.inner.id = "two deep"; say("a literal in a literal", show(a)); }
{ const a = fresh(); const raw: any = {}; const holder = raw as Holder; holder.kind = a; raw.kind.flags = "typed in, untyped out"; say("typed code stores into a literal that says nothing", show(a)); }
{ const a = fresh(); const tools: any = {}; tools.spoil = (x: any) => { x.flags = "a function in a literal"; }; tools.spoil(a); say("a function kept in a literal", show(a)); }
{ const a = fresh(); const tools: any = {}; const shelf: any = {}; tools.spoil = (x: any) => { x.id = "a function two deep"; }; shelf.tools = tools; (shelf.tools as { spoil: Taker }).spoil(a); say("a function in a literal in a literal, called through a type", show(a)); }
{ const a = fresh(); const raw: any = {}; raw.flags = "no number"; raw.id = 1; a.next = raw; say("a literal as a Kind", [typeof (a.next as Kind).flags]); }
{ const a = fresh(); const raw: any = {}; raw.next = parsed; const posing = raw as Kind; a.next = posing.next; say("read out of a literal that poses as a Kind", [nextId(a)]); }
{ const a = fresh(); const options: { [key: string]: unknown; kind?: Kind } = {}; options[["kind"][0]] = parsed; a.next = options.kind; say("a computed store hits a declared field", [nextId(a)]); }

// A function value that comes out of `any`.
type Taker = (kind: Kind) => void;
interface WithTaker { take: Taker; }
interface Visitor { visit(kind: Kind): void; }
const hidden: any = (x: any) => { x.flags = "hidden function"; };
const hiddenVisitor: any = { visit(x: any) { x.id = "hidden method"; } };
function makeTaker(): Taker { return hidden; }
const takers: Taker[] = [hidden];
const withTaker: WithTaker = { take: hidden };
class Listener { constructor(public onKind: Taker) {} fire(kind: Kind) { this.onKind(kind); } }
{ const a = fresh(); (hidden as Taker)(a); say("any as a function type", show(a)); }
{ const a = fresh(); makeTaker()(a); say("any returned as a function type", show(a)); }
{ const a = fresh(); takers[0](a); say("any in a list of functions", show(a)); }
{ const a = fresh(); withTaker.take(a); say("any in a field of a function type", show(a)); }
{ const a = fresh(); new Listener(hidden).fire(a); say("any as a parameter property of a function type", show(a)); }
{ const a = fresh(); (hiddenVisitor as Visitor).visit(a); say("a method of an object that comes out of any", show(a)); }
{ const a = fresh(); const v: Visitor = hiddenVisitor; v.visit(a); say("the same by an assignment", show(a)); }
{ const a = fresh(); const t: Taker = parsed.missing ?? hidden; t(a); say("any ?? any as a function type", show(a)); }
{ const a = fresh(); [a].forEach(hidden); say("any as the callback of the host", show(a)); }
{ const a = fresh(); const maker = ((): any => new Mark(7, 8, undefined)) as any; a.next = (maker as () => Kind)(); say("the result of a function out of any", [nextId(a)]); }

say("the others are as they were", tally());
console.log(lines.join("\n"));

// GENERATED: showMark returnsIt takeRest value listOfArguments put
// CHECK-LABEL: function {{*}}name="showMark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="showMark"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="returnsIt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v6 = Yield v5, v2
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="takeRest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="one"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="one"
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = NewObject layout=[[L_6]]
// CHECK-NEXT: CopyDataProperties v7, v4 excludedKeys=["one"]
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = PropGet v10 key="two"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v6 key="flags"
// CHECK-NEXT: v14 = PropGet v10 key="two"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v15, v6 key="name"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_11]]} results=[{type=undefined|null|[[L_1]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_10]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_10]] site=[[w_15]]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_10]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: PrivateSet v0, v2, v1 layout=[[L_10]] field=1
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="listOfArguments"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: undefined|null|[[L_1]], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v0, v2, v1
// CHECK-NEXT: v4 = Builtin builtin=ArrayPrototypeSlice
// CHECK-NEXT: v5 = PropGet v4 key="call"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v3 calleeKey="call" calleeName="Array.prototype.slice.call"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|Array site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_19]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_20]] site=[[w_21]]}] results=[{type=anything}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: env [[L_19]], v1: undefined|null|[[L_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_19]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="kept"
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|[[L_20]] site=[[w_23]]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_19]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
