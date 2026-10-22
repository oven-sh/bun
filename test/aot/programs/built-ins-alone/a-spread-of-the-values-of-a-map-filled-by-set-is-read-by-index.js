const map = new Map();
map.set("a", 1.5);
const list = [...map.values()];
console.log(list[0] + 1, list.join());
