// Every call of addon.c on typed objects: a record, a record with every member, a class instance, an instance of a subclass. The addon itself is `any`.
// One line per call. A line that begins with TYPE stores what the declared type does not allow: --aot may refuse that, with an error.
const loaded: { exports: any } = { exports: {} }; process.dlopen(loaded, process.env.ADDON!); const addon: any = loaded.exports;
const hidden = Symbol("hidden");
interface Below { x: number; deep: { y: string } }
interface Options { width: number; fast: boolean; name?: string; data: Uint8Array; list: number[]; below: Below; on(n: number): number; [hidden]?: number }
function options(): Options { return { width: 3, fast: true, data: new Uint8Array([1, 2, 3]), list: [1, 2], below: { x: 1, deep: { y: "y" } }, on(n) { return n + this.width; } }; }
function named(): Options { return { width: 4, fast: false, name: "n", data: new Uint8Array(1), list: [], below: { x: 2, deep: { y: "z" } }, on(n) { return n; }, [hidden]: 9 }; }
class Point { x: number; y: number; #secret = 5; label?: string; constructor(x: number, y: number) { this.x = x; this.y = y; } sum() { return this.x + this.y + this.#secret; } get double() { return this.x * 2; } static origin = new Point(0, 0); }
class Point3 extends Point { z: number; constructor(x: number, y: number, z: number) { super(x, y); this.z = z; } override sum() { return super.sum() + this.z; } }
function widthOf(o: Options) { return o.width; } function xOf(p: Point) { return p.x; } function belowOf(o: Options) { return o.below.x + o.below.deep.y; }
function show(v: unknown): string {
  if (typeof v === "symbol") return String(v);
  if (typeof v === "function") return "function " + v.name;
  if (v === undefined) return "undefined";
  return JSON.stringify(v, (_, x) => (typeof x === "symbol" ? String(x) : typeof x === "function" ? "function " + x.name : typeof x === "bigint" ? x + "n" : x instanceof Uint8Array ? "bytes " + [...x].join() : x === undefined ? "undefined" : x)) ?? "undefined";
}
function list(v: unknown): string { return Array.isArray(v) ? "[" + v.map(show).join(", ") + "]" : show(v); }
let at = 0;
function row(label: string, f: () => unknown) { at++; let said: string; try { said = list(f()); } catch (e) { said = "THROWN TO JAVASCRIPT " + (e as Error).constructor.name + ": " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, ""); } console.log(String(at).padStart(3) + " " + label + ": " + said); }
// A row that stores what the declared type does not allow: one call; what the call said | what the object looks like afterwards | what an object that nobody touched looks like.
function typeRow<T>(label: string, make: () => T, change: (o: T) => unknown, look: (o: T) => unknown) {
  at++; const o = make(); const told = (f: () => unknown) => { try { return show(f()); } catch (e) { return show("threw " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ ")); } };
  console.log(String(at).padStart(3) + " TYPE " + label + ": " + told(() => change(o)) + " | after: " + told(() => look(o)) + " | untouched: " + told(() => look(make())));
}
const OWN = 1, WITH_PROTOTYPES = 0, ALL = 0, WRITABLE = 1, ENUMERABLE = 2, CONFIGURABLE = 4, SKIP_STRINGS = 8, SKIP_SYMBOLS = 16, KEEP = 0, TO_STRINGS = 1;

for (const [what, make] of [["record", options], ["record with every member", named]] as const) {
  row(what + " names", () => addon.names(make()));
  row(what + " allNames own all", () => addon.allNames(make(), OWN, ALL, KEEP));
  row(what + " allNames own enumerable, no symbols", () => addon.allNames(make(), OWN, ENUMERABLE | SKIP_SYMBOLS, TO_STRINGS));
  row(what + " allNames own writable", () => addon.allNames(make(), OWN, WRITABLE, KEEP));
  row(what + " allNames own configurable", () => addon.allNames(make(), OWN, CONFIGURABLE, KEEP));
  row(what + " allNames own symbols alone", () => addon.allNames(make(), OWN, SKIP_STRINGS, KEEP));
  row(what + " allNames with prototypes, enumerable", () => addon.allNames(make(), WITH_PROTOTYPES, ENUMERABLE | SKIP_SYMBOLS, KEEP));
  row(what + " readOptions", () => addon.readOptions(make()));
  for (const name of ["width", "fast", "name", "data", "list", "below", "on", "extra", "toString"]) {
    row(what + " getNamed " + name, () => addon.getNamed(make(), name));
    row(what + " get " + name, () => addon.get(make(), name));
    row(what + " has | hasOwn | hasNamed " + name, () => [addon.has(make(), name), addon.hasOwn(make(), name), addon.hasNamed(make(), name)]);
  }
  row(what + " get | has | hasOwn a symbol", () => [addon.get(make(), hidden), addon.has(make(), hidden), addon.hasOwn(make(), hidden)]);
  row(what + " typeOf | kinds", () => [addon.typeOf(make()), addon.kinds(make())]);
  row(what + " kinds of data | list | on", () => [addon.kinds(make().data), addon.kinds(make().list), addon.typeOf(make().on)]);
  row(what + " prototypeOf is Object.prototype", () => addon.prototypeOf(make()) === Object.prototype);
  row(what + " instanceOf Object", () => addon.instanceOf(make(), Object));
  row(what + " coerceToObject is itself", () => { const o = make(); return addon.coerceToObject(o) === o; });
  row(what + " coerceToString", () => addon.coerceToString(make()));
  row(what + " strictEquals itself | its like", () => { const o = make(); return [addon.strictEquals(o, o), addon.strictEquals(o, make()), addon.strictEquals(o.below, o.below)]; });
  row(what + " sumBytesOf data, twice", () => { const o = make(); return [addon.sumBytesOf(o, "data"), addon.sumBytesOf(o, "data"), o.data]; });
  row(what + " lengthOfArrayAt list", () => addon.lengthOfArrayAt(make(), "list"));
  row(what + " callMethod on", () => addon.callMethod(make(), "on", 10));
  row(what + " call with it as this", () => addon.call(make(), function (this: Options, n: number) { return this.width + n; }, 1));
  row(what + " setNamed width", () => { const o = make(); return [addon.setNamed(o, "width", 50), widthOf(o), o.width, addon.getNamed(o, "width")]; });
  row(what + " set width", () => { const o = make(); return [addon.set(o, "width", 51), widthOf(o)]; });
  row(what + " setNamed name (optional)", () => { const o = make(); return [addon.setNamed(o, "name", "set"), o.name, addon.names(o)]; });
  row(what + " setNamed below", () => { const o = make(); const b: Below = { x: 7, deep: { y: "w" } }; return [addon.setNamed(o, "below", b), belowOf(o), o.below === b]; });
  row(what + " setNamed into below", () => { const o = make(); return [addon.setNamed(o.below, "x", 8), belowOf(o)]; });
  row(what + " setNamed data", () => { const o = make(); return [addon.setNamed(o, "data", new Uint8Array([9])), o.data]; });
  row(what + " setNamed on", () => { const o = make(); return [addon.setNamed(o, "on", (n: number) => n * 2), o.on(4)]; });
  row(what + " set a symbol", () => { const o = make(); return [addon.set(o, hidden, 3), o[hidden]]; });
  row(what + " setNamed extra (a new name)", () => { const o = make(); return [addon.setNamed(o, "extra", 1), (o as any).extra, addon.names(o), Object.keys(o)]; });
  row(what + " setElement 0 (a new index)", () => { const o = make(); return [addon.setElement(o, 0, "zero"), addon.getElement(o, 0), addon.hasElement(o, 0), (o as any)[0], addon.names(o)]; });
  row(what + " getElement | hasElement | deleteElement where none is", () => [addon.getElement(make(), 0), addon.hasElement(make(), 0), addon.deleteElement(make(), 0)]);
  row(what + " elements of list", () => { const o = make(); return [addon.setElement(o.list, 0, 5), addon.getElement(o.list, 0), addon.hasElement(o.list, 5), o.list]; });
  row(what + " del name (optional)", () => { const o = make(); return [addon.del(o, "name"), o.name, addon.names(o)]; });
  row(what + " del extra (not there)", () => addon.del(make(), "extra"));
  row(what + " defineValue width, as it is", () => { const o = make(); return [addon.defineValue(o, "width", 60, 7), widthOf(o)]; });
  row(what + " wrap | unwrap | removeWrap", () => { const o = make(); return [addon.wrap(o, 42), addon.unwrap(o), addon.names(o), Object.keys(o), addon.wrap(o, 43), addon.removeWrap(o), addon.unwrap(o)]; });
  row(what + " tag | checkTag", () => { const o = make(); return [addon.checkTag(o, 1), addon.tag(o, 1), addon.checkTag(o, 1), addon.checkTag(o, 2), addon.tag(o, 2), addon.names(o)]; });
  row(what + " keep | keptValue", () => { const o = make(); return [addon.keep(o), addon.keptValue() === o, addon.dropKept()]; });
  row(what + " addFinalizer", () => { const o = make(); return [addon.addFinalizer(o), addon.names(o)]; });
  row(what + " freeze", () => { const o = make(); return [addon.freeze(o), Object.isFrozen(o), widthOf(o), addon.setNamed(o, "width", 1), widthOf(o)]; });
  row(what + " seal", () => { const o = make(); return [addon.seal(o), Object.isSealed(o), addon.setNamed(o, "width", 1), widthOf(o), addon.del(o, "width")]; });
  row(what + " frozen by the program", () => { const o = Object.freeze(make()); return [addon.names(o), addon.getNamed(o, "width"), addon.setNamed(o, "width", 1), o.width, addon.del(o, "width"), addon.allNames(o, OWN, WRITABLE, KEEP), addon.readOptions(o)]; });
}
for (const [what, make] of [["instance", () => new Point(1, 2)], ["instance of a subclass", () => new Point3(1, 2, 3)]] as const) {
  row(what + " names", () => addon.names(make()));
  row(what + " allNames own all", () => addon.allNames(make(), OWN, ALL, KEEP));
  row(what + " allNames with prototypes, all", () => (addon.allNames(make(), WITH_PROTOTYPES, SKIP_SYMBOLS, KEEP) as string[]).filter(n => !(n in Object.prototype)));
  for (const name of ["x", "y", "z", "label", "sum", "double", "#secret", "constructor"]) row(what + " getNamed | has | hasOwn " + name, () => [addon.getNamed(make(), name), addon.has(make(), name), addon.hasOwn(make(), name)]);
  row(what + " typeOf | instanceOf Point | Point3 | Object", () => [addon.typeOf(make()), addon.instanceOf(make(), Point), addon.instanceOf(make(), Point3), addon.instanceOf(make(), Object)]);
  row(what + " prototypeOf", () => [addon.prototypeOf(make()) === Point.prototype, addon.prototypeOf(make()) === Point3.prototype]);
  row(what + " callMethod sum", () => addon.callMethod(make(), "sum", 0));
  row(what + " setNamed x", () => { const p = make(); return [addon.setNamed(p, "x", 10), xOf(p), p.sum(), p.double]; });
  row(what + " setNamed label (optional, absent)", () => { const p = make(); return [addon.setNamed(p, "label", "l"), p.label, addon.names(p)]; });
  row(what + " setNamed extra (a new name)", () => { const p = make(); return [addon.setNamed(p, "extra", 1), (p as any).extra, addon.names(p)]; });
  row(what + " wrap | unwrap", () => { const p = make(); return [addon.wrap(p, 7), addon.unwrap(p), addon.names(p), p.sum()]; });
  row(what + " tag | checkTag", () => { const p = make(); return [addon.tag(p, 1), addon.checkTag(p, 1), addon.checkTag(p, 2)]; });
  row(what + " freeze", () => { const p = make(); return [addon.freeze(p), Object.isFrozen(p), addon.setNamed(p, "x", 9), xOf(p)]; });
  typeRow(what + " del x (required)", make, p => addon.del(p, "x"), p => addon.names(p));
}
row("construct Point", () => { const p: Point = addon.construct(Point, 3, 4); return [p instanceof Point, xOf(p), p.sum()]; });
row("names | getNamed of the class", () => [addon.names(Point), addon.typeOf(Point), addon.getNamed(Point, "name"), addon.getNamed(Point, "origin") === Point.origin, addon.hasOwn(Point, "origin")]);
row("names of the prototype", () => [addon.names(Point.prototype), addon.allNames(Point.prototype, OWN, ALL, KEEP)]);
row("a row the addon has made, under a type", () => { const r: { id: number; name: string; list: number[] } = addon.makeRow(); return [r.id, r.name, r.list, Object.keys(r)]; });
row("an array of records", () => { const all: Options[] = [options(), named()]; return [addon.names(all), addon.getElement(all, 1) === all[1], addon.readOptions(addon.getElement(all, 1)), addon.kinds(all)]; });
row("a tuple", () => { const t: [number, string] = [1, "s"]; return [addon.names(t), addon.getElement(t, 1), addon.setElement(t, 0, 2), t]; });
typeRow("record setNamed width a string", options, o => addon.setNamed(o, "width", "wide"), o => [typeof o.width, o.width]);
typeRow("record setNamed below a stranger that fits", options, o => addon.setNamed(o, "below", JSON.parse('{"x":5,"deep":{"y":"j"}}')), o => belowOf(o));
typeRow("record setNamed below a stranger that lacks", options, o => addon.setNamed(o, "below", JSON.parse('{"x":5}')), o => o.below);
typeRow("record del width (required)", options, o => addon.del(o, "width"), o => addon.names(o));
typeRow("record defineValue width read only", options, o => addon.defineValue(o, "width", 61, 6), o => [widthOf(o), Object.getOwnPropertyDescriptor(o, "width")]);
typeRow("record defineValue width hidden", options, o => addon.defineValue(o, "width", 62, 5), o => [widthOf(o), addon.names(o)]);
typeRow("record defineValue extra (a new name)", options, o => addon.defineValue(o, "extra", 1, 7), o => [(o as any).extra, addon.names(o)]);
typeRow("record defineMethod on", options, o => addon.defineMethod(o, "on"), o => o.on(1));
typeRow("record defineMethod extra", options, o => addon.defineMethod(o, "extra"), o => typeof (o as any).extra);
typeRow("record defineAccessor width", options, o => addon.defineAccessor(o, "width"), o => widthOf(o));
typeRow("record defineAccessor extra", options, o => addon.defineAccessor(o, "extra"), o => (o as any).extra);
typeRow("instance setNamed x a string", () => new Point(1, 2), p => addon.setNamed(p, "x", "s"), p => [typeof p.x, p.x]);
typeRow("instance defineAccessor x", () => new Point(1, 2), p => addon.defineAccessor(p, "x"), p => xOf(p));
export {};
