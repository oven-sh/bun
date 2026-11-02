"use strict";
console.log("runtime runs");
function make(type, props, key) {
  if (typeof type === "function") return type(props);
  return (
    "<" +
    String(type) +
    (key === undefined ? "" : " key=" + key) +
    ">" +
    [].concat(props.children ?? []).join("") +
    "</" +
    String(type) +
    ">"
  );
}
exports.jsx = make;
exports.jsxs = make;
exports.jsxDEV = make;
exports.Fragment = "fragment";
