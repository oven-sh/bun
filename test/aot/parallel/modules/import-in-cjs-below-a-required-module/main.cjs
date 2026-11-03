// require() loads an ES module that imports a CommonJS file, and that file calls import().
try { console.log("main", require("./r.mjs").r); } catch (e) { console.log("main caught", e.name); }
console.log("main ends");
