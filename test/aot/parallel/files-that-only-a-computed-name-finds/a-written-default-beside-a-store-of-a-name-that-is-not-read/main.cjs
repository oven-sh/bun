// A DECLARED LIMIT. docs/compiler/compatibility.mdx: "Any other default isn't compiled", "one in a variable that's also assigned a value the build can't read".
// Under `bun run` the default is loaded. The build follows a name that is stored to only where every store writes a default, so the executable holds no conf.cjs.
let name = "./conf.cjs";
if (process.argv.length > 99) name = process.argv[99];
try {
  console.log(require(name).name);
} catch (error) {
  console.log(error.code);
}
/* Output:
MODULE_NOT_FOUND
*/
