// Stores to frozen, sealed and non-extensible class instances and records: one store, a run of stores, compound stores, a store that adds an optional field and a delete, from strict and from sloppy functions. A copy of such an object takes every store. The file mentions module.exports, so it runs as CommonJS and a function without "use strict" is sloppy: there a store that fails is skipped, in strict code it throws a TypeError and the stores after it do not run.
class Point { x = 1; y = 2; label = "p"; }
interface Entry { key: string; hits: number; note?: string; weight?: number }
function calledSloppy(this: unknown): boolean { return this !== undefined; } function calledStrict(this: unknown): boolean { "use strict"; return this === undefined; }
function sloppyStore(p: Point): void { p.x = 10; } function strictStore(p: Point): void { "use strict"; p.x = 10; }
function sloppyRun(p: Point): void { p.x = 20; p.y = 21; p.label = "run"; } function strictRun(p: Point): void { "use strict"; p.x = 20; p.y = 21; p.label = "run"; }
function sloppyCompound(p: Point): void { p.x += 5; p.y++; p.label += "!"; } function strictCompound(p: Point): void { "use strict"; p.x += 5; p.y++; p.label += "!"; }
function sloppyAdd(e: Entry): void { e.note = "n"; } function strictAdd(e: Entry): void { "use strict"; e.note = "n"; }
function sloppyRunWithAdds(e: Entry): void { e.hits = 30; e.note = "n"; e.weight = 1.5; e.key = "last"; } function strictRunWithAdds(e: Entry): void { "use strict"; e.hits = 30; e.note = "n"; e.weight = 1.5; e.key = "last"; }
function sloppyDelete(e: Entry): boolean { return delete e.note; } function strictDelete(e: Entry): boolean { "use strict"; return delete e.note; }
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name; } }
function showPoint(p: Point): string { return [p.x, p.y, p.label, Object.keys(p).join("")].join("/"); } function showEntry(e: Entry): string { return [e.key, e.hits, String(e.note), String(e.weight), Object.keys(e).join("")].join("/"); }
const levels: [string, (o: object) => void][] = [["extensible", () => {}], ["non-extensible", o => { Object.preventExtensions(o); }], ["sealed", o => { Object.seal(o); }], ["frozen", o => { Object.freeze(o); }]];
console.log(calledSloppy(), calledStrict(), typeof module.exports);
for (const [level, restrict] of levels) {
  for (const store of [sloppyStore, strictStore, sloppyRun, strictRun, sloppyCompound, strictCompound]) { const p = new Point(); restrict(p); console.log(level, store.name, attempt(() => store(p)), showPoint(p)); }
  for (const store of [sloppyAdd, strictAdd, sloppyRunWithAdds, strictRunWithAdds, sloppyDelete, strictDelete]) {
    const bare: Entry = { key: "k", hits: 0 }, noted: Entry = { key: "k", hits: 0, note: "old" }; restrict(bare); restrict(noted);
    console.log(level, store.name, attempt(() => store(bare)), showEntry(bare), attempt(() => store(noted)), showEntry(noted));
  }
  const point = new Point(), entry: Entry = { key: "k", hits: 0, note: "old" }; restrict(point); restrict(entry);
  const pointCopy = { ...point }, entryCopy: Entry = { ...entry }; pointCopy.x = 40; pointCopy.label += "!";
  console.log(level, "copy", pointCopy.x, pointCopy.label, Object.isExtensible(pointCopy), attempt(() => strictRunWithAdds(entryCopy)), attempt(() => strictDelete(entryCopy)), showEntry(entryCopy), Object.isSealed(entryCopy), showPoint(point), showEntry(entry));
}
