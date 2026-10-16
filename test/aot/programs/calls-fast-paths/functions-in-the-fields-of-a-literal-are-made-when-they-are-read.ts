// A function written in an object literal that captures nothing is a function object of its own for every object the literal makes. Nobody can tell when it is made: here it is not made with the
// object, and a call through the field needs none at all.
// CALLS- make NewTypedClosure0
interface Kit {
  name: string; size: number; label?: string;
  add: (x: number) => number; twice?: (x: number) => number; word?: () => string; later?: () => number; yes: () => boolean; method(x: number): number;
}
let made = 0;
function make(): Kit {
  return { name: "k" + made++, size: made, add: x => x + 1, twice: x => x * 2, word: () => "w", yes: () => true, method(x) { return x + 3; } };
}
function makeFrozen(): Readonly<Kit> { return Object.freeze(make()); }
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
const first = make(), second = make();
show("called", () => [first.add(1), first.twice!(4), first.word!(), first.yes(), first.method(1), second.add(2), first.later?.()].join());
show("one function an object", () => [first.add === first.add, first.add === second.add, first.twice === first.twice, first.twice === second.twice, first.method === second.method].join());
show("detached", () => { const { add, twice, word } = make(); return [add(1), twice!(2), word!(), add.name, twice!.name, add.length, typeof word, add instanceof Function].join(); });
show("keys", () => [Object.keys(make()).join(), JSON.stringify(make()), Object.getOwnPropertyNames(make()).length].join(" "));
show("has", () => { const kit = make(); return ["add" in kit, "twice" in kit, "later" in kit, Object.hasOwn(kit, "word"), Object.hasOwn(kit, "later"), kit.twice !== undefined, kit.later === undefined].join(); });
show("values", () => Object.values(make()).map(value => typeof value).join());
show("entries", () => Object.entries(make()).filter(([, value]) => typeof value === "function").map(([key, value]) => key + "=" + (value as Function).name).join());
show("spread", () => { const kit = make(); const copy = { ...(kit as any) }; return [copy.add === kit.add, copy.twice === kit.twice, copy.add(1), Object.keys(copy).join()].join(); });
show("spread and stored over", () => { const kit = make(); const copy = { ...(kit as any), size: 9 }; return [copy.add === kit.add, copy.word === kit.word, copy.size, copy.twice(3)].join(); });
show("spread twice", () => { const kit = make(); const one = { ...(kit as any) }, two = { ...(kit as any) }; return [one.add === two.add, one.yes === kit.yes].join(); });
show("merged", () => { const a = make(), b = make(); const both = { ...(a as any), ...(b as any) }; return [both.add === b.add, both.add === a.add, both.name === b.name].join(); });
show("spread by typed code", () => { const kit = make(); const copy = { ...kit }; return [copy.add === kit.add, copy.twice === kit.twice, copy.add(1), Object.keys(copy).join()].join(); });
show("spread to the type", () => { const kit = make(); const copy: Kit = { ...kit, size: 9 }; return [copy.add === kit.add, copy.word === kit.word, copy.size, copy.twice!(3)].join(); });
show("spread twice to the type", () => { const kit = make(); const one: Kit = { ...kit }, two: Kit = { ...kit }; return [one.add === two.add, one.yes === kit.yes].join(); });
show("spread after one was read", () => { const kit = make(); const add = kit.add; const copy: Kit = { ...kit }; return [copy.add === add, copy.twice === kit.twice, kit.add === add].join(); });
show("a function stored over in the copy", () => { const kit = make(); const copy: Kit = { ...kit, add: x => x + 50 }; return [copy.add(1), kit.add(1), copy.add === kit.add, copy.twice === kit.twice].join(); });
show("merged to the type", () => { const a = make(), b = make(); const both: Kit = { ...a, ...b }; return [both.add === b.add, both.add === a.add, both.name === b.name].join(); });
show("the rest by typed code", () => { const kit = make(); const { name, add, ...rest } = kit; return [add === kit.add, rest.twice === kit.twice, Object.keys(rest).join(), name.length > 0].join(); });
show("the rest", () => { const kit = make(); const { name, add, ...rest } = kit as any; return [add === kit.add, rest.twice === kit.twice, Object.keys(rest).join(), name.length > 0].join(); });
show("from entries", () => { const kit = make(); const copy = Object.fromEntries(Object.entries(kit)); return [copy.add === kit.add, copy.word === kit.word].join(); });
show("assigned", () => { const a = make(), b = make(); Object.assign(a, b); return [a.add === b.add, a.twice === b.twice].join(); });
show("stored to", () => { const kit = make(); const before = kit.add; kit.add = x => x + 100; return [kit.add(1), before(1), before === kit.add].join(); });
show("stored to before it is read", () => { const kit = make(); kit.twice = x => x * 200; kit.add = x => x + 200; return [kit.twice(1), kit.add(1), Object.keys(kit).join()].join(); });
show("deleted", () => { const kit = make(); delete kit.twice; return ["twice" in kit, kit.twice, Object.keys(kit).join(), kit.word!()].join(); });
show("deleted and stored again", () => { const kit = make(); delete kit.twice; kit.twice = x => x * 5; return [kit.twice(2), Object.keys(kit).join()].join(); });
show("created later", () => { const kit = make(); kit.later = () => 7; kit.label = "l"; return [kit.later(), kit.add(1), kit.twice!(2), Object.keys(kit).join()].join(); });
show("undefined stored", () => { const kit = make(); kit.twice = undefined; return [kit.twice, "twice" in kit, Object.keys(kit).join()].join(); });
show("frozen", () => { const kit = makeFrozen(); return [kit.add(1), kit.twice!(2), kit.add === kit.add, Object.isFrozen(kit), Object.keys(kit).join()].join(); });
show("through any", () => { const kit: any = make(); return [kit.add(1), kit["twice"](2), kit.add === kit.add, kit.later].join(); });
show("handed on", () => [make(), make()].map(kit => kit.add).map((f, i) => f(i)).join());
show("for in", () => { const names: string[] = []; for (const name in make()) names.push(name); return names.join(); });
interface Spare { name: string; plus: (x: number) => number; half?: (x: number) => number; text?: () => string; }
const makeSpare = (name: string): Spare => ({ name, plus: x => x + 1, half: x => x / 2, text: () => "t" });
show("a record that typed code copies", () => { const spare = makeSpare("a"); const copy: Spare = { ...spare, name: "b" }, clone = { ...spare }; const both: Spare = { ...spare, ...makeSpare("c") }; return [copy.plus === spare.plus, copy.half === spare.half, clone.text === spare.text, both.plus === spare.plus, copy.name, both.name, copy.half!(4)].join(); });
interface Marked { read: () => number; }
const makeMarked = (): Marked => ({ read: () => 5 });
show("properties of its own", () => { const one = makeMarked(); (one.read as any).mark = 1; return [(one.read as any).mark, (makeMarked().read as any).mark, one.read()].join(); });
let total = 0;
const kept: Kit[] = [];
for (let i = 0; i < 3000; i++) { const kit = i & 1 ? make() : makeFrozen(); kept[i & 7] = kit; total += kit.add(i & 3) + kit.twice!(1) + (i % 700 ? 0 : kit.word!().length); }
console.log(total, kept.map(kit => kit.name + kit.method(1)).join());
