"use strict";
const outer = require("./outer.cjs");
console.log(typeof outer.add, outer.add === undefined ? "none" : JSON.stringify(outer.add), Object.keys(outer).join());
