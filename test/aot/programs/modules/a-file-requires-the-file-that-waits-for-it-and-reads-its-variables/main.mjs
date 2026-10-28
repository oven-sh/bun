// waiting.mjs imports asks.mjs, and asks.mjs requires waiting.mjs: it gets the names of a file whose code has not begun.
import("./waiting.mjs").then(all => console.log("loaded", all.count, all.changing, all.Kind.z));
console.log("main ends");
