const key = Reflect.ownKeys(Buffer.prototype).find(name => typeof name === "symbol" && String(name.description).endsWith("custom"));
console.log(typeof key);
const parcel = {};
parcel[key] = (depth, options, inspect) => "own keys by Reflect: " + inspect([1, 2]);
console.log(parcel);
