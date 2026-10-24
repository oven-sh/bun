function Item(name) {
  this.name = name;
  this.next = null;
  this.last = null;
}
function read(item) {
  return [item.next, item.last, "next" in item, Object.hasOwn(item, "last"), Object.keys(item).join()].map(String).join(" ");
}
const a = new Item("a"), b = new Item("b"), c = new Item("c");
a.next = b;
delete b.next;
delete c["la" + "st"];
console.log(read(a).replace("[object Object]", "b"));
console.log(read(b));
console.log(read(c));
b.next = c;
c.last = 1;
console.log(read(b).replace("[object Object]", "c"));
console.log(read(c));
Item.prototype.next = "inherited";
delete b.next;
console.log(read(b), read(a).replace("[object Object]", "b"));
