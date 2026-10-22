const result = Object.assign(5n, "-", "-");
console.log(result instanceof BigInt, typeof result.valueOf(), result.valueOf() + 1n);
