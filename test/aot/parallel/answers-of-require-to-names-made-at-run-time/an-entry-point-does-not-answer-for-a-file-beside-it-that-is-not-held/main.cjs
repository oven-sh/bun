// A DECLARED LIMIT, AND LOUD. docs/compiler/compatibility.mdx: "If that file isn't in the executable, the name finds nothing, even if the executable holds another file the name could mean."
// Nothing names tool.ts, tool.mjs and other.js, so they are not in it.
// An executable finds an entry point under the name of its output and under every extension. Where `bun run` finds ANOTHER file under such a name, the entry point answered for it, without a word:
// "./tool" and "./tool.ts" are tool.ts, "./tool.mjs" is tool.mjs, "./other.js" is other.js. Now those names find nothing. The expected output is written down.
// Entry points: ./tool.js ./other.ts
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
for (const name of [
  "./tool",
  "./tool.ts",
  "./tool.mjs",
  "./tool.js",
  "./tool.cjs",
  "./other",
  "./other.ts",
  "./other.js",
]) {
  try {
    console.log(name, require(made(name)).who);
  } catch (error) {
    console.log(name, "threw", error.code);
  }
}
/* Output:
./tool threw MODULE_NOT_FOUND
./tool.ts threw MODULE_NOT_FOUND
./tool.mjs threw MODULE_NOT_FOUND
./tool.js tool.js
./tool.cjs tool.js
./other other.ts
./other.ts other.ts
./other.js threw MODULE_NOT_FOUND
*/
