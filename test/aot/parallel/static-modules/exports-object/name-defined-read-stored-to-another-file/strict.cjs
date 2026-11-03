"use strict";
const m = require("./m.cjs");
try {
  m.x = 3;
} catch (error) {
  console.log(error.constructor.name);
}
module.exports = m.x;
