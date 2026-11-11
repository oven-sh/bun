console.log("before");
console.log(require("./levels.ts")["Level"]["High"]);
if (JSON.parse("false")) {
  var held = require("./levels.ts");
}
try {
  console.log(held["Level"].High);
} catch (error) {
  console.log(error.name);
}
try {
  console.log(held.Level["Low"]);
} catch (error) {
  console.log(error.name);
}
