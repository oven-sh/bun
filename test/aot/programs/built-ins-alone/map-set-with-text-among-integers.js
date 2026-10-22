const map = new Map([["first", 1], ["second", 2]]);
const result = map.set("text", "text");
console.log(result === map, map instanceof Map, map.size, typeof map.get("first"), map.get("first") + 1);
console.log(typeof map.get("second"), map.get("second") + 1, [...map.keys()].join());
