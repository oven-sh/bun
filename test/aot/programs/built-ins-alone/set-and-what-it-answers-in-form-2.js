const result = new Set("an");
console.log(result instanceof Set, result.size, result.has("a"), result.has("n"));
console.log(typeof [...result][1], [...result][1].length, [...result][1]);
