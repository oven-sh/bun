// node:zlib calls process.binding() while it loads, at the link: replacements that the body stores see no call when the import is first read and used.
import zlib from "node:zlib";
const calls = [];
const binding = process.binding;
process.binding = function (name) {
  calls.push("process.binding " + name);
  return binding.call(this, name);
};
const now = Date.now;
Date.now = () => {
  calls.push("Date.now");
  return now();
};
const random = Math.random;
Math.random = () => {
  calls.push("Math.random");
  return random();
};
const parse = JSON.parse;
JSON.parse = (...args) => {
  calls.push("JSON.parse");
  return parse(...args);
};
const stringify = JSON.stringify;
JSON.stringify = (...args) => {
  calls.push("JSON.stringify");
  return stringify(...args);
};
const emit = process.emit;
process.emit = function (...args) {
  calls.push("process.emit");
  return emit.apply(this, args);
};
console.log(zlib.gzipSync("x").length, zlib.gunzipSync(zlib.gzipSync("x")).toString(), calls.join(", ") || "no call");
console.log(typeof process.binding("constants").zlib, typeof Date.now(), calls.join(", "));
