// The `require` of lib/own-require.cts, imported here, gets whole paths that start at `__dirname` of this file.
import { require as requireOfLib } from "./lib/own-require.cts";
const path: typeof import("node:path") = require("node:path");

console.log(requireOfLib(__dirname + "/value.cjs"), requireOfLib(`${__dirname}/value.cjs`), requireOfLib(path.join(__dirname, "value.cjs")));
console.log(requireOfLib("./value.cjs"), requireOfLib(__dirname + "/lib/value.cjs"));
