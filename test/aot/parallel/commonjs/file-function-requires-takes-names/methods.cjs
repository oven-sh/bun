var { METHODS, STATUS_CODES: codes } = require("node:http");
exports.methods = METHODS.map(function (method) {
  return method.toLowerCase();
});
exports.textOf = function (code) {
  return codes[code];
};
