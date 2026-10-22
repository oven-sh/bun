const list = [];
const result = list.splice(1, 2, 3.5, "x");
console.log(Array.isArray(result), result.length, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, typeof list[1], list[1].length, list[1]);
