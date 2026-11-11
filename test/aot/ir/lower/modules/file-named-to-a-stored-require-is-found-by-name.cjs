// RUN: link
// CHECK: path="{{*}}/found-by-name/other.cjs"{{*}}flags=[{{*}}IsFoundByName

const kept = require;
require = name => kept(name);
require("./imports/found-by-name/other.cjs");
