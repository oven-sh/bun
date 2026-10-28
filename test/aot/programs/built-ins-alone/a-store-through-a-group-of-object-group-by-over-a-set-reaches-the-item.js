class Item { size = 2; }
const item = new Item();
const groups = Object.groupBy(new Set([item]), () => "all");
groups.all[0].size = "text";
console.log(item.size.length);
