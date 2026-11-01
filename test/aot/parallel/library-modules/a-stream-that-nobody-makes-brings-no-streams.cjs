// The bodies of the stream modules define classes and copy members from one prototype object to another. A program that takes one number out of node:stream holds what those bodies run.
// STATISTIC: ImageFunctionsEmitted <= 500
const { getDefaultHighWaterMark } = require("node:stream");
console.log(getDefaultHighWaterMark(false), getDefaultHighWaterMark(true));
