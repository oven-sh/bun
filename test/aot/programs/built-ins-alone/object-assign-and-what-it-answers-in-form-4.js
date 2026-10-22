const result = Object.assign(true, "-", "-");
console.log(result instanceof Boolean, typeof result.valueOf(), result.valueOf());
