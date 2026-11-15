const make = require("./outer/index.mjs").make;
(async () => {
  console.log("SAID", typeof make);
})();
