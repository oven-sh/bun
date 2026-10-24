// A callee that only writes a member of its parameter runs a setter where there is one: the setter keeps the object, keeps the stored value, stores something else or nothing at all.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Item {
  name: string;
}
interface Holder {
  item: Item | null;
  tag: string;
}
const keptHolders: Holder[] = [];
const keptItems: Item[] = [];
class PlainHolder {
  item: Item | null = null;
  constructor(public tag: string) {}
}
class KeepsBoth {
  constructor(public tag: string) {}
  get item(): Item | null {
    return null;
  }
  set item(value: Item | null) {
    keptHolders.push(this);
    if (value) keptItems.push(value);
  }
}
class StoresACopy {
  private inner: Item | null = null;
  constructor(public tag: string) {}
  get item(): Item | null {
    return this.inner;
  }
  set item(value: Item | null) {
    this.inner = value && { name: value.name + " (copy)" };
  }
}
function put(holder: Holder, item: Item): void {
  holder.item = item;
}
function putAndRead(holder: Holder, item: Item): string {
  put(holder, item);
  const back = holder.item;
  return holder.tag + ":" + (back === null ? "null" : back.name) + ":" + (back === item);
}
const lines: string[] = [];
for (let i = 0; i < 300; i++) {
  const line = putAndRead(new PlainHolder("plain" + i), { name: "item" + i });
  if (i % 100 === 0) lines.push(line);
  if (i % 100 === 33) lines.push(putAndRead(new KeepsBoth("keeps" + i), { name: "kept item" + i }));
  if (i % 100 === 66) lines.push(putAndRead(new StoresACopy("copies" + i), { name: "copied item" + i }));
  if (i % 100 === 99) {
    lines.push(
      putAndRead(
        {
          tag: "literal" + i,
          get item(): Item | null {
            return keptItems[0];
          },
          set item(value: Item | null) {
            keptHolders.push(this);
            if (value) keptItems.push(value);
          },
        },
        { name: "item for a literal " + i },
      ),
    );
  }
}
console.log(churn(60));
console.log(lines.join("\n"));
console.log(keptHolders.map(h => h.tag).join(), "|", keptItems.map(i => i.name).join());

// A constructor stores into `this`; an heir has a setter under the name. It runs before the heir's own fields exist, and `this` has left before the constructor is through.
const seenEarly: string[] = [];
const early: Base[] = [];
class Base {
  private stored: Item | null = null;
  constructor(value: Item) {
    this.value = value;
  }
  get value(): Item {
    return this.stored!;
  }
  set value(v: Item) {
    this.stored = v;
  }
}
class Heir extends Base {
  own = "own field";
  get value(): Item {
    return { name: "from the getter" };
  }
  set value(v: Item) {
    seenEarly.push(v.name + " while own is " + this.own);
    early.push(this);
    keptItems.push(v);
  }
}
function make(heir: boolean, i: number): Base {
  return heir ? new Heir({ name: "for an heir " + i }) : new Base({ name: "for the base " + i });
}
let names = "";
for (let i = 0; i < 200; i++) {
  const made = make(i % 90 === 89, i);
  if (i % 45 === 44) names += made.value.name + " | ";
}
console.log(churn(60), names);
console.log(seenEarly.join(" | "), early.map(e => (e as Heir).own).join(), keptItems.slice(-2).map(i => i.name).join());
