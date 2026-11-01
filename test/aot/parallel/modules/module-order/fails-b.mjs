import "./fails-a.mjs";
console.log("fails-b runs");
throw new RangeError("in fails-b");
