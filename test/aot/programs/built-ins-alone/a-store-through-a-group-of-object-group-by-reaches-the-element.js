class Item {
  size = 1;
}
const item = new Item();
Object.groupBy([item], () => "all").all[0].size = "text";
console.log(typeof item.size, item.size.length);
