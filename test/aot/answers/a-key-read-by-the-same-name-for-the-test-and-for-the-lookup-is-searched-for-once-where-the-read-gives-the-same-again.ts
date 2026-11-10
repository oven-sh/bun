// answers: with-library
// # `if (map.has(entry.label)) .. map.get(entry.label)` in a loop: the key is written twice. Where the name read again gives the same value (a slot of a proven layout) the table is searched once, as under one variable. Where the read may call unknown code (a value of which nothing is known, a getter) the lookup gets a value of its own and never finds the place: the test stays the closed call, and nothing is searched for a place.
// # f1 = ofInstance, f2 = ofUnknown, f3 = storedBetween
// # RUN(FORM): walk f1 f2 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: [[place]]: {{*}} = FindKeyInMap
// # FORM: = GetValueAtPlaceInMap {{*}}, [[place]]
// # FORM-LABEL: code f2:Body
// # FORM-NOT: FindKeyInMap
// # FORM-LABEL: code f3:Body
// # FORM-NOT: GetValueAtPlaceInMap
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 23 of 23 of 23
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Entry { constructor(public label: string, public other: string) {} }
class Turning { private turns = 0; get label(): string { return this.turns++ & 1 ? "b" : "a"; } }
const labels = ["a", "zz", "b", "a", "c", "b"];
const entries: Entry[] = [];
for (let i = 0; i < labels.length; i++) entries.push(new Entry(labels[i]!, labels[(i + 1) % labels.length]!));
const parsed: any[] = JSON.parse('[{"label":"a"},{"label":"zz"},{"label":"b"},{"label":"c"},{}]');
function ofInstance() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (map.has(entry.label)) said += map.get(entry.label) + ";"; else said += "-;"; } return said; }
function ofUnknown(list: any[]) { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < list.length; i++) { const entry = list[i]; if (map.has(entry.label)) said += map.get(entry.label) + ";"; else said += "-;"; } return said; }
function storedBetween() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); const entry = new Entry("a", "b"); let said = ""; for (let i = 0; i < 4; i++) { entry.label = i & 1 ? "a" : "c"; if (map.has(entry.label)) { entry.label = "b"; said += map.get(entry.label) + ";"; } } return said; }
function otherName() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (map.has(entry.label)) said += map.get(entry.other) + ";"; else said += "-;"; } return said; }
function otherObject() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; const second = entries[(i + 2) % entries.length]!; if (map.has(entry.label)) said += map.get(second.label) + ";"; else said += "-;"; } return said; }
function deletedBetween() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (map.has(entry.label)) { map.delete(entry.label); said += map.get(entry.label) + ";"; } else said += "-;"; } return said + map.size; }
function clearedBetween() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (map.has(entry.label)) { map.clear(); said += map.get(entry.label) + ";"; } else said += "-;"; } return said + map.size; }
function grownBetween() { const map = new Map<string, string>(); map.set("a", "at a"); map.set("b", "at b"); map.set("c", "at c"); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (map.has(entry.label)) { for (let more = 0; more < 40; more++) map.set("more " + i + " " + more, "x"); said += map.get(entry.label) + ";"; } else said += "-;"; } return said + map.size; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
for (let turn = 0; turn < 2; turn++) { tell(() => ofInstance()); tell(() => ofUnknown(parsed)); tell(() => ofUnknown(entries)); tell(() => ofUnknown([new Turning(), new Turning()])); tell(() => ofUnknown([null])); tell(() => storedBetween()); tell(() => otherName()); tell(() => otherObject()); tell(() => deletedBetween()); tell(() => clearedBetween()); tell(() => grownBetween()); }
report("end");
