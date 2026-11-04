globalThis.hook = () => require("./outside.mjs").seen;
console.log("first:", require("./first.mjs").ok);
console.log("second:", require("./second.mjs").ok);
console.log("outside:", require("./outside.mjs").seen);
