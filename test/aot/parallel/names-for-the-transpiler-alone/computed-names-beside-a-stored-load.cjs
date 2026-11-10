// Guards: bun:os stands for os only where the transpiler reads the name: written out, or in an arm of ?: that it folds. A list, a record, a variable or a text joined at run time is read by the loader, which knows no such name.
const Module = require("node:module"); const original = Module._load; Module._load = function (name, parent, isMain) { return original.call(this, name, parent, isMain); };
const flag = process.argv.length > 5 ? 2 : 1;
const maybe = process.env.NO_SUCH_VARIABLE_HERE;
const say = (name, f) => { let got; try { got = f(); } catch (error) { got = "THROWS " + error.code + " " + String(error.message).split("\n")[0].slice(0, 50); } console.log(name, typeof got === "string" ? got : [typeof got.EOL, typeof got.parse, typeof got.join].join()); };
say("list", () => require(["bun:url", "bun:os"][flag]));
say("list of one", () => require(["bun:os"][flag - 1]));
say("record", () => require({ a: "bun:url", b: "bun:os" }[flag === 1 ? "b" : "a"]));
say("variable", () => { const name = ["bun:url", "bun:os"][flag]; return require(name); });
say("or", () => require(maybe || "bun:os"));
say("two", () => require(flag === 1 ? "bun:os" : "bun:url"));
say("one", () => require("bun:os"));
say("joined", () => require("bun:" + "os"));
say("joined at run time", () => require("bun:" + ["url", "os"][flag]));
say("list of node names", () => require(["node:url", "node:os"][flag]));
say("list of bare names", () => require(["url", "os"][flag]));
say("mixed list", () => require(["bun:url", "os"][flag]));
say("mixed list, the other", () => require(["os", "bun:url"][flag]));
