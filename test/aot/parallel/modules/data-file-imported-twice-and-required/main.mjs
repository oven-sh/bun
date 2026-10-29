// Reference: bun build --compile
// One data file imported with and without a type, under two types, and required after it was imported: how many modules it is.
const plain = await import("./record.json");
const json = await import("./record.json", { with: { type: "json" } });
console.log(plain === json, plain.default === json.default);
const text = await import("./pairs.txt", { with: { type: "text" } });
const toml = await import("./pairs.txt", { with: { type: "toml" } });
console.log(text === toml, JSON.stringify(text.default));
const required = require("./record.json");
console.log(required === plain, required === plain.default, Object.prototype.toString.call(required));
