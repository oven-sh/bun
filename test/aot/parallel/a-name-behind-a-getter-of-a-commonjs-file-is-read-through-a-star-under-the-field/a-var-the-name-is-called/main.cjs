const outer = require("./outer/index.mjs");
(async () => {
  console.log("SAID", outer.make());
})();
