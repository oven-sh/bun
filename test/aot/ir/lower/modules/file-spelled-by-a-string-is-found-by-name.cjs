// `require` goes into a list, so a call that the build does not follow may load a file. A file whose path a string spells outside the resolved loads is marked, with or without its extension, and no other file.
// RUN: link
// CHECK: path="{{*}}/found-by-name/other.cjs"{{*}}flags=[KeepsError]
// CHECK: path="{{*}}/found-by-name/spelled.cjs"{{*}}flags=[KeepsError, IsFoundByName]
// CHECK: path="{{*}}/found-by-name/short.cjs"{{*}}flags=[KeepsError, IsFoundByName]

const load = [require][0];
require("./imports/found-by-name/other.cjs");
require("./imports/found-by-name/spelled.cjs");
require("./imports/found-by-name/short.cjs");
load("./imports/found-by-name/spelled.cjs");
load("./imports/found-by-name/short");
