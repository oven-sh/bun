// require(path, { type }) asks for the file at the path, not for the module: the module does not run. `bun run` answers a namespace object with the text as its default, an executable the text itself, as for any text file.
globalThis.evaluated = [];
const textOf = answer => (typeof answer === "string" ? answer : answer.default);
console.log(JSON.stringify(textOf(require("./module.cjs", { type: "text" }))), "evaluated:", globalThis.evaluated.join());
console.log(JSON.stringify(textOf(module.require("./data.json", { type: "text" }))));
console.log(JSON.stringify(require("./parsed.json", { type: "json" })), JSON.stringify(require("./parsed.json", {})), JSON.stringify(require("./parsed.json", undefined)));
console.log(require("./other.cjs", {}).name, require("./other.cjs", undefined).name, "evaluated:", globalThis.evaluated.join());
