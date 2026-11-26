globalThis.early = (globalThis.early ?? 0) + 1;
console.log("early");
module.exports = { v: "early" + globalThis.early };
