console.log("imported begins");
const names = require("./required.mjs");
console.log("imported reads", Object.keys(names).join(), names.value);
export {};
