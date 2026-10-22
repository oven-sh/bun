const map = new Map();
map.set(1.5, "a");
const list = [...map.keys()];
console.log(list[0] + 1, list.join());
