// An ES module hands on names of two CommonJS files, one that stores them and one that puts an object made by a helper in place of
// `module.exports`. A CommonJS file requires the ES module and calls functions through what it got; they read other names through `this`.
const all = require("./hands-on.mjs");
console.log(all.callsStored(), all.callsCopied());
console.log(require("./hands-on.mjs").callsStored?.(), all["callsCopied"]());
