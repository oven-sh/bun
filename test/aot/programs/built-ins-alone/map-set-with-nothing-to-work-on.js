const map = new Map();
const result = map.set(1.5, 2.5);
console.log(result === map, map instanceof Map, map.size, typeof map.get(1.5), map.get(1.5) + 1);
console.log([...map.keys()].join());
