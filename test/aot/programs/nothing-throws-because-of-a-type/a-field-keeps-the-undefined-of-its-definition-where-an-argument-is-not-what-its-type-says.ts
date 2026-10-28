// A constructor stores a field unless the argument is undefined, and the type of the parameter says that it never is. An argument that is undefined all the same leaves the field as it was defined.
class Entry {
  id: number;
  merge?: number;
  constructor(id: number, merge: number) {
    this.id = id;
    if (merge !== undefined) this.merge = merge;
  }
}
class Named {
  name: string | undefined;
  constructor(name: number | string) {
    if (typeof name === "string") this.name = name;
    else if (typeof name === "number") this.name = "#" + name;
  }
}
function read(entry: Entry) {
  return entry.merge ?? "none";
}
function text(entry: Entry): string {
  const merged = entry.merge ?? 1e21;
  return String(merged);
}
const given: any[] = [2, undefined, 3.5, undefined, null, "text"];
for (let turn = 0; turn < 12; turn++) {
  const entry = new Entry(turn, given[turn % given.length]);
  console.log(read(entry), text(entry), Object.keys(entry).join(), entry.merge === undefined);
}
for (const name of ["a", 1, undefined, null, true] as any[]) console.log(new Named(name).name ?? "no name");

class Base {
  tag = "base";
}
class Leaf extends Base {
  extra?: number;
  label?: string;
  constructor(extra: number, label: string) {
    super();
    if (extra !== undefined) this.extra = extra;
    if (typeof label === "string") this.label = label;
  }
}
interface Options {
  size: number;
}
class Sized {
  size?: number;
  constructor(options: Options) {
    const size = options.size;
    if (size !== undefined) this.size = size;
  }
}
class Vault {
  #held?: number;
  constructor(held: number) {
    if (held !== undefined) this.#held = held;
  }
  read() {
    return this.#held ?? "none";
  }
}
class Early {
  value?: number;
  constructor(value: number) {
    if (value === undefined) return;
    this.value = value;
  }
}
const nothing: any = undefined;
const empty: any = {};
const five: any = 5;
console.log(
  [new Leaf(1, "one"), new Leaf(nothing, five)]
    .map(leaf => (leaf.extra ?? "no extra") + "|" + (leaf.label ?? "no label"))
    .join(),
);
console.log(new Sized({ size: 3 }).size ?? "none", new Sized(empty).size ?? "none");
console.log(new Vault(1).read(), new Vault(nothing).read());
console.log(new Early(1).value ?? "none", new Early(nothing).value ?? "none");
