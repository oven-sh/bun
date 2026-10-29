// The namespace object takes `__esModule`, and only as a mark.
import * as self from "./namespace-object-takes-es-module-mark.mjs";
import fs from "bun:fs";
import nodeFs from "node:fs";
import { readFile } from "bun:fs/promises";
console.log(self.__esModule);
self.__esModule = true;
console.log(self.__esModule);
self.__esModule = false;
console.log(self.__esModule);
console.log(fs === nodeFs, typeof readFile);
