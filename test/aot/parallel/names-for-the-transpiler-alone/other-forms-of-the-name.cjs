// Guards: bun:os stands for os only where the transpiler reads the name: written out, or in an arm of ?: that it folds. A list, a record, a variable or a text joined at run time is read by the loader, which knows no such name.
const flag = process.argv.length > 5 ? 2 : 1;
const maybe = process.env.NO_SUCH_VARIABLE_HERE;
const fixed = "bun:os";
let loose = "bun:os";
const say = (name, f) => { let got; try { got = f(); } catch (error) { got = "THROWS " + error.code + " " + String(error.message).split("\n")[0].slice(0, 50); } console.log(name, typeof got === "string" ? got : [typeof got.EOL, typeof got.parse, typeof got.join].join()); };
say("an arm beside a list", () => require(flag === 2 ? ["bun:url"][0] : "bun:os"));
say("a template with a constant", () => require(`bun:${"os"}`));
say("in parentheses and asserted", () => require(("bun:os")));
say("nullish", () => require(maybe ?? "bun:os"));
say("and", () => require(flag && "bun:os"));
say("resolve of one", () => require.resolve("bun:os"));
say("resolve of a list", () => require.resolve(["bun:url", "bun:os"][flag]));
say("resolve of two", () => require.resolve(flag === 1 ? "bun:os" : "bun:url"));
say("another name, a list", () => { const load = require; return load(["bun:url", "bun:os"][flag]); });
say("module.require of one", () => module.require("bun:os"));
say("two arguments", () => require("bun:os", 1));
