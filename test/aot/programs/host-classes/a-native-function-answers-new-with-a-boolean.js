// Bun lets `new` be applied to the tests of node:util's types and to two of node:buffer, and they answer it as they answer a call.
const { types } = require("node:util");
const { isAscii } = require("node:buffer");
const isDate = new types.isDate(new Date(0));
const isMap = new types.isMap(new Date(0));
const ascii = new isAscii(Buffer.from("a"));
for (const answer of [isDate, isMap, ascii]) console.log(typeof answer, answer === true, answer === false, answer ? "yes" : "no");
console.log(typeof isDate === "boolean" ? "a boolean" : "no boolean", typeof ascii === "object" ? "an object" : "no object", [isDate].includes(true), Object(isMap) === isMap);
