// `bun run` hands a file under its mark to the engine as it is written, so a directive there is what the language takes for one.
console.log("the directive:", require("./plain.js"));
console.log("in parentheses:", require("./parentheses.js"));
console.log("with an escape:", require("./escape.js"));
console.log("behind another text in parentheses:", require("./behind-parentheses.js"));
console.log("behind a hashbang:", require("./hashbang.js"));
