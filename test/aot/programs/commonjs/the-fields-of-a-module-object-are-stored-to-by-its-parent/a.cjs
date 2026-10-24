const path = require("path");
exports.read = () => [path.basename(module.id), module.loaded];
exports.readMain = () => require.main.id + "|" + module.parent.id;
