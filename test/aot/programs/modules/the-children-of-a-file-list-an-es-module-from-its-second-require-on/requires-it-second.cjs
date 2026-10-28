const { basename } = require("node:path");
require("./shared.mjs");
exports.children = () => module.children.map(child => basename(child.filename) + " of " + basename(child.parent.filename)).join();
