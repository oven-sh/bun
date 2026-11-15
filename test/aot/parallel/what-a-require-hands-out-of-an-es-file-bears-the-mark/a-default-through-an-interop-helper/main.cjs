const interop = loaded => (loaded && loaded.__esModule ? loaded.default : loaded);
const greet = interop(require("./greeting.mjs"));
console.log(typeof greet, typeof greet === "function" ? greet() : Object.keys(greet).join());
