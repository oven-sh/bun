const map = new Map([["first", 1], ["second", 2]]);
const result = map.getOrInsert("second", "text");
console.log(typeof result, result + 1);
