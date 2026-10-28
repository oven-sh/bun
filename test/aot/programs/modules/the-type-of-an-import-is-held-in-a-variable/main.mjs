const options = { with: { type: "text" } };
const loaded = await import("./other.mjs", options);
console.log(JSON.stringify(loaded.default));
