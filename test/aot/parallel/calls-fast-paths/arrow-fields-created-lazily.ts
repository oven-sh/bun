// An arrow function in a field of a class that captures nothing but `this` is a function object of its own for every object. Nobody can tell when it is made: here it is not made while the object is
// constructed, and a call through the field needs none at all.
// CALLS- Panel NewTypedClosure
class Panel {
  title: string;
  width = 1;
  items: number[] = [];
  open = () => this.toggle(true);
  close = () => this.toggle(false);
  grow = (by: number) => (this.width += by);
  describe = () => this.title + ":" + this.width + (this.isOpen ? " open" : " closed");
  rename = (title: string) => { this.title = title; };
  count = () => this.items.length;
  constant = () => 42;
  named = function (this: unknown): string { return typeof this; };
  isOpen = false;
  constructor(title: string) { this.title = title; }
  toggle(open: boolean): boolean { return (this.isOpen = open); }
}
class Wide extends Panel { extra = () => this.width * 2; override describe = () => "wide " + this.title; }
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
const first = new Panel("first"), second = new Panel("second");
show("called", () => [first.open(), first.grow(2), first.describe(), second.describe(), first.count(), first.constant()].join());
show("one function an object", () => [first.describe === first.describe, first.describe === second.describe, first.constant === first.constant, first.constant === second.constant].join());
const { describe, rename } = second;
rename("renamed");
show("detached", () => [describe(), describe === second.describe, describe.call(first), describe.name, describe.length, rename.length, typeof describe, describe instanceof Function].join());
show("keys", () => [Object.keys(first).join(), Object.keys(new Panel("fresh")).join(), JSON.stringify(new Panel("fresh"))].join(" "));
show("has", () => ["close" in new Panel("fresh"), Object.hasOwn(new Panel("fresh"), "close"), Object.getOwnPropertyDescriptor(new Panel("fresh"), "close")!.writable, Object.getOwnPropertyNames(new Panel("fresh")).length].join());
show("values", () => Object.values(new Panel("fresh")).map(value => typeof value).join());
show("entries", () => Object.entries(new Panel("fresh")).filter(([, value]) => typeof value === "function").map(([key, value]) => key + "=" + (value as Function).name).join());
show("spread", () => { const fresh = new Panel("fresh"); const copy = { ...fresh }; fresh.rename("later"); return [copy.describe(), copy.describe === fresh.describe, copy.title].join(); });
show("stored to", () => { const fresh = new Panel("fresh"); const before = fresh.count; fresh.count = () => 7; return [fresh.count(), before(), before === fresh.count].join(); });
show("stored to before it is read", () => { const fresh = new Panel("fresh"); fresh.count = () => 8; return fresh.count(); });
show("another object's", () => { const fresh = new Panel("fresh"); fresh.describe = first.describe; return [fresh.describe(), fresh.describe === first.describe].join(); });
show("through any", () => { const fresh: any = new Panel("fresh"); return [fresh.describe(), fresh["grow"](3), fresh.describe === fresh.describe, fresh.constant()].join(); });
show("handed on", () => [new Panel("a"), new Panel("b")].map(panel => panel.describe).map(f => f()).join());
show("frozen", () => { const fresh = Object.freeze(new Panel("fresh")); return [fresh.describe(), fresh.describe === fresh.describe, Object.isFrozen(fresh)].join(); });
class Marked { n = 1; read = () => this.n; }
show("properties of its own", () => { const fresh = new Marked(); (fresh.read as any).mark = 1; return [(fresh.read as any).mark, (new Marked().read as any).mark, fresh.read()].join(); });
show("heir", () => { const wide = new Wide("w"); return [wide.describe(), wide.extra(), wide.open(), wide.count(), Object.keys(wide).join(), wide.describe === wide.describe].join(" "); });
show("for in", () => { const names: string[] = []; for (const name in new Panel("fresh")) names.push(name); return names.join(); });
show("a function that is no arrow", () => [first.named(), first.named === first.named, first.named === second.named].join());
let total = 0;
const kept: Panel[] = [];
for (let i = 0; i < 2000; i++) { const panel = new Panel("p" + i); kept[i & 7] = panel; panel.grow(i & 3); total += panel.width + panel.count() + (i % 500 ? 0 : panel.describe().length); }
console.log(total, kept.map(panel => panel.describe()).join());
