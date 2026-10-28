import("./first.mjs").then(all => console.log("loaded", all.viaThird(), all.viaClass()));
console.log("main ends");
