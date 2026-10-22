const result = process.hrtime();
console.log(Array.isArray(result), result.length, typeof result[0], typeof result[1]);
