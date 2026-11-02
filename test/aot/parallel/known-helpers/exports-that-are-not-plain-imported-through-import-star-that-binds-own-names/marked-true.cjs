exports.value = "value";
exports.other = "other";
exports.who = function who() {
  return this === exports ? "the exports" : this === undefined ? "undefined" : typeof this === "object" ? "another object" : typeof this;
};
