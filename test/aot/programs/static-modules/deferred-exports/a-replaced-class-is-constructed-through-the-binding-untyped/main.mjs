import fs from "node:fs";
function Patched(path) {
  this.path = "patched:" + path;
}
Patched.prototype.end = function () {
  return "ended " + this.path;
};
fs.WriteStream = Patched;
fs.ReadStream = () => "an arrow";
const rest = await import("./rest.mjs");
console.log(rest.make("a").end(), rest.call(), rest.isOne(rest.make("b")));
