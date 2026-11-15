"use strict";
const { seen } = require("./beside.mjs");
function load(name) {
  const { label } = require(name);
  return label;
}
console.log(seen, "./tray.mjs");
console.log(load(JSON.parse('"./tray.mjs"')));
