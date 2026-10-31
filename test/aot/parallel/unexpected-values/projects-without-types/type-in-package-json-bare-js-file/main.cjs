const { show } = require("./show.cjs");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

globalThis.modes = [];
async function main() {
  for (const folder of ["typed-module", "typed-commonjs", "no-type", "no-package-json"]) {
    globalThis.asked = folder + " required";
    try {
      require("./" + folder + "/required.js");
    } catch (error) {
      console.log(globalThis.asked, "threw", error.constructor.name);
    }
    globalThis.asked = folder + " imported";
    try {
      await import("./" + folder + "/imported.js");
    } catch (error) {
      console.log(globalThis.asked, "threw", error.constructor.name);
    }
  }
  for (const mode of globalThis.modes) console.log(show(mode));
}
main();
