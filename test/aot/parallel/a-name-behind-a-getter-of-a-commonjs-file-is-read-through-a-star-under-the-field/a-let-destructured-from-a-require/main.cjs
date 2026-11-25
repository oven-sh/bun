const { make } = require("./outer/index.mjs");
(async () => {
  console.log("SAID", typeof make);
})();
