// The addon under a declared interface: what typed code hands over goes to a typed parameter, not to `any`, and what the addon hands back is held to a declared type.
interface Below { x: number; deep: { y: string } }
interface Options { width: number; fast: boolean; name?: string; data: Uint8Array; list: number[]; below: Below }
interface Row { id: number; name: string; list: number[] }
interface Addon {
  names(o: object): string[]; readOptions(o: Options): string; getNamed(o: Options, name: keyof Options): unknown; setNamed(o: Options, name: keyof Options, value: unknown): string; hasOwn(o: object, name: string): boolean;
  sumBytesOf(o: Options, name: "data"): number; wrap(o: object, n: number): string; unwrap(o: object): number; tag(o: object, which: number): string; checkTag(o: object, which: number): boolean;
  freeze(o: object): string; del(o: object, name: string): boolean | string; defineValue(o: object, name: string, value: unknown, attributes: number): string; allNames(o: object, mode: number, filter: number, conversion: number): (string | symbol)[];
  makeRow(): Row; keep(o: object): string; keptValue(): object; dropKept(): string; coerceToObject<T>(o: T): T;
}
const loaded = { exports: {} as Addon }; process.dlopen(loaded, process.env.ADDON!); const addon: Addon = loaded.exports;
function options(): Options { return { width: 3, fast: true, data: new Uint8Array([1, 2, 3]), list: [1, 2], below: { x: 1, deep: { y: "y" } } }; }
function row1(): Row { return { id: 9, name: "made by the program", list: [] }; }
function widthOf(o: Options) { return o.width; } function belowOf(o: Options) { return o.below.x + o.below.deep.y; } function nameOf(r: Row) { return r.name + r.id + r.list.length; }
function show(v: unknown): string { return v === undefined ? "undefined" : (JSON.stringify(v, (_, x) => (typeof x === "symbol" ? String(x) : x instanceof Uint8Array ? "bytes " + [...x].join() : x === undefined ? "undefined" : x)) ?? "undefined"); }
let at = 0;
function row(label: string, f: () => unknown) { at++; let said: string; try { said = show(f()); } catch (e) { said = "THROWN TO JAVASCRIPT " + (e as Error).constructor.name + ": " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ "); } console.log(String(at).padStart(3) + " " + label + ": " + said); }
// A row that stores what the declared type does not allow: one call; what the call said | what the object looks like afterwards | what an object that nobody touched looks like.
function typeRow<T>(label: string, make: () => T, change: (o: T) => unknown, look: (o: T) => unknown) {
  at++; const o = make(); const told = (f: () => unknown) => { try { return show(f()); } catch (e) { return show("threw " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ ")); } };
  console.log(String(at).padStart(3) + " TYPE " + label + ": " + told(() => change(o)) + " | after: " + told(() => look(o)) + " | untouched: " + told(() => look(make())));
}
row("names", () => addon.names(options()));
row("allNames own all", () => addon.allNames(options(), 1, 0, 0));
row("allNames own writable | enumerable | configurable", () => [addon.allNames(options(), 1, 1, 0), addon.allNames(options(), 1, 2, 0), addon.allNames(options(), 1, 4, 0)]);
row("readOptions", () => addon.readOptions(options()));
row("getNamed each", () => (["width", "fast", "name", "data", "list", "below"] as const).map(n => addon.getNamed(options(), n)));
row("hasOwn each", () => ["width", "fast", "name", "data", "list", "below", "extra"].map(n => addon.hasOwn(options(), n)));
row("setNamed width", () => { const o = options(); return [addon.setNamed(o, "width", 50), widthOf(o)]; });
row("setNamed name", () => { const o = options(); return [addon.setNamed(o, "name", "set"), o.name, addon.names(o)]; });
row("setNamed below", () => { const o = options(); const b: Below = { x: 7, deep: { y: "w" } }; return [addon.setNamed(o, "below", b), belowOf(o)]; });
row("sumBytesOf", () => { const o = options(); return [addon.sumBytesOf(o, "data"), o.data]; });
row("wrap | unwrap", () => { const o = options(); return [addon.wrap(o, 42), addon.unwrap(o), addon.names(o), widthOf(o)]; });
row("tag | checkTag", () => { const o = options(); return [addon.tag(o, 1), addon.checkTag(o, 1), addon.checkTag(o, 2), addon.names(o)]; });
row("keep | keptValue", () => { const o = options(); return [addon.keep(o), addon.keptValue() === o, addon.dropKept()]; });
row("coerceToObject", () => { const o = options(); return addon.coerceToObject(o) === o; });
row("del name", () => { const o = options(); o.name = "n"; return [addon.del(o, "name"), o.name, addon.names(o)]; });
row("defineValue width, as it is", () => { const o = options(); return [addon.defineValue(o, "width", 60, 7), widthOf(o)]; });
typeRow("freeze (no code of the program freezes an Options)", options, o => addon.freeze(o), o => [Object.isFrozen(o), widthOf(o)]);
typeRow("setNamed width a string", options, o => addon.setNamed(o, "width", "wide"), o => [typeof o.width, o.width]);
typeRow("del width", options, o => addon.del(o, "width"), o => addon.names(o));
typeRow("defineValue extra", options, o => addon.defineValue(o, "extra", 1, 7), o => addon.names(o));
typeRow("defineValue width read only", options, o => addon.defineValue(o, "width", 61, 6), o => [widthOf(o), Object.getOwnPropertyDescriptor(o, "width")]);
row("a row of the program", () => nameOf(row1()));
row("A ROW THE ADDON HAS MADE: into a variable", () => { const r: Row = addon.makeRow(); return [r.id, r.name, r.list]; });
row("A ROW THE ADDON HAS MADE: handed on", () => nameOf(addon.makeRow()));
row("A ROW THE ADDON HAS MADE: into an array", () => { const all: Row[] = [row1()]; all.push(addon.makeRow()); return all.map(nameOf); });
row("A ROW THE ADDON HAS MADE: a member is stored", () => { const r = addon.makeRow(); r.name = "stored"; return nameOf(r); });
row("A ROW THE ADDON HAS MADE: spread", () => { const r: Row = { ...addon.makeRow(), id: 2 }; return nameOf(r); });
row("A ROW THE ADDON HAS MADE: keys | stringify | structuredClone", () => { const r = addon.makeRow(); return [Object.keys(r), JSON.stringify(r), structuredClone(r)]; });
row("A ROW THE ADDON HAS MADE: what it is", () => { const r: object = addon.makeRow(); return [Object.getPrototypeOf(r) === Object.prototype, Object.prototype.toString.call(r), r.constructor === Object, Bun.inspect(r), Bun.deepEquals(r, { id: 1, name: "n", list: [1, 2] }, true)]; });
export {};
