// A file from disk is refused the program's own files, whatever names them: what it would change in a second copy does not reach the program.
// Flags: --aot-allow-code-from-disk
const kit = require("./kit");
const load = name => require(Buffer.from(__dirname + "/" + name).toString());
globalThis.names = ["./kit", require.resolve("./kit"), __dirname + "/kit/index.js", __filename.replace("main.cjs", "kit/parts/part.js")];
console.log(load("config.cjs"), kit.name, kit.count);
let code;
try {
  load("config.mjs");
} catch (error) {
  code = error.code;
}
console.log(code);
import("./kit/module.mjs").then(module => console.log(module.value, kit === require("./kit")));
/* Output:
[ "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "on disk alone" ] kit part 0
ERR_MODULE_NOT_FOUND
42 true
*/
