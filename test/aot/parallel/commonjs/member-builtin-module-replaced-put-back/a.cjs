const { basename } = require("path");
const path = require("path");
exports.viaImport = () => basename("/a/b") + "," + path.basename("/a/b");
exports.exists = () => require("fs").existsSync("/");
