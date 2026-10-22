const list = [];
const first = [];
const second = [];
const result = list.concat(first, second, 3.5, "x");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1].length, result[1]);
