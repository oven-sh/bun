const result = new Buffer(1.5, 2.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
