const list = [1, 2, 3];
const result = list.unshift("text", 1.5);
console.log(typeof result, result + 1, Array.isArray(list), list.length);
console.log(typeof list[0], list[0].length, list[0], typeof list[1], list[1] + 1);
console.log(typeof list[2], list[2] + 1, typeof list[3], list[3] + 1);
