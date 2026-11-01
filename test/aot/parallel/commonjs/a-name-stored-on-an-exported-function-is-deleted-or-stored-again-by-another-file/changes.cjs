var exported = require("./exported.cjs");
delete exported.marker;
exported["default"] = function other() {
  return "other";
};
