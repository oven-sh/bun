console.log("holder begins");
const reader = require("./reader.mjs");
console.log("holder has", reader.seen);
export const limit = process.argv.length + 40;
console.log("holder later", reader.readLimit());
