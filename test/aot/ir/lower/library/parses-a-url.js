// RUN: link
// OPTIONS: builtin-modules
// CHECK: function {{*}}name="getHostname"

// As it is evaluated, node:url stores parse, parseHost, resolveObject and others into Url.prototype: they are reached with Url, not with the module.

// FILE: main.js
import url from "node:url";
process.stdout.write(url.parse("http://a.example/b?c=d").pathname + "\n");
