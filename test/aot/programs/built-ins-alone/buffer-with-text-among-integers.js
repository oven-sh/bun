const result = Buffer(1.5, "text");
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
