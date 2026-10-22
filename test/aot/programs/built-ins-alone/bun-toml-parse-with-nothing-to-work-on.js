const first = new ArrayBuffer(0);
const result = Bun.TOML.parse(first);
console.log(typeof result, Object.keys(result).join());
