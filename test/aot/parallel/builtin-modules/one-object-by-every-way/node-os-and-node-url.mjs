// Every way to load node:os and node:url answers one object for each, a named import is the member of that object, and the namespaces list the names that plain Bun lists.
import os, { EOL, platform } from "node:os";
import * as osNames from "node:os";
import url, { fileURLToPath, URL as URLOfModule } from "node:url";
import * as urlNames from "node:url";
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
describe("node:os", os, require("node:os"), process.getBuiltinModule("node:os"), await import("node:os"), osNames, {
  EOL,
  platform,
});
describe(
  "node:url",
  url,
  require("node:url"),
  process.getBuiltinModule("node:url"),
  await import("node:url"),
  urlNames,
  { fileURLToPath, URL: URLOfModule },
);
console.log(URLOfModule === URL);
