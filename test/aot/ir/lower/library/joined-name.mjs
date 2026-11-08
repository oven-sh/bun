// RUN(HELD): link
// RUN(LEFT): link
// OPTIONS: builtin-modules
// HELD: module {{*}}path="node:punycode" {{*}}body=
// LEFT-NOT: module {{*}}path="node:http2" {{*}}body=

// Folding joins the name, so its parts are dead, and neither names a module. The text stands in the place of the call.
// Nobody sees what a loader that is out of sight is given, so the module that the text names is held.

import { createRequire } from "node:module";
const held = new Proxy({}, {});
held.member = createRequire(import.meta.url);
console.log(held.member(["node:puny", "code"].join("")));
