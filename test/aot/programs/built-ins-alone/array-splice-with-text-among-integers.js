const list = [1, 2, 3];
const result = list.splice(1, 2, "text", 1.5);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, typeof list[1], list[1].length, list[1]);
console.log(typeof list[2], list[2] + 1);
