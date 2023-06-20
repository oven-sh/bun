// Hardcoded module "node:stream"
import { promises } from "node:stream";

export var { pipeline, finished } = promises;

export default {
  pipeline,
  finished,
  [Symbol.for("CommonJS")]: 0,
};
