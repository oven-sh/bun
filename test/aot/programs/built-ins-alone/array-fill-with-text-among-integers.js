const list = [1, 2, 3];
const result = list.fill("text", 2, 3);
console.log(result === list, Array.isArray(list), list.length, typeof list[0], list[0] + 1);
console.log(typeof list[1], list[1] + 1, typeof list[2], list[2].length, list[2]);
