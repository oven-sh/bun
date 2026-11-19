// `./lib.js` is lib.ts where no file is called lib.js, and here a folder is. lib.ts is not in the executable, so the name finds nothing: the folder's index.js, which is, answered for it.
// The expected output is written down: under `bun run` both names find lib.ts.
// Entry points: ./lib.js/index.js
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
for (const name of ["./lib.js", "./lib.js/", "./lib.js/index.js"]) {
  try {
    console.log(name, require(made(name)).who);
  } catch (error) {
    console.log(name, "threw", error.code);
  }
}
/* Output:
./lib.js threw MODULE_NOT_FOUND
./lib.js/ threw MODULE_NOT_FOUND
./lib.js/index.js lib.js/index.js
*/
