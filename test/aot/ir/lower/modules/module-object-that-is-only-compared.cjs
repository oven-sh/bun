// A comparison hands the module object to nobody: the file that it requires is bound by its names and has no object.
// RUN(COMPARED): link
// COMPARED: module {{*}}/imports/module-objects/required-by-the-compared-one.cjs"
// COMPARED-NOT: {{*}}/imports/module-objects/required-by-the-compared-one.cjs"{{*}}exportsVariable=g

require("./imports/module-objects/required-by-the-compared-one.cjs");

module.exports = require.main === module;
