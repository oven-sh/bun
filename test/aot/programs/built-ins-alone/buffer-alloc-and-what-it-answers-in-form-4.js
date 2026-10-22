const result = Buffer.alloc(1.5, 2.5, 3.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1);
