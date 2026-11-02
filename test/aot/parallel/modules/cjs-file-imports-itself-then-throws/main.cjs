// While require() loads an ES module, a CommonJS file of the graph calls import() of a CommonJS file that is still running, itself or the file that required it, and that file throws.
// The loader takes the steps of the import() inside the call and leaves an empty record for the running file. What the file throws is lost, and a later require() of it gets the names of that record.
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
