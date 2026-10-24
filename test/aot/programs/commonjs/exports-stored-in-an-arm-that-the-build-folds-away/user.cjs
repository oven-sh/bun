const React = require("./index.js");
exports.viaRequire = function () { return React.useState(4).join() + React.version; };
