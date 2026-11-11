"use strict";
exports.jsx = exports.jsxs = function jsx(type, props) {
  return typeof type === "function" ? type(props) : { type, props };
};
exports.Fragment = "fragment";
