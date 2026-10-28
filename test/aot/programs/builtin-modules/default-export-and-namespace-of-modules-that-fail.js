// The modules that default-export-and-namespace-of-every-module.js leaves out, because a compiled program cannot import them or lists other names.
import default0, * as namespace0 from "node:events";
import default1, * as namespace1 from "node:repl";
import default2, * as namespace2 from "node:tty";

function describeValue(value, required) {
  const matches = [];
  if (value === required) matches.push("require()");
  if (value === required.default) matches.push("require().default");
  return `${typeof value}, ${matches.join(" and ") || "neither"}`;
}

function describe(specifier, defaultImport, namespace, defaultMember, required, imported) {
  const names = Object.keys(namespace).sort();
  console.log(specifier);
  console.log("  import x:", describeValue(defaultImport, required));
  console.log("  ns.default:", describeValue(defaultMember, required));
  console.log("  default of the namespace object:", describeValue(namespace.default, required));
  console.log("  import() gives the namespace object:", imported === namespace);
  console.log("  names:", names.join(" "));
  console.log("  not what the property of require() holds:", names.filter(name => !Object.is(namespace[name], required[name])).join(" "));
}

describe("node:events", default0, namespace0, namespace0.default, require("node:events"), await import("node:events"));
describe("node:repl", default1, namespace1, namespace1.default, require("node:repl"), await import("node:repl"));
describe("node:tty", default2, namespace2, namespace2.default, require("node:tty"), await import("node:tty"));
