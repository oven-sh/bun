import { constants, promises } from "node:fs";
import process from "node:process";
import { types, inspect } from "node:util";
console.log(typeof constants.O_RDONLY, typeof promises.readFile, process.pid > 0, types.isPromise(promises.access(import.meta.dir)), typeof inspect.custom);
