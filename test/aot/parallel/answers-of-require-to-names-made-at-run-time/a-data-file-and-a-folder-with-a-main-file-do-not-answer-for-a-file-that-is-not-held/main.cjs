// A DECLARED LIMIT, AND LOUD. docs/compiler/compatibility.mdx: "If that file isn't in the executable, the name finds nothing, even if the executable holds another file the name could mean."
// Nothing names table.js and tool.js, so they are not in the executable. Under `bun run` "./table" is table.js and "./tool" is tool.js.
// The executable holds table.json, which is found without its extension, and tool/real.js, the main file of the folder tool: they answered, without a word. Now the two names find nothing.
// The expected output is written down.
// Entry points: ./tool/real.js
console.log(require("./table.json").who);
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
for (const name of ["./table", "./table.json", "./tool", "./tool/"]) {
  try {
    console.log(name, require(made(name)).who);
  } catch (error) {
    console.log(name, "threw", error.code);
  }
}
/* Output:
table.json
./table threw MODULE_NOT_FOUND
./table.json table.json
./tool threw MODULE_NOT_FOUND
./tool/ tool/real.js
*/
