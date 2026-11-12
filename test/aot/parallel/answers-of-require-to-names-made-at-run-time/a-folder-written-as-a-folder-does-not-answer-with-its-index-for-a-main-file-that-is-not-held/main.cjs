// A DECLARED LIMIT, AND LOUD. docs/compiler/compatibility.mdx: "If that file isn't in the executable, the name finds nothing, even if the executable holds another file the name could mean."
// tool/package.json names real.js, which nothing else names, so it is not in the executable. Under `bun run` "./tool" and "./tool/" are tool/real.js.
// The executable holds tool/index.js. "./tool" found nothing; "./tool/", the name written as that of a folder, answered index.js, without a word. Now it finds nothing either.
// The expected output is written down.
console.log(require("./tool/index.js").who);
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
for (const name of ["./tool", "./tool/"]) {
  try {
    console.log(name, require(made(name)).who);
  } catch (error) {
    console.log(name, "threw", error.code);
  }
}
/* Output:
tool/index.js
./tool threw MODULE_NOT_FOUND
./tool/ threw MODULE_NOT_FOUND
*/
