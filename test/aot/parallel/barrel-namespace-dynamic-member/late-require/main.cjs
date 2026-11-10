function late() { const ns = require("./index.mjs"); return Object.keys(ns).join(); }
(async () => {
  console.log("BEFORE");
  console.log("SAID", await late());
  console.log("AFTER");
})();
