// A DECLARED LIMIT. docs/compiler/compatibility.mdx: "A function that stores a default into its own parameter, as in `file ||= "./plugins/a.ts"`, also hides the paths that its callers pass."
// Under `bun run` both files are loaded. The executable holds the default and not the file that the second call names.
function load(name) {
  name ||= "./conf.cjs";
  return require(name);
}
console.log(load(process.env.MADE_UP_CONF).name);
try {
  console.log(load("./other.cjs").name);
} catch (error) {
  console.log(error.code);
}
/* Output:
default
MODULE_NOT_FOUND
*/
