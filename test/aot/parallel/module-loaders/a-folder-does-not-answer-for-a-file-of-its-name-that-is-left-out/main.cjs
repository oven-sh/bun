// A DECLARED LIMIT, AND LOUD. docs/compiler/compatibility.mdx: a dynamic path finds what was compiled into the executable. tool.js is named only in a function that nothing calls, so it is left out.
// Under `bun run` "./tool" is tool.js, for require() and for import(). The executable holds tool/index.js, an entry point, which answers to the same name: it answered, without a word. Now the name finds nothing.
// The expected output is written down.
// Entry points: ./tool/index.js
function never() {
  return require("./tool.js");
}
const name = JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"./tool"');
const tell = error => console.log("threw", error.code);
try {
  console.log(require(name).who);
} catch (error) {
  tell(error);
}
import(name).then(it => console.log(it.who), tell);
/* Output:
threw MODULE_NOT_FOUND
threw ERR_MODULE_NOT_FOUND
*/
