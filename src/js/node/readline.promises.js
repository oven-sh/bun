// Hardcoded module "node:readline/promises"
var {
  promises: { Readline, Interface, createInterface },
} = import.meta.require("node:readline");

export default {
  Readline,
  Interface,
  createInterface,
  [Symbol.for("CommonJS")]: 0,
};
