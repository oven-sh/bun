const text = require("./part.cjs", { type: "text" });
require("./forget.cjs")(require.resolve("./part.cjs"));
const code = require("./part.cjs");
console.log(Object.keys(text).join(), Object.keys(code).join(), globalThis.ran);
