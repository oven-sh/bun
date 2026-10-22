function Item(name) {
  this.name = name;
  this.next = null;
  this.value = null;
}
function describe(item) {
  return item.name + ":" + typeof item.next + ":" + String(item.value) + ":" + (item.next === null ? "end" : item.next.name);
}
const items = [];
for (let i = 0; i < 6; i++) items.push(new Item("i" + i));
items[0].next = items[1];
items[1].next = items[2];
items[2].value = 7;
items[3].value = "seven";
items[4].value = 7.5;
items[5].value = undefined;
items[5].next = undefined;
for (const item of items) {
  try {
    console.log(describe(item));
  } catch (error) {
    console.log(item.name, error.constructor.name);
  }
}
console.log(JSON.stringify(items[3]), Object.keys(items[5]).join());
