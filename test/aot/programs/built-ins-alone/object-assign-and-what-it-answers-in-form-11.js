const result = Object.assign(5n, 2.5, "-");
console.log(result instanceof BigInt, typeof result.valueOf(), result.valueOf() + 1n);
