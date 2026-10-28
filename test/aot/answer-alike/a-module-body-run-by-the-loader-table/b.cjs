// a.cjs, and the program requires the module in the ordinary way first.
require("./body.js");
const Module = require("node:module");
const path = require.resolve("./body.js");
const mine = new Module(path, null); mine.filename = path; mine.paths = []; mine.exports = { given: "given" };
let answer; try { Module._extensions[".js"](mine, path); answer = [mine.exports.value, globalThis.runs, mine.exports.given].join(" "); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); }
console.log(answer);
