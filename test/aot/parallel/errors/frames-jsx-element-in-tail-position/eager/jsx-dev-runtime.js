"use strict";
exports.jsxDEV = function jsxDEV(type, props) {
  return typeof type === "function" ? type(props) : { type, props };
};
exports.Fragment = "fragment";
