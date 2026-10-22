const result = new Set("text");
console.log(result instanceof Set, result.size, result.has("t"), result.has("e"));
console.log(typeof [...result][2], [...result][2].length, [...result][2]);
