const result = new Object(5n);
console.log(result instanceof BigInt, typeof result.valueOf(), result.valueOf() + 1n);
