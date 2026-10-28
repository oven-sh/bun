import { init as initCommonJS, parse as parseCommonJS } from "cjs-module-lexer";
import { init, parse } from "es-module-lexer";
import { timed } from "./lib_http.ts";

await init;
await initCommonJS();
const source = `import a, { b as c } from "x"; export const d = 1; export default function e() {} export * from "y"; const f = import("z");`;
const [imports, exports] = parse(source);
console.log(JSON.stringify(imports), JSON.stringify(exports));
console.log(JSON.stringify(parseCommonJS(`exports.a = 1; module.exports.b = 2; Object.defineProperty(exports, "c", { enumerable: true, value: 3 }); module.exports = require("./r");`)));
const long = (source + "\n").repeat(20000);
console.log(await timed("2.6 MB of imports", () => parse(long)[0].length));
console.log("DONE");
