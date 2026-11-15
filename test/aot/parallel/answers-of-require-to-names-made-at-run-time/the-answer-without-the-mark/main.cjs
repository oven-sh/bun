// The text "./tray.mjs" below is how the build knows that the file may be named at run time.
"use strict";
const { seen } = require("./beside.mjs");
function load(name) {
  return require(name).label;
}
console.log(seen, "./tray.mjs");
console.log(load(JSON.parse('"./tray.mjs"')));
