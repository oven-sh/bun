import fs, { promises, WriteStream, ReadStream, existsSync } from "node:fs";
import * as same from "node:fs/promises";
console.log(typeof promises.readFile, promises.readFile === same.readFile, WriteStream === fs.WriteStream, ReadStream.name, existsSync("/"));
