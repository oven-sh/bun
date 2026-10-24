function Item(name) {
  this.name = name;
  this.next = null;
}
Item.prototype.describe = function () {
  return String(this.name) + ":" + String(this.next) + ":" + Object.keys(this).length;
};
function Other() {}
const made = new Item("made");
const created = Object.create(Item.prototype);
const reflected = Reflect.construct(Other, [], Item);
const reflectedObject = Reflect.construct(Object, [], Item);
const borrowed = { name: "borrowed", describe: Item.prototype.describe };
for (const item of [made, created, reflected, reflectedObject, borrowed]) console.log(item.describe(), item instanceof Item);
Item.call(created, "filled late");
console.log(created.describe());
