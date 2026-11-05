// Members of native modules that load modules or evaluate text, each imported by name and called; a line is printed behind each call.
import { getBuiltinModule } from "node:process";
import { createRequire } from "node:module";
import { Transpiler } from "bun";
const join = (...parts) => parts.join("");
console.log("getBuiltinModule:", typeof getBuiltinModule(join("node:", "path")).basename);
console.log("behind getBuiltinModule");
console.log("createRequire:", typeof createRequire(import.meta.url)(join("node:", "url")).parse);
console.log("behind createRequire");
console.log("Transpiler:", new Transpiler({ loader: "ts" }).transformSync("let a: number = 1; console.log(a)").replace(/\s+/g, " ").trim());
console.log("behind Transpiler");
