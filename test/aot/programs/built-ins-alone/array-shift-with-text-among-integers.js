const list = [1, 2, 3];
const result = list.shift();
console.log(typeof result, result + 1, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, typeof list[1], list[1] + 1);
