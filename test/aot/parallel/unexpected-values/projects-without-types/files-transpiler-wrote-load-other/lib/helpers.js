"use strict";

exports.interopRequireDefault = function (obj) {
  return obj && obj.__esModule ? obj : { default: obj };
};
exports.interopRequireWildcard = function (obj) {
  if (obj && obj.__esModule) return obj;
  var copy = {};
  if (obj != null) {
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) copy[key] = obj[key];
    }
  }
  copy.default = obj;
  return copy;
};
