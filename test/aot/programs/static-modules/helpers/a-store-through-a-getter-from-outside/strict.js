"use strict";
const index = require("./index");
exports.store = () => {
  try {
    index.a = 5;
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
};
