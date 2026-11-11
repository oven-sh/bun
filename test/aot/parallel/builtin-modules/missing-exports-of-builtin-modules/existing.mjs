import path, { sep, posix as p } from "node:path";
import { readFileSync } from "fs";
console.log("ran", typeof path, typeof sep, typeof p, typeof readFileSync);
