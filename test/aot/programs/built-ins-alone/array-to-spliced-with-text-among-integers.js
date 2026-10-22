const list = [1, 2, 3];
const result = list.toSpliced(1, 2, "text", 1.5);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1].length, result[1], typeof result[2], result[2] + 1);
