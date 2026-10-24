// The modules are imported by constant names; which of their functions is called is decided where the program runs. The names come from the environment, so every function of these modules may be the one.
import * as path from "node:path";
import fs from "node:fs";
import os from "node:os";
import util from "node:util";
import zlib from "node:zlib";
import crypto from "node:crypto";
const url = require("node:url");

const [pathName, fsName, osName, utilName, zlibName, unzipName, cryptoName, urlName, typeName] = process.env.NAMES.split(",");
console.log(path[pathName]("/a/b/c.txt"), fs[fsName]("/"), typeof os[osName](), util[utilName]("%s!", "formatted"));
console.log(zlib[unzipName](zlib[zlibName]("packed")).toString(), crypto[cryptoName]("sha1").update("x").digest("hex").slice(0, 8), url[urlName]("file:///C:/x/y"), util.types[typeName](new Map()));
const { [pathName]: picked } = path.posix;
console.log(picked("/p/q"), Reflect.get(path, pathName)("/r/s"), Object.entries(path).find(([name]) => name === pathName)[1]("/t/u"));
function call(module, name, ...args) {
  return module[name](...args);
}
console.log(call(path, "ext" + "name", "a.b"), call(os, "end" + "ianness").length, call(util, "is" + "DeepStrictEqual", [1], [1]));
