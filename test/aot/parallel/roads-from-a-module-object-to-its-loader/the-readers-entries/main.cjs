const first = require("./shelf.cjs");
const load = Object.entries(process.mainModule).find(([, part]) => typeof part === "function")[1];
console.log(load("./shelf.cjs") === first, first.label);
/* Output:
exit code 1
error: Cannot load '/$bunfs/root/shelf.cjs': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
