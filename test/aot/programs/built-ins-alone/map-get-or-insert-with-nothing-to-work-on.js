const map = new Map();
const result = map.getOrInsert("second", 2.5);
console.log(typeof result, result + 1, map instanceof Map, map.size);
console.log(typeof map.get("second"), map.get("second") + 1, [...map.keys()].join());
