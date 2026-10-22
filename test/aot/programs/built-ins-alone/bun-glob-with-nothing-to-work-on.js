const result = new Bun.Glob("");
console.log(typeof result, Object.keys(result).join());
