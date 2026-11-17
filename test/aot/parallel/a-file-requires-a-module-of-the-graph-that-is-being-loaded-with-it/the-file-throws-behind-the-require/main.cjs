console.log("main begins");
try { require("./top.mjs"); } catch (error) { console.log("main caught", error.message); }
console.log("main ends");
