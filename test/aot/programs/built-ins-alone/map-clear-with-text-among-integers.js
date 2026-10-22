const map = new Map([["first", 1], ["second", 2]]);
const result = map.clear();
console.log(typeof result, result === undefined, map instanceof Map, map.size, [...map.keys()].join());
