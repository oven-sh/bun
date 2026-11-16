console.log("the body of the file begins");
const { middle } = require("./between.mjs");
console.log("the body of the file ends:", middle);
export const opening = "opening " + middle;
