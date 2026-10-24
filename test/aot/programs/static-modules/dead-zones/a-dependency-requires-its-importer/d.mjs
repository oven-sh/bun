let found;
try {
  found = require("./a.mjs");
} catch (error) {
  console.log("d cannot require", error.constructor.name);
}
try {
  console.log("d", typeof found?.f, found?.f?.());
} catch (error) {
  console.log("d", error.constructor.name);
}
