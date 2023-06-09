// Hardcoded module "node:stream"
var { promises } = import.meta.require("node:stream");

export var { pipeline, finished } = promises;

export default {
  pipeline,
  finished,
  [Symbol.for("CommonJS")]: 0,
};
