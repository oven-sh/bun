globalThis.shown = value => typeof value + " " + Object.keys(value).join();
console.log("requires-main begins");
require("./main.mjs");
console.log("requires-main ends");
