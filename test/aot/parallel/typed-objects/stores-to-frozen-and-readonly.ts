// Stores to fields of class instances and records that some other part of the program may have frozen, sealed, or given single read-only properties: a store to a read-only
// property throws a TypeError and leaves the value as it was; a store to a property that is still writable goes through, whatever else has been done to the object; numbers,
// integers, booleans, strings, objects and null are stored alike. What freezes takes a value of no type, so nothing in the types says which objects it may reach.
const lines: string[] = [];
class Point { x: number; y: number; count: number; label: string; on: boolean; next: Point | null; tags: string[];
  constructor(x: number, y: number) { this.x = x; this.y = y; this.count = 0; this.label = "p"; this.on = false; this.next = null; this.tags = []; } }
interface Entry { key: string; weight: number; hits: number; live: boolean; owner: Point | null }
function freezeAnything(value: any): void { Object.freeze(value); }
function sealAnything(value: any): void { Object.seal(value); }
function closeAnything(value: any): void { Object.preventExtensions(value); }
function lockOne(value: any, name: string): void { Object.defineProperty(value, name, { writable: false }); }
function setX(p: Point, v: number): void { p.x = v; }
function setY(p: Point, v: number): void { p.y = v * 1.5; }
function setCount(p: Point, v: number): void { p.count = v | 0; }
function setLabel(p: Point, v: string): void { p.label = v; }
function setOn(p: Point, v: boolean): void { p.on = v; }
function setNext(p: Point, v: Point | null): void { p.next = v; }
function setTags(p: Point, v: string[]): void { p.tags = v; }
function setAll(p: Point, n: number, other: Point): void { p.x = n + 0.25; p.y = n / 3; p.count = n | 0; p.label = "all" + n; p.on = n > 2; p.next = other; }
function setWeight(e: Entry, v: number): void { e.weight = v; }
function setHits(e: Entry, v: number): void { e.hits = (e.hits + v) | 0; }
function setKey(e: Entry, v: string): void { e.key = v; }
function setLive(e: Entry, v: boolean): void { e.live = v; }
function setOwner(e: Entry, v: Point | null): void { e.owner = v; }
function show(p: Point): string { return [p.x, p.y, p.count, p.label, p.on, p.next === null ? "null" : p.next.label, p.tags.length].join(","); }
function showEntry(e: Entry): string { return [e.key, e.weight, e.hits, e.live, e.owner === null ? "null" : e.owner.label].join(","); }
function attempt(what: string, act: () => void): void { try { act(); lines.push(what + ": stored"); } catch (error) { lines.push(what + ": " + (error instanceof TypeError ? "TypeError " + (error as Error).message : "another error")); } }
const other = new Point(9, 9); other.label = "other";
const kinds: [string, (value: any) => void][] = [["plain", () => {}], ["frozen", freezeAnything], ["sealed", sealAnything], ["closed", closeAnything],
  ["x locked", value => lockOne(value, "x")], ["label locked", value => lockOne(value, "label")], ["next locked", value => lockOne(value, "next")],
  ["count locked, then sealed", value => { lockOne(value, "count"); sealAnything(value); }]];
for (const [kind, alter] of kinds) {
  const p = new Point(1, 2);
  for (let warm = 0; warm < 3; warm++) { setX(p, warm); setY(p, warm); setCount(p, warm); setLabel(p, "w" + warm); setOn(p, warm === 1); setNext(p, warm === 1 ? other : null); }
  alter(p);
  attempt(kind + " x", () => setX(p, 10.5)); attempt(kind + " y", () => setY(p, 4)); attempt(kind + " count", () => setCount(p, 7)); attempt(kind + " label", () => setLabel(p, "new"));
  attempt(kind + " on", () => setOn(p, true)); attempt(kind + " next", () => setNext(p, other)); attempt(kind + " tags", () => setTags(p, ["a", "b"])); attempt(kind + " all", () => setAll(p, 5, other));
  lines.push(kind + " = " + show(p) + " | " + Object.keys(p).join(" ") + " | " + Object.isFrozen(p) + " " + Object.isSealed(p) + " " + Object.isExtensible(p));
}
for (const [kind, alter] of [["plain", () => {}], ["frozen", freezeAnything], ["weight locked", (value: any) => lockOne(value, "weight")], ["owner locked", (value: any) => lockOne(value, "owner")]] as [string, (value: any) => void][]) {
  const e: Entry = { key: "k", weight: 1.5, hits: 0, live: false, owner: null };
  setWeight(e, 2.5); setHits(e, 1); alter(e);
  attempt(kind + " weight", () => setWeight(e, 3.75)); attempt(kind + " hits", () => setHits(e, 2)); attempt(kind + " key", () => setKey(e, "k2")); attempt(kind + " live", () => setLive(e, true)); attempt(kind + " owner", () => setOwner(e, other));
  lines.push(kind + " = " + showEntry(e));
}
let total = 0; const many: Point[] = []; for (let i = 0; i < 200; i++) { const p = new Point(i, i); if (i % 7 === 3) freezeAnything(p); many.push(p); }
for (let round = 0; round < 5; round++) for (const p of many) { try { setX(p, p.x + 1); setCount(p, p.count + 1); total++; } catch { total += 1000; } }
lines.push("total " + total + " " + many.reduce((sum, p) => sum + p.x + p.count, 0));
console.log(lines.join("\n"));
