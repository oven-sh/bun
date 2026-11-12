if (process.argv.length > 99) require("./x.cjs");
const copy = Object.assign({}, require.main);
copy[Object.keys(copy).find(key => key.startsWith("req"))]("./x.cjs");
/* Output:
exit code 1
error: Cannot load '/$bunfs/root/x.cjs': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
