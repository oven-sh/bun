// An instance of a class below Map or Set never bears the mark "as its class made it". Where every method of the built-in is still found on the built-in's own prototype, its structure is kept, and the stubs of those methods take it as they take a plain Map: Quiet, Leaf (two prototypes between) and Bag are kept, Loud (it lays clear) and the instance with a name of its own are not. Whatever changes an object between takes the structure out again.
// COUNT: counter:StructuresKeptBelowBuiltinClasses >= 5
const counts = new Map<string, number>();
const note = (what: unknown): void => { const key = String(what); counts.set(key, (counts.get(key) ?? 0) + 1); };
const say = (): void => { console.log([...counts].map(([key, times]) => key + "x" + times).join(" ")); counts.clear(); };
class Quiet extends Map<string, number> { tag = "t"; }
class Leaf extends Quiet { helper(): string { return "helper"; } }
class Loud extends Map<string, number> { clear(): void { note("loud"); super.clear(); } }
class Bag extends Set<number> {}
const odd = new Quiet(); (odd as any).has = () => "own has";
const maps: Map<string, number>[] = [new Quiet(), new Map(), new Loud(), new Leaf(), odd];
const sets: Set<number>[] = [new Bag(), new Set()];
function sweep(turn: number): void {
  for (const one of maps) { one.set("a", turn); note(one.get("a") === turn); one.clear(); note(one.has("a")); one.delete("a"); }
  for (const one of sets) { one.add(turn); note(one.has(turn)); one.delete(turn); one.clear(); }
}
function phase(): void { for (let turn = 0; turn < 300; turn++) sweep(turn); say(); }
phase();
(Quiet.prototype as any).clear = function (this: Map<string, number>) { note("laid"); Map.prototype.clear.call(this); }; phase();
delete (Quiet.prototype as any).clear; phase();
