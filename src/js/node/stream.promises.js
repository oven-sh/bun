// Hardcoded module "node:stream/promises"
import { promises } from "node:stream";

export var { pipeline, finished } = promises;

export default {
  pipeline,
  finished,
  [Symbol.for("CommonJS")]: 0,
};
