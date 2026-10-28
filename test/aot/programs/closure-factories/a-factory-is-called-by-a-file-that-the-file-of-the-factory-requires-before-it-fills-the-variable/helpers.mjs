require("./user.mjs");
export var make = function (held) {
  return function () {
    return held;
  };
};
