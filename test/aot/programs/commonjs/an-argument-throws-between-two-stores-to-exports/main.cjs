// An argument throws between two stores to exports.
let m; try { m = require("./m.cjs"); } catch (e) { console.log("caught", e.message); }
console.log(JSON.stringify(require("./peek.cjs").held));
