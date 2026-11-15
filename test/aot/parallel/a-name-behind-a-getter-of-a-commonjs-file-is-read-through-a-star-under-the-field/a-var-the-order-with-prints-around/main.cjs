console.log("MAIN BEGINS");
const make = require("./outer/index.mjs").make;
console.log("REQUIRED");
(async () => {
  console.log("SAID", typeof make);
})();
