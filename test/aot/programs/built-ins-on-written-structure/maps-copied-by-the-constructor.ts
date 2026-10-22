const lines: string[] = [];
const say = (title: string, value: unknown) => lines.push(title + ": " + JSON.stringify(value));

class Declaration { constructor(public text: string) {} }
class Entry {
  members?: Map<string, Entry>;
  declarations: Declaration[] = [];
  constructor(public name: string) {}
}
class Impostor { name = 7; extra = "impostor"; }

function tableOf(names: string[]): Map<string, Entry> {
  const table = new Map<string, Entry>();
  for (const name of names) {
    const entry = new Entry(name);
    entry.declarations.push(new Declaration(name + "!"));
    table.set(name, entry);
  }
  return table;
}
function cloneOf(entry: Entry): Entry {
  const copy = new Entry(entry.name);
  if (entry.members) copy.members = new Map(entry.members);
  return copy;
}
function nameLength(entry: Entry, name: string): unknown {
  const found = entry.members!.get(name);
  return found ? found.name.length : "absent";
}

const root = new Entry("root");
say("no members", cloneOf(root).members === undefined);
root.members = tableOf(["alpha", "beta"]);
const clone = cloneOf(root);
say("same values", clone.members!.get("alpha") === root.members.get("alpha"));
say("another map", clone.members !== root.members);
clone.members!.set("gamma", new Entry("gamma"));
say("the original is untouched", [root.members.size, clone.members!.size]);
say("lengths", ["alpha", "beta", "gamma", "delta"].map(name => [nameLength(root, name), nameLength(clone, name)]));

(root.members as Map<string, unknown>).set("odd", new Impostor());
const cloneWithImpostor = cloneOf(root);
say("a value of another class is copied", [nameLength(cloneWithImpostor, "odd"), (cloneWithImpostor.members!.get("odd") as unknown as Impostor).extra]);
say("a copy of a copy", nameLength(cloneOf(cloneWithImpostor), "odd"));

function sumOf(numbers: Map<string, number>): number {
  let sum = 0;
  for (const name of ["a", "b", "c"]) sum += numbers.get(name)! + 1;
  return sum;
}
const small = new Map<string, number>();
small.set("a", 1);
small.set("b", 2);
small.set("c", 3);
say("small numbers", sumOf(new Map(small)));
small.set("b", 2 ** 40);
small.set("c", 0.5);
say("numbers that are no int32", sumOf(new Map(small)));
small.set("a", -0);
say("negative zero", Object.is(new Map(small).get("a"), -0));

say("keys stay keys", [...new Map(new Map<unknown, unknown>([[root, "value"], ["key", clone]])).keys()].map(key => typeof key));
say("undefined and null", [new Map(undefined).size, new Map(null).size]);

const withOwnIterator = new Map([["a", 1]]);
(withOwnIterator as any)[Symbol.iterator] = function* () { yield ["own", 2]; };
say("an iterator of its own", [...new Map(withOwnIterator)]);

const withOwnName = new Map([["a", 1]]);
(withOwnName as any).label = "named";
say("a property of its own", [...new Map(withOwnName)]);

class Reversed<K, V> extends Map<K, V> {
  *[Symbol.iterator](): MapIterator<[K, V]> { for (const [key, value] of [...super.entries()].reverse()) yield [key, value]; }
}
say("a subclass that iterates otherwise", [...new Map(new Reversed([["a", 1], ["b", 2]])).keys()]);

const relinked = new Map([["a", 1]]);
Object.setPrototypeOf(relinked, { __proto__: Map.prototype, *[Symbol.iterator]() { yield ["relinked", 3]; } });
say("another prototype", [...new Map(relinked as Map<string, number>)]);

const calls: unknown[] = [];
class Counting<K, V> extends Map<K, V> {
  set(key: K, value: V): this { calls.push([key, value]); return super.set(key, value); }
}
say("set of a subclass", [[...new Counting(new Map([["a", 1], ["b", 2]]))], calls]);

class Refusing<K, V> extends Map<K, V> {
  set(key: K, value: V): this { if (key === "b") throw new RangeError("refused " + String(value)); return super.set(key, value); }
}
try {
  new Refusing(new Map([["a", 1], ["b", 2]]));
  say("set that throws", "no error");
} catch (error) {
  say("set that throws", (error as Error).message);
}

class Keeping extends Map<string, Entry> {
  kept: Entry[] = [];
  set(key: string, value: Entry): this { (this.kept ??= []).push(value); value.name += "+"; return super.set(key, value); }
}
const keeping = new Keeping(tableOf(["kept"]));
say("set of a subclass changes a value", [keeping.get("kept")!.name, keeping.kept.length]);

say("a weak map of a map", new WeakMap(new Map([[root, 1]])).get(root));
try {
  new WeakMap(new Map([["text", 1]]) as never);
  say("a weak map refuses a string", "no error");
} catch (error) {
  say("a weak map refuses a string", (error as Error).constructor.name);
}

function unused(map: Map<string, number>): number {
  new Map(map);
  return map.size;
}
say("a copy that nobody uses", unused(small));

console.log(lines.join("\n"));
