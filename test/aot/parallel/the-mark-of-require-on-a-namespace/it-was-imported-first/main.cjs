import("./lib.mjs").then(all => {
  console.log("SAID imported", typeof all.__esModule, all.later());
  const lib = require("./lib.mjs");
  console.log("SAID after", typeof lib.__esModule, lib.later(), lib === all);
});
