console.log("SAID body of tax");
let n = 0;
module.exports = { rate: 1, get fee() { return () => ++n; }, show: () => Object.getOwnPropertyDescriptor(module.exports, "fee").get !== undefined };
