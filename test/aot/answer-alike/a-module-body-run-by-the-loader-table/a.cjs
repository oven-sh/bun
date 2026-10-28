// The table of loaders of node:module is asked to run the body of a module into a module object that the program made.
const Module = require("node:module");
const path = require.resolve("./body.js");
const mine = new Module(path, null); mine.filename = path; mine.paths = []; mine.exports = { given: "given" };
let answer; try { Module._extensions[".js"](mine, path); answer = [mine.exports.value, globalThis.runs, mine.exports.given].join(" "); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); }
console.log(answer);
