const result = new Buffer("an", 2.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
