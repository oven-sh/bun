// The file that requires the one that throws is left by the same throw, and runs again too.
try {
  require("./outer.cjs");
} catch (e) {
  console.log("caught", e.message);
}
const outer = require("./outer.cjs");
console.log(String(outer.early), "|", String(outer.late), "|", outer.below);
