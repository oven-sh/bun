const map = new Map();
const set = new Set();
console.log(map.size, set.size);
map.set("a", 1);
set.add(1);
console.log(map.size, set.size);
map.clear();
set.delete(1);
console.log(map.size, set.size);
