const set = new Set();
set.add(1.5);
const list = [...set.values()];
console.log(list[0] + 1, list.join());
