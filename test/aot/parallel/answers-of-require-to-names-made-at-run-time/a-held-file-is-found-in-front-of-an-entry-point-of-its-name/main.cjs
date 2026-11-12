// tool.ts is named in a function that nothing calls, so the executable holds it for a name made at run time. "./tool" and "./tool.ts" are that file, as in `bun run`.
// tool.js, an entry point, is embedded under the same `.js` name that tool.ts would have: it answered for both.
// Entry points: ./tool.js
function never() {
  return require("./tool.ts");
}
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
for (const name of ["./tool", "./tool.ts", "./tool.js"]) console.log(name, require(made(name)).who);
