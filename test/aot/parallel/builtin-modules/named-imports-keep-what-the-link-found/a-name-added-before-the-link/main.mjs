// A name that is added to node:path before a file is linked can be imported by that file.
const path = require("node:path");
path.nope = "added";
await import("./late.mjs").then(
  () => console.log("late.mjs is loaded"),
  error => console.log(error.name + ": " + error.message),
);
