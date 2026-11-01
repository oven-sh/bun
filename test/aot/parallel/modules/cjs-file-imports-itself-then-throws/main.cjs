// While require() loads an ES module, a CommonJS file of the graph calls import() of a CommonJS file that is still running, itself or the file that required it, and that file throws.
// The call waits for the file, so what the file throws reaches the require() and the call. `bun run` takes the steps of the call inside the require(), leaves an empty record for the running file and loses the error.
// Todo: node runs a file that threw once more at the next require() of it, and the import() of that run is rejected too. The executable throws the same error again.
globalThis.say = (...words) => console.log(...words);
const show = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
for (const name of ["itself", "above"]) {
  try {
    name === "itself" ? require("./itself/module.mjs") : require("./above/module.mjs");
    say(name + ": required");
  } catch (error) {
    say(name + ": threw", error.message);
  }
  try {
    say(name + ": the file once more", show(name === "itself" ? require("./itself/file.cjs") : require("./above/file.cjs")));
  } catch (error) {
    say(name + ": the file once more threw", error.message);
  }
}
/* Output:
itself: the file runs
itself: threw the file that imports itself throws
itself: the file runs
itself: the file once more threw the file that imports itself throws
above: the file runs
above: the file below runs
above: threw the file above throws
above: the file runs
above: the file once more threw the file above throws
itself: file.cjs rejected the file that imports itself throws
itself: file.cjs rejected the file that imports itself throws
above: file.cjs rejected the file above throws
*/
