const result = Object.assign(true, "text", 1.5);
console.log(result instanceof Boolean, typeof result.valueOf(), result.valueOf());
