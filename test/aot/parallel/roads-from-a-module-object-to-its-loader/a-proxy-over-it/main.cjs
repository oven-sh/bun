if (process.argv.length > 99) require("./x.cjs");
new Proxy(require.main, {}).require("./x.cjs");
/* Output:
exit code 1
error: Cannot load '/$bunfs/root/x.cjs': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
