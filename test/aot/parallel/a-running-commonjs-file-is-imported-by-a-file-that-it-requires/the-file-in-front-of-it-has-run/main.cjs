require("./m4.cjs");
try { require("./m1.mjs"); } catch (e) { console.log("main caught", e.name); }
console.log("main ends");
