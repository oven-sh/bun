const grandchildPath = require.resolve("./grandchild.js");
exports.self = module;
exports.ownsRequire = module.require === require;
exports.grandchild = require(grandchildPath);
exports.resolvedSelf = require.resolve(__filename);
