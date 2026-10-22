const list = [];
const first = [];
const second = [];
const third = [];
const result = list.concat(first, second, third, 4.5, "an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1].length, result[1]);
