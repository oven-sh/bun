class Item { size = 2; double() { return this.size * 2; } }
const groups = Object.groupBy([new Item()], () => "all");
console.log(groups.all[0].double());
