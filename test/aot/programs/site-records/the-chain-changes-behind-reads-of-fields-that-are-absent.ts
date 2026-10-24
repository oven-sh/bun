// An optional field that an object lacks is answered by the chain above it. The chain changes between the reads: a property appears on the prototype, becomes a getter, goes away, the prototype is exchanged.
class Base {
  kind = "base";
}
class Item extends Base {
  id = 1;
  declare label?: string;
  declare weight?: number;
}

const trail: string[] = [];

function labelOf(item: Item): unknown {
  return item.label;
}
function weightOf(item: Item): unknown {
  return item.weight;
}
function labelOrDefault(item: Item): string {
  return item.label ?? "none";
}
function look(mark: string, item: Item): void {
  console.log(mark + ":", String(labelOf(item)), String(labelOf(item)), String(weightOf(item)), labelOrDefault(item), "label" in item, Object.keys(item).join(), trail.splice(0).join(";"));
}

const item = new Item();
const withLabel = new Item();
withLabel.label = "own";

look("absent", item);
look("present", withLabel);
(Item.prototype as any).label = "on the prototype";
look("on the prototype", item);
look("present", withLabel);
(Base.prototype as any).weight = 70;
look("weight two levels up", item);
Object.defineProperty(Item.prototype, "label", {
  get() {
    trail.push("getter for " + (this as Item).id);
    return "from a getter";
  },
  configurable: true,
});
look("a getter on the prototype", item);
look("present", withLabel);
delete (Item.prototype as any).label;
look("gone again", item);
(Base.prototype as any).label = "two levels up";
look("label two levels up", item);
(Item.prototype as any).label = undefined;
look("undefined in between", item);
delete (Item.prototype as any).label;
delete (Base.prototype as any).label;
delete (Base.prototype as any).weight;
look("all gone", item);

const other = { label: "another prototype", weight: 1.5 };
Object.setPrototypeOf(item, other);
look("another prototype", item);
other.label = "changed there";
look("changed there", item);
delete (other as any).label;
look("deleted there", item);
Object.setPrototypeOf(item, null);
look("no prototype", item);
Object.setPrototypeOf(item, Item.prototype);
look("the old prototype", item);
Object.setPrototypeOf(Item.prototype, { label: "above the class", weight: 2 });
look("the class hangs elsewhere", item);
look("a new object", new Item());
look("present", withLabel);
Object.setPrototypeOf(Item.prototype, Base.prototype);
look("as at first", item);

export {};
