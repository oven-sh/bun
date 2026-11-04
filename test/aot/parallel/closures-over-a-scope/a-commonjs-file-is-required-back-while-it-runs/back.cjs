const lib = require("./lib.cjs");
let said;
try {
  said = lib.read();
} catch (error) {
  said = "throws " + error.name;
}
console.log("back:", said);
