const result = new Bun.Glob("banana");
console.log(typeof result, Object.keys(result).join());
