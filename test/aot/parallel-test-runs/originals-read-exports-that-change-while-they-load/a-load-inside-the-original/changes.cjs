require("./config.cjs").set("debug");
console.log("SAID inside", require("./inner.mjs").look());
