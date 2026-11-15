const names = ["Low", "High"];
console.log("before");
console.log(names[require("./levels.ts").Level.High]);
if (JSON.parse("false")) {
  var held = require("./levels.ts");
}
try {
  console.log(names[held.Level.Low]);
} catch (error) {
  console.log(error.name);
}
