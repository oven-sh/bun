// Hardcoded module "node:readline/promises"
import { promises } from "node:readline";

export const { Readline, Interface, createInterface } = promises;

export default {
  Readline,
  Interface,
  createInterface,
  [Symbol.for("CommonJS")]: 0,
};
