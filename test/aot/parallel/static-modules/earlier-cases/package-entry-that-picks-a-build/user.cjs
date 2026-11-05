const React = require("./index.js");
exports.viaRequire = function () { return React.useState(1).join() + React.version; };
