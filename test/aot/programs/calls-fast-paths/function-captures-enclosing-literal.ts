// `const kit = { .. }; kit.self = () => kit.name`: nothing can look at the object between its birth and that store, so the field is one the object is born with, and its function is made when it is read.
// CALLS- make DidCreateTypedField
// CALLS- make NewTypedClosure1
interface Kit { name: string; size: number; twice: (x: number) => number; self?: () => string; grown?: () => number; late?: () => string; }
let made = 0;
function make(name: string): Kit {
  const kit: Kit = { name, size: ++made, twice: x => x * 2 };
  kit.self = () => kit.name;
  kit.grown = () => kit.size + 1;
  return kit;
}
function show(label: string, value: unknown) { console.log(label, JSON.stringify(value)); }
const kept: Kit[] = [];
for (let i = 0; i < 40; i++) kept.push(make("k" + i));
show("keys", Object.keys(kept[0]));
show("called", [kept[1].self!(), kept[2].grown!(), kept[3].twice(4)]);
show("the same function every time", [kept[4].self === kept[4].self, kept[4].self === kept[5].self, kept[4].grown === kept[4].grown]);
show("it sees a later store", (() => { const kit = make("before"); const self = kit.self!; kit.name = "after"; return [self(), kit.self!()]; })());
show("called before it was read", (() => { const kit = make("first"); kit.name = "second"; return kit.self!(); })());
show("a copy's function speaks of the source", (() => { const kit = make("source"); const copy: Kit = { ...kit, name: "copy" }; return [copy.self!(), copy.self === kit.self, copy.name]; })());
show("deleted", (() => { const kit = make("gone"); delete kit.self; return [kit.self === undefined, "self" in kit, Object.keys(kit)]; })());
show("stored over", (() => { const kit = make("over"); kit.self = () => "other"; return [kit.self(), Object.keys(kit)]; })());
show("created later", (() => { const kit = make("later"); kit.late = () => kit.name + "!"; return [kit.late(), Object.keys(kit)]; })());
show("frozen", (() => { const kit = Object.freeze(make("ice")); return [kit.self!(), Object.isFrozen(kit), kit.self === kit.self]; })());
show("entries", Object.entries(make("all")).map(([key, value]) => key + ":" + typeof value));
show("descriptor", (() => { const d = Object.getOwnPropertyDescriptor(make("d"), "self")!; return [typeof d.value, d.writable, d.enumerable, d.configurable, d.value()]; })());
show("many, with garbage between", (() => { let total = 0; for (let i = 0; i < 20000; i++) { const kit = make("g" + (i & 7)); if ((i & 1023) === 0) total += kit.self!().length + kit.grown!(); } return total > 0; })());
