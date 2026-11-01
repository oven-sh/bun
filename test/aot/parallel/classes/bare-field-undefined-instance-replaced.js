// The parent is replaced by a function that makes a real instance with Reflect.construct, keeps it and fixes a later field, so the constructor stops half way.
const kept = [];
class Above {}
class Item {
  constructor() {
    this.x = 1;
  }
}
class Below extends Above {
  item;
  count;
  label;
  constructor(item, count) {
    super();
    this.item = item;
    this.count = count;
    this.label = "s";
  }
}
function read(below) {
  return below.item.x + below.count;
}
console.log(read(new Below(new Item(), 2)));
Object.setPrototypeOf(Below, function () {
  const made = Reflect.construct(Above, [], new.target);
  kept.push(made);
  Object.defineProperty(made, "label", { value: "fixed" });
  return made;
});
try {
  new Below(new Item(), 3);
} catch (error) {
  console.log(error.name);
}
console.log(kept[0] instanceof Below, kept[0].item, kept[0].count, JSON.stringify(kept[0]));
try {
  console.log(read(kept[0]));
} catch (error) {
  console.log(error.name);
}
