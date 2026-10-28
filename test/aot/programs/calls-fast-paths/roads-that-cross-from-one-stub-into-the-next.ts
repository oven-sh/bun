// Roads that cross from one shared stub into the next. A stub may be a second entry of the one behind it, which first tests the receiver: Map and Set methods outside loops, on receivers that are a Map or a Set by type and may be of a subclass, with keys that are strings by type and keys that are not; reads under computed keys. And a stub may end by falling into the next: reads and writes at an integer index on what is no plain array.
const said: string[] = [];
class Counted extends Map<string, number> { asked = 0; has(key: string) { this.asked++; return super.has(key); } get(key: string) { this.asked++; return super.get(key); } set(key: string, value: number) { this.asked++; return super.set(key, value); } }
class Tagged extends Set<string> { asked = 0; has(value: string) { this.asked++; return super.has(value); } add(value: string) { this.asked++; return super.add(value); } }
class Any extends Map<unknown, number> { asked = 0; has(key: unknown) { this.asked++; return super.has(key); } get(key: unknown) { this.asked++; return super.get(key); } set(key: unknown, value: number) { this.asked++; return super.set(key, value); } }
class AnySet extends Set<unknown> { asked = 0; has(value: unknown) { this.asked++; return super.has(value); } add(value: unknown) { this.asked++; return super.add(value); } }
function hasString(map: Map<string, number>, key: string): boolean { return map.has(key); }
function getString(map: Map<string, number>, key: string): number | undefined { return map.get(key); }
function setString(map: Map<string, number>, key: string, value: number): void { map.set(key, value); }
function holdsString(set: Set<string>, key: string): boolean { return set.has(key); }
function addString(set: Set<string>, key: string): void { set.add(key); }
function hasAny(map: Map<unknown, number>, key: unknown): boolean { return map.has(key); }
function getAny(map: Map<unknown, number>, key: unknown): number | undefined { return map.get(key); }
function setAny(map: Map<unknown, number>, key: unknown, value: number): void { map.set(key, value); }
function holdsAny(set: Set<unknown>, key: unknown): boolean { return set.has(key); }
function addAny(set: Set<unknown>, key: unknown): void { set.add(key); }
function read(object: any, key: any): unknown { return object[key]; }
function strings(map: Map<string, number>, set: Set<string>): string {
  const before = [hasString(map, "a"), getString(map, "a"), holdsString(set, "a")].join();
  setString(map, "a", 1); setString(map, "bb", 2); setString(map, "a", 3); addString(set, "a"); addString(set, "bb"); addString(set, "a");
  return before + " | " + [hasString(map, "a"), hasString(map, "x" + "y"), getString(map, "a"), getString(map, "b" + "b"), getString(map, "zz"), holdsString(set, "bb"), holdsString(set, "c"), map.size, set.size].join();
}
function anything(map: Map<unknown, number>, set: Set<unknown>, object: object, symbol: symbol): string {
  const before = [hasAny(map, object), getAny(map, 1), holdsAny(set, symbol)].join();
  setAny(map, object, 1); setAny(map, "1", 2); setAny(map, 1, 3); setAny(map, symbol, 4); setAny(map, NaN, 5); setAny(map, -0, 6); addAny(set, object); addAny(set, "1"); addAny(set, 1); addAny(set, null);
  return before + " | " + [hasAny(map, object), hasAny(map, {}), getAny(map, "1"), getAny(map, 1), getAny(map, symbol), getAny(map, NaN), getAny(map, 0), getAny(map, undefined), holdsAny(set, object), holdsAny(set, 1), holdsAny(set, "1"), holdsAny(set, null), holdsAny(set, undefined), map.size, set.size].join();
}
const object = {}, symbol = Symbol("s");
said.push("as they were made, strings: " + strings(new Map(), new Set()));
const counted = new Counted(), tagged = new Tagged();
said.push("of subclasses, strings: " + strings(counted, tagged) + " asked " + counted.asked + " " + tagged.asked);
said.push("as they were made, anything: " + anything(new Map(), new Set(), object, symbol));
const any = new Any(), anySet = new AnySet();
said.push("of subclasses, anything: " + anything(any, anySet, object, symbol) + " asked " + any.asked + " " + anySet.asked);
const own = new Map<string, number>(); (own as any).has = () => true; (own as any).get = () => 77;
said.push("with methods of its own: " + hasString(own, "a") + " " + getString(own, "a"));
function readAt(object: any, index: number): unknown { return object[index]; }
function writeAt(object: any, index: number, value: unknown): void { object[index] = value; }
function first(object: any): unknown { return object[0]; }
function third(object: any): unknown { return object[2]; }
function setFirst(object: any, value: unknown): void { object[0] = value; }
function setThird(object: any, value: unknown): void { object[2] = value; }
const numbered: any = { 0: "zero", 2: "two" }, bytes = new Uint8Array([5, 6]), sparse: any[] = [1]; sparse[5000] = 2;
const listed = (function (..._: unknown[]) { return arguments; })("first", "second");
said.push("read at an index: " + [readAt("text", 0), readAt("text", 3), readAt("text", 4), readAt("text", -1), readAt(numbered, 0), readAt(numbered, 1), readAt(numbered, 2), readAt(bytes, 1), readAt(bytes, 2), readAt(sparse, 0), readAt(sparse, 5000), readAt(sparse, 7), readAt(listed, 1), readAt(listed, 2), readAt(7, 0), readAt([1.5, 2.5], 1), readAt(["a"], 1.5), readAt("text", 1.5)].join());
writeAt(numbered, 1, "one"); writeAt(numbered, 0, "nought"); writeAt(bytes, 0, 300); writeAt(bytes, 9, 1); writeAt(sparse, 6000, 3); writeAt(sparse, 1, "b"); writeAt(listed, 0, "changed"); writeAt(numbered, -1, "minus"); writeAt(numbered, 1.5, "half");
said.push("written at an index: " + [JSON.stringify(numbered), Array.from(bytes).join("/"), sparse.length, sparse[1], sparse[6000], listed[0], listed.length].join());
said.push("read at a fixed index: " + [first("text"), third("text"), third("ab"), first(""), first(numbered), third(numbered), third({}), first(bytes), third(bytes), first(sparse), third(sparse), first(listed), third(listed), first(7), first([1.5]), third([1, , 3]), third([1, 2])].join());
const target: any = {}, more = new Uint8Array(3), wide: any[] = []; wide[9000] = 1;
setFirst(target, "a"); setThird(target, "c"); setFirst(more, 257); setThird(more, 2); setFirst(wide, "w"); setThird(wide, "x"); setThird(listed, "third");
said.push("written at a fixed index: " + [JSON.stringify(target), Array.from(more).join("/"), wide[0], wide[2], wide.length, listed[2], listed.length].join());
const record = { a: 1, bb: "two", 3: "three", [symbol]: "s" };
said.push("computed keys: " + [read(record, "a"), read(record, "b" + "b"), read(record, 3), read(record, "3"), read(record, symbol), read(record, "absent"), read([7, 8], 0), read([7, 8], "1"), read([7, 8], "length"), read("ab", 1), read("ab", "length"), read(5, "toFixed") === Number.prototype.toFixed].join());
console.log(said.join("\n"));
