// The names of the namespaces of node:path and node:zlib are listed and asked for before any binding of the modules is read.
import * as path from "node:path";
import * as zlib from "node:zlib";
const listed = Object.keys(path).sort();
console.log(listed.length, listed.join(" "));
console.log("sep" in path, "nope" in path, Reflect.ownKeys(path).length - listed.length, path[Symbol.toStringTag]);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(path, "sep")));
console.log(
  Object.keys(zlib).length,
  "gzipSync" in zlib,
  Object.isFrozen(zlib),
  Object.isSealed(zlib),
  Object.isExtensible(zlib),
);
