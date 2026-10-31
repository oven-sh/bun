// A file of a cycle calls through three files that have not begun functions and a class that read the lowest.
import("./first.mjs").then(all => console.log("loaded", all.viaThird(), all.viaClass()));
console.log("main ends");
