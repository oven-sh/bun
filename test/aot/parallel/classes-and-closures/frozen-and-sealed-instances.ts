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
/* Output:
true true object
extensible sloppyStore undefined 10/2/p/xylabel
extensible strictStore undefined 10/2/p/xylabel
extensible sloppyRun undefined 20/21/run/xylabel
extensible strictRun undefined 20/21/run/xylabel
extensible sloppyCompound undefined 6/3/p!/xylabel
extensible strictCompound undefined 6/3/p!/xylabel
extensible sloppyAdd undefined k/0/n/undefined/keyhitsnote undefined k/0/n/undefined/keyhitsnote
extensible strictAdd undefined k/0/n/undefined/keyhitsnote undefined k/0/n/undefined/keyhitsnote
extensible sloppyRunWithAdds undefined last/30/n/1.5/keyhitsnoteweight undefined last/30/n/1.5/keyhitsnoteweight
extensible strictRunWithAdds undefined last/30/n/1.5/keyhitsnoteweight undefined last/30/n/1.5/keyhitsnoteweight
extensible sloppyDelete true k/0/undefined/undefined/keyhits true k/0/undefined/undefined/keyhits
extensible strictDelete true k/0/undefined/undefined/keyhits true k/0/undefined/undefined/keyhits
extensible copy 40 p! true undefined true last/30/undefined/1.5/keyhitsweight false 1/2/p/xylabel k/0/old/undefined/keyhitsnote
non-extensible sloppyStore undefined 10/2/p/xylabel
non-extensible strictStore undefined 10/2/p/xylabel
non-extensible sloppyRun undefined 20/21/run/xylabel
non-extensible strictRun undefined 20/21/run/xylabel
non-extensible sloppyCompound undefined 6/3/p!/xylabel
non-extensible strictCompound undefined 6/3/p!/xylabel
non-extensible sloppyAdd undefined k/0/undefined/undefined/keyhits undefined k/0/n/undefined/keyhitsnote
non-extensible strictAdd TypeError k/0/undefined/undefined/keyhits undefined k/0/n/undefined/keyhitsnote
non-extensible sloppyRunWithAdds undefined last/30/undefined/undefined/keyhits undefined last/30/n/undefined/keyhitsnote
non-extensible strictRunWithAdds TypeError k/30/undefined/undefined/keyhits TypeError k/30/n/undefined/keyhitsnote
non-extensible sloppyDelete true k/0/undefined/undefined/keyhits true k/0/undefined/undefined/keyhits
non-extensible strictDelete true k/0/undefined/undefined/keyhits true k/0/undefined/undefined/keyhits
non-extensible copy 40 p! true undefined true last/30/undefined/1.5/keyhitsweight false 1/2/p/xylabel k/0/old/undefined/keyhitsnote
sealed sloppyStore undefined 10/2/p/xylabel
sealed strictStore undefined 10/2/p/xylabel
sealed sloppyRun undefined 20/21/run/xylabel
sealed strictRun undefined 20/21/run/xylabel
sealed sloppyCompound undefined 6/3/p!/xylabel
sealed strictCompound undefined 6/3/p!/xylabel
sealed sloppyAdd undefined k/0/undefined/undefined/keyhits undefined k/0/n/undefined/keyhitsnote
sealed strictAdd TypeError k/0/undefined/undefined/keyhits undefined k/0/n/undefined/keyhitsnote
sealed sloppyRunWithAdds undefined last/30/undefined/undefined/keyhits undefined last/30/n/undefined/keyhitsnote
sealed strictRunWithAdds TypeError k/30/undefined/undefined/keyhits TypeError k/30/n/undefined/keyhitsnote
sealed sloppyDelete true k/0/undefined/undefined/keyhits false k/0/old/undefined/keyhitsnote
sealed strictDelete true k/0/undefined/undefined/keyhits TypeError k/0/old/undefined/keyhitsnote
sealed copy 40 p! true undefined true last/30/undefined/1.5/keyhitsweight false 1/2/p/xylabel k/0/old/undefined/keyhitsnote
frozen sloppyStore undefined 1/2/p/xylabel
frozen strictStore TypeError 1/2/p/xylabel
frozen sloppyRun undefined 1/2/p/xylabel
frozen strictRun TypeError 1/2/p/xylabel
frozen sloppyCompound undefined 1/2/p/xylabel
frozen strictCompound TypeError 1/2/p/xylabel
frozen sloppyAdd undefined k/0/undefined/undefined/keyhits undefined k/0/old/undefined/keyhitsnote
frozen strictAdd TypeError k/0/undefined/undefined/keyhits TypeError k/0/old/undefined/keyhitsnote
frozen sloppyRunWithAdds undefined k/0/undefined/undefined/keyhits undefined k/0/old/undefined/keyhitsnote
frozen strictRunWithAdds TypeError k/0/undefined/undefined/keyhits TypeError k/0/old/undefined/keyhitsnote
frozen sloppyDelete true k/0/undefined/undefined/keyhits false k/0/old/undefined/keyhitsnote
frozen strictDelete true k/0/undefined/undefined/keyhits TypeError k/0/old/undefined/keyhitsnote
frozen copy 40 p! true undefined true last/30/undefined/1.5/keyhitsweight false 1/2/p/xylabel k/0/old/undefined/keyhitsnote
*/
