const result = Object.assign(true, 2.5, "-");
console.log(result instanceof Boolean, typeof result.valueOf(), result.valueOf());
