// bun: + the name of a Node.js module is that module.
import fs from "bun:fs";
import nodeFs from "node:fs";
import { readFile } from "bun:fs/promises";
console.log(fs === nodeFs, typeof readFile);
