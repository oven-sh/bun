// Guards: bun:os stands for os only where the transpiler reads the name: written out, or in an arm of ?: that it folds. A list, a record, a variable or a text joined at run time is read by the loader, which knows no such name.
const flag = process.argv.length > 5 ? 2 : 1;
const say = async (name, f) => { let got; try { got = await f(); } catch (error) { got = "THROWS " + error.code; } console.log(name, typeof got === "string" ? got : [typeof got.EOL, typeof got.parse, typeof got.join].join()); };
await say("import of a list", () => import(["bun:url", "bun:os"][flag]));
await say("import of one", () => import("bun:os"));
await say("import of two", () => import(flag === 1 ? "bun:os" : "bun:url"));
await say("import.meta.require of a list", () => import.meta.require(["bun:url", "bun:os"][flag]));
await say("import.meta.require of one", () => import.meta.require("bun:os"));
await say("getBuiltinModule of a list", () => process.getBuiltinModule(["bun:url", "bun:os"][flag]) ?? "nothing");
