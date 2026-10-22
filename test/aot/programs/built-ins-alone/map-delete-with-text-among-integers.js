const map = new Map([["first", 1], ["second", 2]]);
const result = map.delete("second");
console.log(typeof result, result, map instanceof Map, map.size);
console.log(typeof map.get("first"), map.get("first") + 1, [...map.keys()].join());
