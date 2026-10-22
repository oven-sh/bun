exports.k = 1;
let found;
try {
  found = require("./a.mjs");
} catch (error) {
  console.log("k cannot require", error.constructor.name);
}
try {
  console.log("k", typeof found?.f, found?.f?.());
} catch (error) {
  console.log("k", error.constructor.name);
}
