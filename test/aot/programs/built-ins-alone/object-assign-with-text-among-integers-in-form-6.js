const result = Object.assign(5n, "text", 1.5);
console.log(result instanceof BigInt, typeof result.valueOf(), result.valueOf() + 1n);
