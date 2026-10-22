// The class has a method and an accessor from the start; some instances get an own field under the method's name.
// Then the method is replaced on the prototype by another function, by a getter with a setter, and is deleted. The name is one the prototype is known to have.
const log: string[] = [];
class Item {
  declare id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
  label(): string {
    return "method of " + this.id;
  }
  get double() {
    return this.id * 2;
  }
}
function call(item: Item) {
  return item.label?.();
}
function give(item: Item, f: () => string) {
  item.label = f;
}
function state(item: Item) {
  return `${call(item)} ${Object.hasOwn(item, "label")} ${item.double} [${Object.keys(item)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const item = new Item(i & 7);
  length += call(item).length;
  if (i & 1) give(item, () => "own");
  length += call(item).length + item.double;
}
console.log("warm", length);

const bare = new Item(1);
const covered = new Item(2);
give(covered, () => "own of 2");
console.log("start:", state(bare), "|", state(covered));
(Item.prototype as any)["la" + "bel"] = function (this: Item) {
  return "replaced for " + this.id;
};
console.log("replaced:", state(bare), "|", state(covered), "|", state(new Item(3)));
Object.defineProperty(Item.prototype, "label", {
  get(this: Item) {
    return () => "from the getter for " + this.id;
  },
  set(this: Item, value: () => string) {
    log.push(`set on ${this.id}: ${value()}`);
  },
  configurable: true,
});
console.log("accessors:", state(bare), "|", state(covered), "|", state(new Item(3)));
give(bare, () => "late");
give(covered, () => "own again");
console.log("stored:", state(bare), "|", state(covered), "|", log.join(", "));
delete (covered as any).label;
console.log("own one deleted:", state(covered));
delete (Item.prototype as any).label;
console.log("no method:", state(bare), "|", state(covered), "|", "label" in bare);
give(bare, () => "own at last");
console.log("stored:", state(bare), log.length);
Object.defineProperty(Item.prototype, "double", { value: -1, configurable: true });
console.log("the accessor became a value:", state(bare), new Item(4).double);
