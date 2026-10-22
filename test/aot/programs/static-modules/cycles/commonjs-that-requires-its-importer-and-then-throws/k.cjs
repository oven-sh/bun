console.log("k begins");
const m = require("./m.mjs");
console.log("k sees", Object.keys(m).join());
throw new Error("k throws");
