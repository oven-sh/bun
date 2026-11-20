// Every way to load node:zlib, node:fs and node:querystring answers one object for each, a named import is the member of that object, and the namespaces list the names that plain Bun lists.
import zlib, { gzipSync, constants } from "node:zlib";
import * as zlibNames from "node:zlib";
import fs, { readFileSync, promises } from "node:fs";
import * as fsNames from "node:fs";
import querystring, { parse, stringify } from "node:querystring";
import * as querystringNames from "node:querystring";
function describe(name, object, required, built, imported, names, named) {
  console.log(name);
  console.log("  require():", required === object);
  console.log("  import():", imported.default === object, imported === names);
  console.log("  process.getBuiltinModule():", built === object);
  console.log("  the namespace:", names.default === object);
  console.log(
    "  named:",
    Object.keys(named)
      .map(key => named[key] === object[key] && named[key] === names[key])
      .join(" "),
  );
  const listed = Object.keys(names).sort();
  console.log("  names:", listed.length, listed.slice(0, 6).join(" "));
}
describe(
  "node:zlib",
  zlib,
  require("node:zlib"),
  process.getBuiltinModule("node:zlib"),
  await import("node:zlib"),
  zlibNames,
  { gzipSync, constants },
);
describe("node:fs", fs, require("node:fs"), process.getBuiltinModule("node:fs"), await import("node:fs"), fsNames, {
  readFileSync,
  promises,
});
describe(
  "node:querystring",
  querystring,
  require("node:querystring"),
  process.getBuiltinModule("node:querystring"),
  await import("node:querystring"),
  querystringNames,
  { parse, stringify },
);
