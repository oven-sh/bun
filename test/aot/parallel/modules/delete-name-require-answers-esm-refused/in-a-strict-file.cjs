"use strict";
const values = require("./read-in-a-strict-file.mjs");
for (const remove of [() => delete values.only, () => delete values?.only]) {
  try {
    console.log(remove());
  } catch (error) {
    console.log(error.constructor.name, values.only);
  }
}
