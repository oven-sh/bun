// Flags: --aot-testing=CheckWalkAtRunTime
// JSON.stringify has quick cases that go by what they remember: a Structure that had no toJSON, the fields of a layout in the order of their keys, a list of properties. A quick case that succeeds says that no code had to run: under the word that checks the walk the general way writes the value again, and the two texts are held against each other.
// Nothing here looks at a text that was written: it is enough that the writer ran. With an older memo (a Structure remembered behind an answer that held for one object only) seven of these calls stop by name.
// A call that meets a toJSON leaves the quick cases, rightly, and is not asked again: the ten that are counted are those without one.
// COUNTER: AnswersAskedAgain >= 10
type Entry = { name: string; toJSON?: () => string };
function entry(name: string, custom: boolean): Entry {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (custom) return { name, toJSON: () => "custom " + name + work };
  return { name };
}
function write(make: () => unknown): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  void JSON.stringify(make());
  return work;
}
let ran = 0;
ran += write(() => ({ first: entry("a", false), second: entry("b", true) }));
ran += write(() => ({ first: entry("b", true), second: entry("a", false) }));
ran += write(() => [{ id: 1, owner: entry("a", false) }, { id: 2, owner: entry("b", true) }]);
ran += write(() => ({ one: entry("a", false), two: entry("b", true), three: entry("c", false) }));
ran += write(() => ({ outer: { first: entry("a", false), second: entry("b", true) } }));
ran += write(() => Array.from({ length: 400 }, (_, i) => ({ id: i, owner: entry("n" + i, i % 7 === 3) })));
ran += write(() => { const late = entry("late", false); const holder = { first: entry("a", false), second: late }; late.toJSON = () => "filled"; return holder; });
ran += write(() => { const grown: Record<string, unknown> = { first: entry("a", false) }; grown["k" + ran] = entry("b", false); grown.when = new Date(0); return grown; });
ran += write(() => ({ plain: entry("a", false), deep: { deeper: { deepest: entry("z", false) } }, list: [1, 2.5, "three", null, true] }));
ran += write(() => ({ a: -0, b: 1e21, c: "  \ud800", d: [undefined, () => 1], e: undefined }));
for (let i = 0; i < 8; i++) ran += write(() => ({ id: i, owner: entry("p" + i, false), tags: ["x", i] }));
console.log("ran", ran);
